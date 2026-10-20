import { toJobDto } from '../../../../../src/web/dto.ts'
import { cloneForOtherVersion } from '../../../../../src/web/flow.ts'
import { assertSameOrigin, jsonError, loadJob } from '../../../../../src/web/http.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 같은 영상의 반대 용도 버전(가로↔세로)을 새 작업으로 만든다. 원본·분석·계획을 가져와 계획 단계에서 시작한다. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = assertSameOrigin(req)
  if (blocked) return blocked
  const found = await loadJob(ctx.params)
  if ('res' in found) return found.res
  const { job, jobs } = found
  if (job.status !== 'awaiting_confirm' && job.status !== 'confirmed') return jsonError(409, '결과가 나온 작업에서만 다른 버전을 만들 수 있어요')

  const cloned = cloneForOtherVersion(jobs, job)
  if ('error' in cloned) return jsonError(409, cloned.error)
  return Response.json(toJobDto(cloned.child), { status: 201 })
}
