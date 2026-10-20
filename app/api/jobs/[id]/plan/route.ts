import type { Job } from '../../../../../src/db/jobs.ts'
import type { JobStatus } from '../../../../../src/shared/types.ts'
import { toJobDto } from '../../../../../src/web/dto.ts'
import { resolveReference } from '../../../../../src/web/flow.ts'
import { assertSameOrigin, jsonError, loadJob, readBody } from '../../../../../src/web/http.ts'
import { PlanBody } from '../../../../../src/web/schemas.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FROM: JobStatus[] = ['awaiting_reference', 'awaiting_plan', 'awaiting_confirm', 'failed']

/**
 * 레퍼런스·요청·용도를 정해(다시) 계획을 요청한다. awaiting_reference·awaiting_plan·awaiting_confirm → queued_plan.
 * 계획 단계에서 실패한 작업(failed + failedPhase 'plan')도 새 레퍼런스로 다시 요청할 수 있다.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = assertSameOrigin(req)
  if (blocked) return blocked
  const found = await loadJob(ctx.params)
  if ('res' in found) return found.res
  const { job, jobs } = found
  if (!FROM.includes(job.status) || (job.status === 'failed' && job.failedPhase !== 'plan')) return jsonError(409, '지금은 계획을 다시 요청할 수 없는 상태예요')

  const body = await readBody(req, PlanBody)
  if ('res' in body) return body.res
  const ref = resolveReference(job, body.data.reference)
  if (!ref.ok) return ref.res

  const patch: Partial<Job> = { errorMessage: null, failedPhase: null, stage: null }
  if (ref.value !== undefined) patch.referenceSource = ref.value
  if (body.data.request !== undefined) patch.requestText = body.data.request.trim()
  if (body.data.purposeChoice !== undefined) patch.purposeChoice = body.data.purposeChoice

  const next = jobs.transition(job.id, FROM, 'queued_plan', patch)
  return next ? Response.json(toJobDto(next)) : jsonError(409, '지금은 계획을 다시 요청할 수 없는 상태예요')
}
