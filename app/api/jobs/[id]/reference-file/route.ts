import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import { isQueued, isRunning } from '../../../../../src/db/status.ts'
import { toJobDto } from '../../../../../src/web/dto.ts'
import { allowedExt, assertSameOrigin, jsonError, loadJob, saveUpload, UNSUPPORTED_FORMAT_MESSAGE, uploadFailure } from '../../../../../src/web/http.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 레퍼런스로 쓸 영상 파일을 올린다(올릴 때마다 새 이름). 올린 파일 경로만 기록하고, 실제로 쓸지는 plan 요청에서 정한다. */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = assertSameOrigin(req)
  if (blocked) return blocked
  const found = await loadJob(ctx.params)
  if ('res' in found) return found.res
  const { job, jobs } = found
  // 순서를 기다리는 중(queued_*)에도 막는다 — 워커가 집기 직전에 파일이 바뀌거나 지워지면 안 된다
  if (isRunning(job.status) || isQueued(job.status)) return jsonError(409, '작업이 진행 중이라 지금은 레퍼런스를 올릴 수 없어요')

  const name = new URL(req.url).searchParams.get('name')
  const ext = allowedExt(name)
  if (!ext) return jsonError(400, UNSUPPORTED_FORMAT_MESSAGE)
  if (!req.body) return jsonError(400, '영상 파일이 비어 있어요')

  let saved: { path: string }
  try {
    // 올릴 때마다 새 이름 — 같은 이름으로 덮어쓰면 "같은 레퍼런스"로 보여 이전 분석 결과가 다시 쓰인다
    saved = await saveUpload(req.body, jobs.jobDir(job.id), `reference-upload-${randomBytes(4).toString('hex')}${ext}`)
  } catch (e) {
    return uploadFailure(e)
  }
  // 이전 업로드는 지운다. 다만 아직 레퍼런스로 쓰이는 중(referenceSource)이면 남겨 둔다 — 새 파일은 plan 요청에서 'uploaded' 로 고를 때 바뀐다
  if (job.referenceUploadPath && job.referenceUploadPath !== saved.path && job.referenceUploadPath !== job.referenceSource) fs.rmSync(job.referenceUploadPath, { force: true })
  return Response.json(toJobDto(jobs.update(job.id, { referenceUploadPath: saved.path })))
}
