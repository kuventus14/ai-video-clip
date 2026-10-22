import fs from 'node:fs'
import path from 'node:path'
import { LlmError } from '../core/llm.ts'
import { ToolError } from '../core/exec.ts'
import { assertDurationOk, InputError, type Analysis, type Prepared, type Stage } from '../core/pipeline.ts'
import { applyScriptEdits } from '../core/script.ts'
import { ReferenceFetchError } from '../core/reference.ts'
import { VoiceError } from '../core/voice.ts'
import { SoundError } from '../shared/sound.ts'
import { resolvePurpose } from '../core/purpose.ts'
import { broadQueries, SearchError } from '../core/search.ts'
import type { Job, Jobs } from '../db/jobs.ts'
import type { WorkerDeps } from './worker.ts'

const STAGE_LABEL: Record<Stage, string> = {
  probe: '영상 확인',
  normalize: '형식 변환',
  transcribe: '음성 인식',
  reference: '레퍼런스 분석',
  purpose: '용도 판단',
  understand: '영상 이해',
  plan: '편집 계획',
  cuts: '컷 계산',
  track: '사람 위치 추적',
  voice: '목소리 보정',
  direct: '편집 구성 짜기',
  tempo: '속도 맞추기',
  build: '편집 프로젝트 만들기',
  render: '렌더링',
  mix: '배경음악·효과음 입히기',
  qa: '검수',
  rework: '검수 결과로 다시 작업',
  done: '완료',
}

export interface PhaseContext {
  jobs: Jobs
  d: WorkerDeps
  job: Job
  dir: string
  /** 엔진의 단계 알림을 작업의 stage 와 진행 기록에 한국어로 반영한다 */
  onStage: (s: Stage, detail?: string) => void
}

const readJson = <T>(file: string): T | undefined => (fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as T) : undefined)
const writeJson = (file: string, value: unknown) => fs.writeFileSync(file, JSON.stringify(value))

export function stageText(s: Stage, detail?: string): string {
  return detail ? `${STAGE_LABEL[s]} — ${detail}` : STAGE_LABEL[s]
}

/** 사용자에게 그대로 보여 줄 수 있는 오류는 메시지를, 그 밖의 오류는 일반 안내를 돌려준다. */
export function describeError(e: unknown): { message: string; detail?: string } {
  if (e instanceof InputError || e instanceof ReferenceFetchError || e instanceof LlmError || e instanceof SearchError || e instanceof VoiceError || e instanceof SoundError) {
    return { message: e.message }
  }
  // 도구(ffprobe·ffmpeg 등)의 원문에는 이 컴퓨터의 파일 경로와 영어 오류가 섞여 있다 — 화면에는 안내만, 원문은 진행 기록에 남긴다
  if (e instanceof ToolError) {
    const message = e.tool === 'ffprobe' ? '영상을 읽을 수 없어요. 손상됐거나 영상이 아닌 파일일 수 있어요.' : `${e.tool} 가 실패했어요. 같은 일이 반복되면 진행 기록의 자세한 내용을 알려 주세요.`
    return { message, detail: e.message }
  }
  const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
  return { message: '예상하지 못한 오류가 났어요. 다시 시도해 보고, 계속되면 알려 주세요.', detail }
}

function requireSource(job: Job): string {
  if (!job.sourcePath) throw new Error('올린 영상 파일을 찾을 수 없어요')
  return job.sourcePath
}

/** 올린 영상의 정보·자동 인식 용도·썸네일을 확인한다. */
export async function probePhase({ jobs, d, job, dir }: PhaseContext): Promise<void> {
  const source = requireSource(job)
  const info = await d.probeVideo(source)
  assertDurationOk(info.durationSec)
  const purposeGuess = d.detectPurpose({ info })

  let thumbPath: string | null = null
  try {
    const out = path.join(dir, 'source-thumb.jpg')
    await d.makeThumbnail(source, out, Math.min(1, info.durationSec / 2))
    thumbPath = out
  } catch {
    // 썸네일이 없어도 흐름에는 지장이 없다
  }
  jobs.transition(job.id, ['probing'], 'ready', {
    sourceInfo: { durationSec: info.durationSec, width: info.width, height: info.height },
    purposeGuess,
    thumbPath,
    stage: null,
  })
}

