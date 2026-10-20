import { describe, expect, it } from 'vitest'
import type { JobStatus } from '../src/shared/types.ts'
import { LOW_CONFIDENCE, estimateProduce, formatBytes, formatDuration, formatKoreanDate, formatViews, isBusy, pollIntervalMs, progressState, purposeLabel, purposeNote, NEXT_ACTION, shownPurpose, STATUS_LABEL, STEPS, stepFor, stepForJob } from '../src/ui/format.ts'

const ALL_STATUSES: JobStatus[] = ['created', 'queued_probe', 'probing', 'ready', 'queued_analysis', 'analyzing', 'awaiting_reference', 'queued_plan', 'planning', 'awaiting_plan', 'queued_produce', 'producing', 'awaiting_confirm', 'confirmed', 'failed']

describe('formatDuration', () => {
  it('초는 반올림해 분:초로 쓴다', () => {
    expect(formatDuration(56.8)).toBe('0:57')
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(65)).toBe('1:05')
  })
  it('반올림으로 60초가 되면 분이 올라간다', () => {
    expect(formatDuration(59.6)).toBe('1:00')
  })
  it('한 시간 이상은 시:분:초', () => {
    expect(formatDuration(3725)).toBe('1:02:05')
  })
  it('음수·NaN 은 0:00', () => {
    expect(formatDuration(-3)).toBe('0:00')
    expect(formatDuration(Number.NaN)).toBe('0:00')
  })
})

describe('formatBytes', () => {
  it('KB·MB·GB 로 줄이고 소수 한 자리까지 쓴다(1000 단위가 아니라 1024 단위)', () => {
    expect(formatBytes(0)).toBe('0B')
    expect(formatBytes(999)).toBe('999B')
    expect(formatBytes(1536)).toBe('1.5KB')
    expect(formatBytes(17_624_365)).toBe('16.8MB')
    expect(formatBytes(400 * 1024 * 1024)).toBe('400MB')
    expect(formatBytes(3.2 * 1024 ** 3)).toBe('3.2GB')
  })
  it('음수·NaN 은 0B', () => {
    expect(formatBytes(-5)).toBe('0B')
    expect(formatBytes(Number.NaN)).toBe('0B')
  })
})

describe('formatViews', () => {
  it('만·천 단위로 줄이고 값을 부풀리지 않는다(내림)', () => {
    expect(formatViews(361521)).toBe('36만')
    expect(formatViews(8835)).toBe('8.8천')
    expect(formatViews(9999)).toBe('9.9천')
    expect(formatViews(12345)).toBe('1.2만')
    expect(formatViews(10000)).toBe('1만')
    expect(formatViews(1000)).toBe('1천')
    expect(formatViews(123456789)).toBe('1.2억')
  })
  it('1000 미만은 그대로', () => {
    expect(formatViews(999)).toBe('999')
    expect(formatViews(0)).toBe('0')
  })
  it('없으면 "조회수 없음"', () => {
    expect(formatViews(null)).toBe('조회수 없음')
  })
})

describe('formatKoreanDate', () => {
  const now = new Date(2026, 9, 20, 18, 0) // 2026-10-20 18:00 (로컬)
  const iso = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).toISOString()
  it('같은 날은 "오늘 시:분"', () => {
    expect(formatKoreanDate(iso(2026, 10, 20, 14, 5), now)).toBe('오늘 14:05')
    expect(formatKoreanDate(iso(2026, 10, 20, 9, 7), now)).toBe('오늘 09:07')
  })
  it('어제는 "어제"', () => {
    expect(formatKoreanDate(iso(2026, 10, 19, 23, 59), now)).toBe('어제')
  })
  it('그 외는 "10월 18일", 해가 다르면 연도를 붙인다', () => {
    expect(formatKoreanDate(iso(2026, 10, 18, 12), now)).toBe('10월 18일')
    expect(formatKoreanDate(iso(2025, 12, 31, 12), now)).toBe('2025년 12월 31일')
  })
  it('날짜가 아닌 값은 빈 문자열', () => {
    expect(formatKoreanDate('not a date', now)).toBe('')
  })
})

describe('단계', () => {
  it('STEPS 는 여섯 단계', () => {
    expect([...STEPS]).toEqual(['업로드', '분석', '레퍼런스', '계획 확인', '제작', '결과'])
  })
  it('stepFor 가 상태를 단계로 옮긴다', () => {
    expect(stepFor('created')).toBe(0)
    expect(stepFor('ready')).toBe(0)
    expect(stepFor('analyzing')).toBe(1)
    expect(stepFor('awaiting_reference')).toBe(2)
    expect(stepFor('planning')).toBe(3)
    expect(stepFor('awaiting_plan')).toBe(3)
    expect(stepFor('producing')).toBe(4)
    expect(stepFor('awaiting_confirm')).toBe(5)
    expect(stepFor('confirmed')).toBe(5)
  })
  it('모든 상태가 0~5 단계를 가진다', () => {
    for (const s of ALL_STATUSES) {
      const n = stepFor(s)
      expect(n).toBeGreaterThanOrEqual(0)
      expect(n).toBeLessThanOrEqual(5)
    }
  })
  it('실패한 작업은 실패한 단계로 환산한다(plan 은 레퍼런스 단계로 돌아가 고친다)', () => {
    expect(stepForJob({ status: 'failed', failedPhase: 'plan' })).toBe(2)
    expect(stepForJob({ status: 'failed', failedPhase: 'probe' })).toBe(0)
    expect(stepForJob({ status: 'failed', failedPhase: 'analysis' })).toBe(1)
    expect(stepForJob({ status: 'failed', failedPhase: 'produce' })).toBe(4)
    expect(stepForJob({ status: 'producing', failedPhase: null })).toBe(4)
  })
})

