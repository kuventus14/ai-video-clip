import { isQueued, isRunning } from '../db/status.ts'
import type { JobDto, JobStatus, Phase, PurposeValue } from '../shared/types.ts'

const pad2 = (n: number) => String(n).padStart(2, '0')

/** 56.8 → "0:57", 3725 → "1:02:05". 초는 반올림한다. */
export function formatDuration(sec: number): string {
  const total = Number.isFinite(sec) && sec > 0 ? Math.round(sec) : 0
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`
}

/** 17624365 → "16.8MB", 1536 → "1.5KB". 1024 단위, 소수 한 자리(.0 은 뺀다). */
export function formatBytes(bytes: number): string {
  const n = Number.isFinite(bytes) && bytes > 0 ? bytes : 0
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  if (i === 0) return `${Math.floor(v)}B`
  return `${v.toFixed(1).replace(/\.0$/, '')}${units[i]}`
}

/** 361521 → "36만", 8835 → "8.8천", 999 → "999". 값을 부풀리지 않도록 내림한다. */
export function formatViews(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '조회수 없음'
  const count = Math.max(0, Math.floor(n))
  const units: [number, string][] = [
    [100_000_000, '억'],
    [10_000, '만'],
    [1_000, '천'],
  ]
  const unit = units.find(([size]) => count >= size)
  if (!unit) return String(count)
  const [size, suffix] = unit
  const tenths = Math.floor(count / (size / 10))
  if (tenths >= 100) return `${Math.floor(tenths / 10)}${suffix}`
  const decimal = tenths % 10
  return `${Math.floor(tenths / 10)}${decimal ? `.${decimal}` : ''}${suffix}`
}

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** 같은 날 "오늘 14:05", 어제 "어제", 그 외 "10월 18일"(해가 다르면 "2025년 12월 31일"). 로컬 시간 기준. */
export function formatKoreanDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  if (sameDay(d, now)) return `오늘 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (sameDay(d, yesterday)) return '어제'
  const md = `${d.getMonth() + 1}월 ${d.getDate()}일`
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}년 ${md}`
}

/** formatKoreanDate 의 결과 뒤에 "에" 를 붙인다. "어제" 는 "어제에" 가 어색해 그대로 둔다. */
export function atDate(dateText: string): string {
  if (!dateText) return ''
  return dateText === '어제' ? dateText : `${dateText}에`
}

export const STATUS_LABEL: Record<JobStatus, string> = {
  created: '올리는 중',
  queued_probe: '확인 대기',
  probing: '영상 확인 중',
  ready: '시작 전',
  queued_analysis: '분석 대기',
  analyzing: '분석 중',
  awaiting_reference: '레퍼런스 선택',
  queued_plan: '계획 대기',
  planning: '계획 만드는 중',
  awaiting_plan: '계획 확인',
  queued_produce: '제작 대기',
  producing: '제작 중',
  awaiting_confirm: '결과 확인',
  confirmed: '확정',
  failed: '실패',
}

/** 내가 할 일이 있는 상태(워커가 아니라 사용자를 기다리는 상태)의 안내. 이 상태가 아니면 항목이 없다. */
export const NEXT_ACTION: Partial<Record<JobStatus, string>> = {
  ready: '설명과 용도를 정하고 시작해 주세요',
  awaiting_reference: '레퍼런스를 골라 주세요',
  awaiting_plan: '이해한 내용을 확인해 주세요',
  awaiting_confirm: '결과를 확인해 주세요',
}

export const STEPS = ['업로드', '분석', '레퍼런스', '계획 확인', '제작', '결과'] as const
export type StepIndex = 0 | 1 | 2 | 3 | 4 | 5

const STEP_OF: Record<Exclude<JobStatus, 'failed'>, StepIndex> = {
  created: 0,
  queued_probe: 0,
  probing: 0,
  ready: 0,
  queued_analysis: 1,
  analyzing: 1,
  awaiting_reference: 2,
  queued_plan: 3,
  planning: 3,
  awaiting_plan: 3,
  queued_produce: 4,
  producing: 4,
  awaiting_confirm: 5,
  confirmed: 5,
}

// 계획 단계에서 실패하면 레퍼런스·요청을 고쳐 다시 요청하므로 레퍼런스 단계로 본다.
const STEP_OF_FAILED_PHASE: Record<Phase, StepIndex> = { probe: 0, analysis: 1, plan: 2, produce: 4 }

/** 상태 → 0~5 단계. 실패(failed)는 어느 단계인지 모르므로 0 을 돌려준다 — 작업이 있으면 stepForJob 을 쓴다. */
export function stepFor(status: JobStatus): StepIndex {
  return status === 'failed' ? 0 : STEP_OF[status]
}

export function stepForJob(job: { status: JobStatus; failedPhase: Phase | null }): StepIndex {
  if (job.status === 'failed') return job.failedPhase ? STEP_OF_FAILED_PHASE[job.failedPhase] : 0
  return STEP_OF[job.status]
}

/** 워커가 하는 중이거나 순서를 기다리는 중 — 진행 화면을 보여 준다. */
export function isBusy(status: JobStatus): boolean {
  return isQueued(status) || isRunning(status)
}

/** 눈금자의 재생헤드 모양: 워커가 하는 중(busy) / 내 차례(waiting) / 끝(done) / 멈춤(failed) */
export function progressState(status: JobStatus): 'busy' | 'waiting' | 'done' | 'failed' {
  if (status === 'confirmed') return 'done'
  if (status === 'failed') return 'failed'
  return isBusy(status) ? 'busy' : 'waiting'
}

/** 화면이 작업을 다시 읽어 올 간격(ms). 확정·실패는 더 바뀔 일이 없어 null. */
export function pollIntervalMs(status: JobStatus): number | null {
  if (status === 'confirmed' || status === 'failed') return null
  return isBusy(status) ? 1500 : 5000
}

export function purposeLabel(p: PurposeValue): string {
  return p === 'post' ? '게시물 영상용(가로)' : '릴스·숏츠용(세로)'
}

/** 지금 보여 줄 용도: 확정된 것 > 사용자가 고른 것 > 자동 인식한 것 */
export function shownPurpose(job: Pick<JobDto, 'purpose' | 'purposeChoice' | 'purposeGuess'>): PurposeValue | null {
  return job.purpose ?? (job.purposeChoice !== 'auto' ? job.purposeChoice : (job.purposeGuess?.purpose ?? null))
}

/** 제작 시간 안내: 영상 길이의 2~3배쯤 걸린다. 56.8 → "약 2~3분", 아주 짧으면 "1분 안팎", 길이를 모르면 "". */
export function estimateProduce(durationSec: number): string {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return ''
  const upper = Math.max(1, Math.round((durationSec * 3) / 60))
  if (upper <= 1) return '1분 안팎'
  const lower = Math.min(upper, Math.max(1, Math.round((durationSec * 2) / 60)))
  return `약 ${lower}~${upper}분`
}

/** 자동 인식 확신이 이보다 낮으면 직접 골라 보라고 권한다 */
export const LOW_CONFIDENCE = 0.65

/** 용도 선택 아래 한 줄: 자동 인식 결과와 이유, 확신이 낮을 때의 권유, 직접 고른 값이 우선이라는 말 */
export function purposeNote(choice: 'auto' | PurposeValue, guess: JobDto['purposeGuess']): string {
  if (!guess) return choice === 'auto' ? '영상을 올리면 가로·세로 비율과 길이를 보고 자동으로 정해요.' : '직접 고른 값으로 만들어요.'
  const reason = guess.reasons[0] ? ` — ${guess.reasons[0]}` : ''
  if (choice === 'auto') {
    const low = guess.confidence < LOW_CONFIDENCE ? ' 확신이 낮아요. 직접 골라 보세요.' : ''
    return `자동 인식: ${purposeLabel(guess.purpose)}${reason}.${low}`
  }
  return guess.purpose === choice ? `직접 고른 값이에요. 자동 인식도 같았어요${reason}.` : `직접 고른 값으로 만들어요. (자동 인식은 ${purposeLabel(guess.purpose)} 였어요.)`
}