/** 영상을 이해한다(음성 인식·요약). 레퍼런스가 없으면 비슷한 인기 영상을 검색해 고르게 한다. */
export async function analysisPhase({ jobs, d, job, dir, onStage }: PhaseContext): Promise<void> {
  const analysis = await d.analyzeInput({ videoPath: requireSource(job), workDir: dir, description: job.description, onStage })
  writeJson(path.join(dir, 'analysis.json'), analysis)

  if (job.referenceSource) {
    jobs.transition(job.id, ['analyzing'], 'queued_plan', { summary: analysis.summary, purposeGuess: analysis.purposeGuess, stage: null })
    return
  }

  // 검색이 실패해도(인터넷 없음 등) 작업은 막지 않는다 — 링크·파일을 직접 넣을 수 있다.
  const purpose = resolvePurpose(analysis.purposeGuess, job.purposeChoice)
  let recommendations: Job['recommendations'] = []
  try {
    onStage('understand', '비슷한 인기 영상을 찾는 중')
    recommendations = await d.searchReferences({ queries: broadQueries(analysis.summary), purpose })
    jobs.log(job.id, 'search', `추천 영상 ${recommendations.length}개를 찾았어요`)
  } catch (e) {
    jobs.log(job.id, 'search', `추천 영상을 찾지 못했어요. 링크나 파일로 직접 골라 주세요. (${describeError(e).message})`)
  }
  jobs.transition(job.id, ['analyzing'], 'awaiting_reference', { summary: analysis.summary, purposeGuess: analysis.purposeGuess, recommendations, stage: null })
}

/** 고른 레퍼런스·요청으로 편집 계획과 "이렇게 이해했어요" 카드를 만든다. */
export async function planPhase({ jobs, d, job, dir, onStage }: PhaseContext): Promise<void> {
  const analysis = readJson<Analysis>(path.join(dir, 'analysis.json'))
  if (!analysis) throw new Error('분석 결과(analysis.json)를 찾을 수 없어요')
  const previous = readJson<Prepared>(path.join(dir, 'prepared.json'))

  const reference = job.referenceSource ?? undefined
  // 같은 레퍼런스로 다시 계획하면(용도 바꾸기·요청 고치기) 이미 분석한 스펙을 쓰고 다시 받지 않는다
  const knownSpec = reference && previous?.referenceSource === reference ? previous.spec : undefined

  const prepared = await d.prepareEdit({ analysis, workDir: dir, reference, knownSpec, request: job.requestText, purposeChoice: job.purposeChoice, onStage })
  writeJson(path.join(dir, 'prepared.json'), prepared)
  jobs.transition(job.id, ['planning'], 'awaiting_plan', { plan: prepared.plan, planCard: prepared.planCard, purpose: prepared.purpose, captionPosition: prepared.captionPosition, script: prepared.script ?? null, scriptEdits: null, errorMessage: null, stage: null })
}

/** 편집·렌더링·검수를 해서 결과 영상과 리포트를 만든다. */
export async function producePhase({ jobs, d, job, dir, onStage }: PhaseContext): Promise<void> {
  const analysis = readJson<Analysis>(path.join(dir, 'analysis.json'))
  const prepared = readJson<Prepared>(path.join(dir, 'prepared.json'))
  if (!analysis || !prepared) throw new Error('분석·계획 결과를 찾을 수 없어요')

  const outDir = path.join(dir, 'out')
  // 승인 화면에서 문구를 고쳤다면 계획 대본 위에 덮어서 넘긴다(상한을 넘는 값은 정리된다). 고치지 않았으면 엔진이 prepared.script 를 그대로 쓴다.
  const script = job.scriptEdits && prepared.script ? applyScriptEdits(prepared.script, job.scriptEdits, { durationSec: analysis.info.durationSec, fallbackTitle: analysis.summary.genre || analysis.summary.topic }) : undefined
  const result = await d.produceEdit({ analysis, prepared, outDir, script, quality: job.quality, captions: job.captionsMode, captionPosition: job.captionPosition ?? undefined, audio: job.audioMode, bgm: job.bgmId, sfx: job.sfxMode, onStage })

  let thumbPath: string | null = null
  try {
    const out = path.join(dir, 'thumb.jpg')
    await d.makeThumbnail(result.resultPath, out, 1)
    thumbPath = out
  } catch {
    // 썸네일이 없어도 결과는 쓸 수 있다
  }
  // 목록·결과 화면이 쓰도록 결과 영상을 직접 재서 리포트에 붙인다(렌더가 계획과 1초쯤 달라도 화면이 맞는 값을 보이게). 못 재도 결과는 쓸 수 있다.
  let output: { durationSec: number; width: number; height: number } | undefined
  try {
    const info = await d.probeVideo(result.resultPath)
    output = { durationSec: info.durationSec, width: info.width, height: info.height }
  } catch {
    // 길이 표시만 비게 된다
  }
  const written = readJson<unknown>(path.join(outDir, 'report.json')) ?? null
  const report = output && written && typeof written === 'object' ? { ...written, output } : written
  jobs.transition(job.id, ['producing'], 'awaiting_confirm', {
    resultPath: result.resultPath,
    report,
    attempts: result.attempts,
    thumbPath: thumbPath ?? job.thumbPath,
    purpose: result.purpose,
    errorMessage: null,
    stage: null,
  })
}
