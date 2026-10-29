import { canRemix, clampGainDb, SOUND_NOT_REMIXABLE } from '../../../../../src/shared/sound.ts'
import { toJobDto } from '../../../../../src/web/dto.ts'
import { assertSameOrigin, jsonError, loadJob, readBody } from '../../../../../src/web/http.ts'
import { RemixBody } from '../../../../../src/web/schemas.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 결과 화면에서 음악·효과음 크기를 바꿔 소리만 다시 섞는다. awaiting_confirm → queued_produce.
 * 제작 단계가 remixPending 을 보고 영상은 다시 그리지 않고 소리만 다시 섞는다. 같은 요청을 두 번 보내면 한 번만 처리된다.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = assertSameOrigin(req)
  if (blocked) return blocked
  const found = await loadJob(ctx.params)
  if ('res' in found) return found.res
  const body = await readBody(req, RemixBody)
  if ('res' in body) return body.res

  if (!canRemix(found.job.resultPath)) return jsonError(409, SOUND_NOT_REMIXABLE)
  const soundGain = { bgmGainDb: clampGainDb(body.data.bgmGainDb), sfxGainDb: clampGainDb(body.data.sfxGainDb) }
  const next = found.jobs.transition(found.job.id, ['awaiting_confirm'], 'queued_produce', { soundGain, remixPending: true, errorMessage: null, stage: null })
  return next ? Response.json(toJobDto(next)) : jsonError(409, '결과가 나온 작업만 소리를 다시 섞을 수 있어요')
}
