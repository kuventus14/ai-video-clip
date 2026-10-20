import fs from 'node:fs'
import { toJobDto } from '../../../../../src/web/dto.ts'
import { allowedExt, assertSameOrigin, jsonError, loadJob, saveUpload, UNSUPPORTED_FORMAT_MESSAGE, uploadFailure } from '../../../../../src/web/http.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 영상을 올린다. 본문을 파일로 스트리밍하고(?name= 은 확장자 확인과 표시용), 끝나면 워커의 확인 단계(queued_probe)로 보낸다. */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = assertSameOrigin(req)
  if (blocked) return blocked
  const found = await loadJob(ctx.params)
  if ('res' in found) return found.res
  const { job, jobs } = found
  if (job.status !== 'created') return jsonError(409, '이미 영상을 올린 작업이에요')

  const name = new URL(req.url).searchParams.get('name')
  const ext = allowedExt(name)
  if (!ext) return jsonError(400, UNSUPPORTED_FORMAT_MESSAGE)
  if (!req.body) return jsonError(400, '영상 파일이 비어 있어요')

  let saved: { path: string }
  try {
    saved = await saveUpload(req.body, jobs.jobDir(job.id), `source${ext}`)
  } catch (e) {
    return uploadFailure(e)
  }
  const next = jobs.transition(job.id, ['created'], 'queued_probe', { sourceName: name!.slice(0, 200), sourcePath: saved.path })
  if (!next) {
    fs.rmSync(saved.path, { force: true })
    return jsonError(409, '이미 영상을 올린 작업이에요')
  }
  return Response.json(toJobDto(next))
}
