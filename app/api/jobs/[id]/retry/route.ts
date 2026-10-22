import { QUEUED_OF } from '../../../../../src/db/status.ts'
import { loadCatalog, SoundError, soundChoiceProblem } from '../../../../../src/shared/sound.ts'
import { toJobDto } from '../../../../../src/web/dto.ts'
import { assertSameOrigin, jsonError, loadJob } from '../../../../../src/web/http.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 실패한 작업을 실패한 단계부터 다시 한다. failed → 그 단계의 대기 상태.
 * 다만 제작 단계에서 실패했는데 골라 둔 배경음악·효과음을 이제 쓸 수 없다면(곡 파일이 지워졌거나 목록이 깨짐)
 * 같은 이유로 또 실패하므로, 계획 단계로 돌려보내 승인 화면에서 다시 고르게 한다.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = assertSameOrigin(req)
  if (blocked) return blocked
  const found = await loadJob(ctx.params)
  if ('res' in found) return found.res
  const { job, jobs } = found
  if (job.status !== 'failed' || !job.failedPhase) return jsonError(409, '실패한 작업만 다시 시도할 수 있어요')

  let target = QUEUED_OF[job.failedPhase]
  let note: string | null = null
  if (job.failedPhase === 'produce' && (job.bgmId || job.sfxMode === 'on')) {
    let problem: string | null
    try {
      problem = soundChoiceProblem(loadCatalog(), job.bgmId, job.sfxMode)
    } catch (e) {
      if (!(e instanceof SoundError)) throw e
      problem = e.message
    }
    if (problem) {
      target = 'queued_plan'
      note = `골라 둔 배경음악·효과음을 쓸 수 없어서 계획 확인 화면으로 돌아왔어요 — ${problem}`
    }
  }
  const next = jobs.transition(job.id, ['failed'], target, { errorMessage: null, failedPhase: null, stage: null })
  if (!next) return jsonError(409, '실패한 작업만 다시 시도할 수 있어요')
  if (note) jobs.log(next.id, 'retry', note)
  return Response.json(toJobDto(jobs.get(next.id)!))
}
