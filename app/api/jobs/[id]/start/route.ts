import { toJobDto } from '../../../../../src/web/dto.ts'
import { resolveReference } from '../../../../../src/web/flow.ts'
import { assertSameOrigin, jsonError, loadJob, readBody } from '../../../../../src/web/http.ts'
import { StartBody } from '../../../../../src/web/schemas.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 설명·용도·(선택)레퍼런스를 정하고 분석을 시작한다. ready → queued_analysis */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = assertSameOrigin(req)
  if (blocked) return blocked
  const found = await loadJob(ctx.params)
  if ('res' in found) return found.res
  const body = await readBody(req, StartBody)
  if ('res' in body) return body.res
  const ref = resolveReference(found.job, body.data.reference)
  if (!ref.ok) return ref.res

  const next = found.jobs.transition(found.job.id, ['ready'], 'queued_analysis', {
    description: body.data.description?.trim() ?? '',
    purposeChoice: body.data.purposeChoice,
    referenceSource: ref.value ?? null,
    stage: null,
  })
  return next ? Response.json(toJobDto(next)) : jsonError(409, '지금은 분석을 시작할 수 없는 상태예요')
}
