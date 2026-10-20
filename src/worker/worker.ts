import { run } from '../core/exec.ts'
import { probeVideo } from '../core/media.ts'
import { analyzeInput, prepareEdit, produceEdit, type Stage } from '../core/pipeline.ts'
import { detectPurpose } from '../core/purpose.ts'
import { searchReferences } from '../core/search.ts'
import { openDb } from '../db/db.ts'
import { Jobs } from '../db/jobs.ts'
import { PHASE_OF, type RunningStatus } from '../db/status.ts'
import { analysisPhase, describeError, planPhase, probePhase, producePhase, stageText, type PhaseContext } from './phases.ts'

/** 엔진을 부르는 함수들. 시험에서 가짜로 바꿔 끼운다. */
export interface WorkerDeps {
  probeVideo: typeof probeVideo
  detectPurpose: typeof detectPurpose
  analyzeInput: typeof analyzeInput
  prepareEdit: typeof prepareEdit
  produceEdit: typeof produceEdit
  searchReferences: typeof searchReferences
  makeThumbnail: (video: string, out: string, atSec?: number) => Promise<void>
}

const DEFAULTS: WorkerDeps = {
  probeVideo,
  detectPurpose,
  analyzeInput,
  prepareEdit,
  produceEdit,
  searchReferences,
  makeThumbnail: async (video, out, atSec = 1) => {
    await run('ffmpeg', ['-v', 'error', '-nostdin', '-y', '-ss', String(atSec), '-i', video, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', out])
  },
}

const PHASES = {
  probe: probePhase,
  analysis: analysisPhase,
  plan: planPhase,
  produce: producePhase,
} as const

/** 대기 작업 하나를 집어 끝까지(또는 실패까지) 처리한다. 없으면 'idle'. */
export async function runOnce(jobs: Jobs, overrides: Partial<WorkerDeps> = {}): Promise<'idle' | 'processed'> {
  const d: WorkerDeps = { ...DEFAULTS, ...overrides }
  const job = jobs.claimNext()
  if (!job) return 'idle'

  const phase = PHASE_OF[job.status as RunningStatus]
  const ctx: PhaseContext = {
    jobs,
    d,
    job,
    dir: jobs.jobDir(job.id),
    onStage: (s: Stage, detail?: string) => {
      const text = stageText(s, detail)
      jobs.update(job.id, { stage: text })
      jobs.log(job.id, s, text)
    },
  }
  try {
    await PHASES[phase](ctx)
  } catch (e) {
    const { message, detail } = describeError(e)
    try {
      if (detail) jobs.log(job.id, 'error', detail)
      jobs.transition(job.id, [job.status], 'failed', { failedPhase: phase, errorMessage: message, stage: null })
    } catch {
      // 실패를 기록하는 중에 작업이 지워졌다면 더 할 일이 없다
    }
  }
  return 'processed'
}

/**
 * 워커를 시작한다. 시작할 때 실행 중이던 작업을 "중단됨"으로 돌리고, pollMs 마다 대기 작업을 하나씩 처리한다.
 * stop() 은 진행 중이던 한 건을 끝낸 뒤 반환한다.
 */
export function startWorker(o: { dataDir: string; pollMs?: number; deps?: Partial<WorkerDeps> }): { stop(): Promise<void> } {
  const jobs = new Jobs(openDb(o.dataDir), o.dataDir)
  const pollMs = o.pollMs ?? 1500
  jobs.resetInterrupted()

  let stopped = false
  let wake!: () => void
  let wakeUp = new Promise<void>((r) => (wake = r))

  const loop = (async () => {
    while (!stopped) {
      const result = await runOnce(jobs, o.deps)
      if (result === 'idle' && !stopped) {
        await Promise.race([new Promise((r) => setTimeout(r, pollMs)), wakeUp])
      }
    }
  })()

  return {
    async stop() {
      stopped = true
      wake()
      wakeUp = new Promise<void>((r) => (wake = r))
      await loop
    },
  }
}
