import { QUEUED_OF } from '../../../../../src/db/status.ts'
import { toJobDto } from '../../../../../src/web/dto.ts'
import { assertSameOrigin, jsonError, loadJob } from '../../../../../src/web/http.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 실패한 작업을 실패한 단계부터 다시 한다. failed → 그 단계의 대기 상태 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = assertSameOrigin(req)
  if (blocked) return blocked
  const found = await loadJob(ctx.params)
  if ('res' in found) return found.res
  const { job, jobs } = found
  if (job.status !== 'failed' || !job.failedPhase) return jsonError(409, '실패한 작업만 다시 시도할 수 있어요')
  const next = jobs.transition(job.id, ['failed'], QUEUED_OF[job.failedPhase], { errorMessage: null, failedPhase: null, stage: null })
  return next ? Response.json(toJobDto(next)) : jsonError(409, '실패한 작업만 다시 시도할 수 있어요')
}
