import type { Job } from '../../../../../src/db/jobs.ts'
import { findDeepFilter, VOICE_TOOL_MISSING } from '../../../../../src/shared/voice.ts'
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

  const patch: Partial<Job> = { stage: null }
  if (body.data.audio) patch.audioMode = body.data.audio
  if (body.data.captions) patch.captionsMode = body.data.captions
  if (body.data.quality) patch.quality = body.data.quality
  const next = found.jobs.transition(found.job.id, ['awaiting_plan'], 'queued_produce', patch)
  return next ? Response.json(toJobDto(next)) : jsonError(409, '이미 승인했거나 지금은 승인할 수 없는 상태예요')
}
