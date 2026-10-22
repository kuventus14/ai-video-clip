import { loadCatalog, SoundError } from '../../../src/shared/sound.ts'
import { toSoundListDto } from '../../../src/web/dto.ts'
import { assertLocalHost, jsonError } from '../../../src/web/http.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 계획 승인 화면에서 고를 수 있는 배경음악 목록과 효과음 개수. */
export async function GET(req: Request) {
  const wrongHost = assertLocalHost(req)
  if (wrongHost) return wrongHost
  try {
    return Response.json(toSoundListDto(loadCatalog()))
  } catch (e) {
    if (e instanceof SoundError) return jsonError(500, e.message)
    throw e
  }
}
