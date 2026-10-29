import { removeRemixFiles } from '../../../../../src/shared/sound.ts'
import { toJobDto } from '../../../../../src/web/dto.ts'
import { assertSameOrigin, jsonError, loadJob } from '../../../../../src/web/http.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 결과를 확정한다(기록에 저장). awaiting_confirm → confirmed. 다시 섞기용 파일(dry.mp4·mix.json)은 이때 지운다. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = assertSameOrigin(req)
  if (blocked) return blocked
  const found = await loadJob(ctx.params)
  if ('res' in found) return found.res
  const next = found.jobs.transition(found.job.id, ['awaiting_confirm'], 'confirmed', { confirmedAt: new Date().toISOString() })
  if (!next) return jsonError(409, '결과가 나온 작업만 확정할 수 있어요')
  removeRemixFiles(next.resultPath) // 확정하면 소리를 다시 섞을 수 없으니 영상 한 편 분량의 복사본을 남기지 않는다
  return Response.json(toJobDto(next))
}
