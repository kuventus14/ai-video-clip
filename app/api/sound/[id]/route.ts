import { findTrack, loadCatalog, SoundError, trackPath } from '../../../../src/shared/sound.ts'
import { assertLocalHost, jsonError } from '../../../../src/web/http.ts'
import { rangeResponse } from '../../../../src/web/media.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 음원 미리듣기. 목록에 있는 id 만 열어 준다(파일 경로를 직접 받지 않는다). Range 지원. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const wrongHost = assertLocalHost(req)
  if (wrongHost) return wrongHost
  const { id } = await ctx.params
  try {
    const catalog = loadCatalog()
    const track = findTrack(catalog, id)
    if (!track) return jsonError(404, '음원을 찾을 수 없어요')
    return rangeResponse(trackPath(catalog, track), req)
  } catch (e) {
    if (e instanceof SoundError) return jsonError(500, e.message)
    throw e
  }
}