describe('isBusy / pollIntervalMs', () => {
  it('대기열·실행 중이면 바쁘다', () => {
    expect(isBusy('analyzing')).toBe(true)
    expect(isBusy('queued_produce')).toBe(true)
    expect(isBusy('awaiting_reference')).toBe(false)
    expect(isBusy('confirmed')).toBe(false)
    expect(isBusy('failed')).toBe(false)
  })
  it('바쁠 땐 1500, 입력 대기는 5000, 확정·실패는 멈춘다', () => {
    expect(pollIntervalMs('producing')).toBe(1500)
    expect(pollIntervalMs('queued_analysis')).toBe(1500)
    expect(pollIntervalMs('awaiting_plan')).toBe(5000)
    expect(pollIntervalMs('ready')).toBe(5000)
    expect(pollIntervalMs('confirmed')).toBeNull()
    expect(pollIntervalMs('failed')).toBeNull()
  })
})

describe('progressState', () => {
  it('눈금자의 재생헤드 모양을 상태로 정한다', () => {
    expect(progressState('analyzing')).toBe('busy')
    expect(progressState('queued_plan')).toBe('busy')
    expect(progressState('ready')).toBe('waiting')
    expect(progressState('awaiting_confirm')).toBe('waiting')
    expect(progressState('created')).toBe('waiting')
    expect(progressState('confirmed')).toBe('done')
    expect(progressState('failed')).toBe('failed')
  })
})

describe('estimateProduce — 제작은 영상 길이의 2~3배쯤', () => {
  it('분 단위로 반올림해 범위로 말한다', () => {
    expect(estimateProduce(56.8)).toBe('약 2~3분')
    expect(estimateProduce(300)).toBe('약 10~15분')
    expect(estimateProduce(600)).toBe('약 20~30분')
    expect(estimateProduce(30)).toBe('약 1~2분')
  })
  it('아주 짧으면 1분 안팎', () => {
    expect(estimateProduce(10)).toBe('1분 안팎')
    expect(estimateProduce(20)).toBe('1분 안팎')
  })
  it('길이를 모르면(0·NaN·음수) 빈 문자열', () => {
    expect(estimateProduce(0)).toBe('')
    expect(estimateProduce(Number.NaN)).toBe('')
    expect(estimateProduce(-4)).toBe('')
  })
})

describe('shownPurpose — 확정된 값 > 직접 고른 값 > 자동 인식', () => {
  const guess = { purpose: 'short' as const, confidence: 0.8, reasons: [] }
  it('우선순위', () => {
    expect(shownPurpose({ purpose: 'post', purposeChoice: 'short', purposeGuess: guess })).toBe('post')
    expect(shownPurpose({ purpose: null, purposeChoice: 'post', purposeGuess: guess })).toBe('post')
    expect(shownPurpose({ purpose: null, purposeChoice: 'auto', purposeGuess: guess })).toBe('short')
    expect(shownPurpose({ purpose: null, purposeChoice: 'auto', purposeGuess: null })).toBeNull()
  })
})

describe('purposeNote — 용도 선택 아래 한 줄', () => {
  const guess = (purpose: 'post' | 'short', confidence: number) => ({ purpose, confidence, reasons: ['영상이 세로 비율이에요'] })
  it('아직 인식 전이면 안내만', () => {
    expect(purposeNote('auto', null)).toMatch(/올리면|확인하면/)
    expect(purposeNote('post', null)).toBe('직접 고른 값으로 만들어요.')
  })
  it('자동일 때는 결과와 이유를, 확신이 낮으면 직접 골라 보라고 한다', () => {
    expect(purposeNote('auto', guess('short', 0.9))).toBe('자동 인식: 릴스·숏츠용(세로) — 영상이 세로 비율이에요.')
    expect(purposeNote('auto', guess('short', LOW_CONFIDENCE - 0.01))).toContain('확신이 낮아요. 직접 골라 보세요.')
    expect(purposeNote('auto', guess('short', LOW_CONFIDENCE))).not.toContain('확신이 낮아요')
  })
  it('직접 고른 값은 자동 인식과 같든 다르든 우선이라고 말한다', () => {
    expect(purposeNote('short', guess('short', 0.9))).toContain('직접 고른 값이에요')
    expect(purposeNote('post', guess('short', 0.9))).toBe('직접 고른 값으로 만들어요. (자동 인식은 릴스·숏츠용(세로) 였어요.)')
  })
})

describe('NEXT_ACTION', () => {
  it('사용자가 할 일이 있는 상태에만 안내 문구가 있다', () => {
    const waiting = ALL_STATUSES.filter((s) => NEXT_ACTION[s])
    expect(waiting).toEqual(['ready', 'awaiting_reference', 'awaiting_plan', 'awaiting_confirm'])
    for (const s of waiting) expect(NEXT_ACTION[s]).toMatch(/요$/)
  })
})

describe('문구', () => {
  it('모든 상태에 한국어 문구가 있다', () => {
    for (const s of ALL_STATUSES) expect(STATUS_LABEL[s]).toMatch(/\S/)
  })
  it('purposeLabel', () => {
    expect(purposeLabel('post')).toBe('게시물 영상용(가로)')
    expect(purposeLabel('short')).toBe('릴스·숏츠용(세로)')
  })
})
