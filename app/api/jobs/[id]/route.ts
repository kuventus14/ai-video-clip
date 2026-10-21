import { toJobDto } from '../../../../src/web/dto.ts'
import { assertLocalHost, assertSameOrigin, jsonError, loadJob } from '../../../../src/web/http.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const wrongHost = assertLocalHost(req)
  if (wrongHost) return wrongHost
  const found = await loadJob(ctx.params)
  if ('res' in found) return found.res
  return Response.json(toJobDto(found.job))
}

/** 작업과 그 폴더(영상·결과)를 지운다. 실행 중인 작업은 지울 수 없다. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = assertSameOrigin(req)
  if (blocked) return blocked
  const found = await loadJob(ctx.params)
  if ('res' in found) return found.res
  try {
    found.jobs.remove(found.job.id)
  } catch (e) {
    return jsonError(409, (e as Error).message)
  }
  return Response.json({ ok: true })
}
