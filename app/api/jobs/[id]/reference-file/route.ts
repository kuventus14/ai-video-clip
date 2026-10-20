import fs from 'node:fs'
import { isRunning } from '../../../../../src/db/status.ts'
import { toJobDto } from '../../../../../src/web/dto.ts'
import { allowedExt, assertSameOrigin, jsonError, loadJob, saveUpload, UNSUPPORTED_FORMAT_MESSAGE, uploadFailure } from '../../../../../src/web/http.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 레퍼런스로 쓸 영상 파일을 올린다. 올린 파일 경로만 기록하고, 실제로 쓸지는 plan 요청에서 정한다. */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = assertSameOrigin(req)
  if (blocked) return blocked
  const found = await loadJob(ctx.params)
  if ('res' in found) return found.res
  const { job, jobs } = found
  if (isRunning(job.status)) return jsonError(409, '작업이 진행 중이라 지금은 레퍼런스를 올릴 수 없어요')

  const name = new URL(req.url).searchParams.get('name')
  const ext = allowedExt(name)
  if (!ext) return jsonError(400, UNSUPPORTED_FORMAT_MESSAGE)
  if (!req.body) return jsonError(400, '영상 파일이 비어 있어요')

  let saved: { path: string }
  try {
    saved = await saveUpload(req.body, jobs.jobDir(job.id), `reference-upload${ext}`)
  } catch (e) {
    return uploadFailure(e)
  }
  // 확장자가 다른 이전 업로드는 지운다
  if (job.referenceUploadPath && job.referenceUploadPath !== saved.path) fs.rmSync(job.referenceUploadPath, { force: true })
  return Response.json(toJobDto(jobs.update(job.id, { referenceUploadPath: saved.path })))
}
