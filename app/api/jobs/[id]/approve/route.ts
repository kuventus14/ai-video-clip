import type { Job } from '../../../../../src/db/jobs.ts'
import { findDeepFilter, VOICE_TOOL_MISSING } from '../../../../../src/shared/voice.ts'
import { loadCatalog, SoundError, soundChoiceProblem } from '../../../../../src/shared/sound.ts'
import { toJobDto } from '../../../../../src/web/dto.ts'
import { assertSameOrigin, jsonError, loadJob, readBody } from '../../../../../src/web/http.ts'
import { ApproveBody } from '../../../../../src/web/schemas.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** "이렇게 이해했어요"를 승인하고 제작을 시작한다. awaiting_plan → queued_produce. 같은 승인을 두 번 보내면 한 번만 처리된다. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = assertSameOrigin(req)
  if (blocked) return blocked
  const found = await loadJob(ctx.params)
  if ('res' in found) return found.res
  const body = await readBody(req, ApproveBody)
  if ('res' in body) return body.res

  // 도구가 없는데 목소리 보정을 고르면 제작을 시작한 뒤에 실패하지 않도록 여기서 알린다
  if (body.data.audio === 'voice' && !findDeepFilter()) return jsonError(400, VOICE_TOOL_MISSING)

  // 고른 배경음악·효과음이 지금 음원 목록에 있는지도 여기서 확인한다(이전에 골라 둔 값 포함) — 제작 도중에 실패하지 않도록
  const bgm = body.data.bgm === undefined ? found.job.bgmId : body.data.bgm
  const sfx = body.data.sfx ?? found.job.sfxMode
  if (bgm || sfx === 'on') {
    try {
      const problem = soundChoiceProblem(loadCatalog(), bgm, sfx)
      if (problem) return jsonError(400, problem)
    } catch (e) {
      if (e instanceof SoundError) return jsonError(400, e.message)
      throw e
    }
  }

  const patch: Partial<Job> = { stage: null }
  if (body.data.audio) patch.audioMode = body.data.audio
  if (body.data.bgm !== undefined) patch.bgmId = body.data.bgm
  if (body.data.sfx) patch.sfxMode = body.data.sfx
  if (body.data.captions) patch.captionsMode = body.data.captions
  if (body.data.quality) patch.quality = body.data.quality
  const next = found.jobs.transition(found.job.id, ['awaiting_plan'], 'queued_produce', patch)
  return next ? Response.json(toJobDto(next)) : jsonError(409, '이미 승인했거나 지금은 승인할 수 없는 상태예요')
}
