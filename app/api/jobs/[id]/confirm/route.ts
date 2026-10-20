import { toJobDto } from '../../../../../src/web/dto.ts'
import { assertSameOrigin, jsonError, loadJob } from '../../../../../src/web/http.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 결과를 확정한다(기록에 저장). awaiting_confirm → confirmed */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = assertSameOrigin(req)
  if (blocked) return blocked
  const found = await loadJob(ctx.params)
  if ('res' in found) return found.res
  const next = found.jobs.transition(found.job.id, ['awaiting_confirm'], 'confirmed', { confirmedAt: new Date().toISOString() })
  return next ? Response.json(toJobDto(next)) : jsonError(409, '결과가 나온 작업만 확정할 수 있어요')
}
