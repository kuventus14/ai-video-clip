import { assertLocalHost, jsonError, loadJob } from '../../../../../../src/web/http.ts'
import { rangeResponse } from '../../../../../../src/web/media.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 올린 영상·결과 영상·썸네일을 스트리밍한다(Range 지원). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; kind: string }> }) {
  const wrongHost = assertLocalHost(req)
  if (wrongHost) return wrongHost
  const found = await loadJob(ctx.params)
  if ('res' in found) return found.res
  const { kind } = await ctx.params
  const { job } = found
  const file = kind === 'source' ? job.sourcePath : kind === 'result' ? job.resultPath : kind === 'thumb' ? job.thumbPath : kind === 'reference' ? job.referenceUploadPath : null
  if (!file) return jsonError(404, '파일을 찾을 수 없어요')
  return rangeResponse(file, req)
}
