import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Job, Jobs } from '../db/jobs.ts'
import { getContext } from './context.ts'

export function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status })
}

export function parseJobId(id: string): string | null {
  return /^[a-f0-9]{10}$/.test(id) ? id : null
}

/**
 * 변경 요청(POST/PUT/DELETE)은 Origin 이 있으면 Host 와 같아야 통과한다.
 * 다른 사이트가 내 로컬 앱에 요청을 보내 영상을 지우거나 내려받게 하는 것을 막는다. Origin 이 없는 호출(curl)은 허용.
 */
export function assertSameOrigin(req: Request): Response | null {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return null
  const origin = req.headers.get('origin')
  if (!origin) return null
  let originHost: string
  try {
    originHost = new URL(origin).host
  } catch {
    return jsonError(403, '허용되지 않은 요청이에요')
  }
  const host = req.headers.get('host') ?? new URL(req.url).host
  return originHost === host ? null : jsonError(403, '다른 사이트에서 보낸 요청은 받을 수 없어요')
}

/** 올릴 수 있는 영상 확장자. 사용자가 보낸 파일 이름은 디스크 경로에 쓰지 않고 이 확장자만 쓴다. */
export const VIDEO_EXTS = ['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi'] as const

export function allowedExt(name: string | null): string | null {
  if (!name) return null
  const ext = path.extname(name).toLowerCase()
  return (VIDEO_EXTS as readonly string[]).includes(ext) ? ext : null
}

export const UNSUPPORTED_FORMAT_MESSAGE = `지원하지 않는 형식이에요 (${VIDEO_EXTS.map((e) => e.slice(1)).join(', ')})`

/** 경로의 작업 id 를 검사해 작업을 읽는다. 잘못된 id 는 400, 없으면 404 응답을 돌려준다. */
export async function loadJob(params: Promise<{ id: string }>): Promise<{ job: Job; jobs: Jobs } | { res: Response }> {
  const { id } = await params
  if (!parseJobId(id)) return { res: jsonError(400, '잘못된 작업 주소예요') }
  const { jobs } = getContext()
  const job = jobs.get(id)
  return job ? { job, jobs } : { res: jsonError(404, '작업을 찾을 수 없어요') }
}

export class EmptyUploadError extends Error {}

/**
 * 요청 본문을 파일로 스트리밍해 저장한다(통째로 메모리에 올리지 않는다).
 * 임시 이름(.part)으로 쓰다가 끝나면 이름을 바꾸고, 도중에 끊기거나 비어 있으면 임시 파일을 지운다.
 */
export async function saveUpload(body: ReadableStream<Uint8Array>, dir: string, finalName: string): Promise<{ path: string; bytes: number }> {
  const tmp = path.join(dir, `${finalName}.part`)
  const finalPath = path.join(dir, finalName)
  try {
    await pipeline(Readable.fromWeb(body as never), fs.createWriteStream(tmp))
    const bytes = fs.statSync(tmp).size
    if (bytes === 0) throw new EmptyUploadError('빈 파일이에요')
    fs.renameSync(tmp, finalPath)
    return { path: finalPath, bytes }
  } catch (e) {
    fs.rmSync(tmp, { force: true })
    throw e
  }
}

/** saveUpload 의 실패를 사용자에게 보여 줄 응답으로 바꾼다. */
export function uploadFailure(e: unknown): Response {
  if (e instanceof EmptyUploadError) return jsonError(400, '빈 파일이에요. 영상을 다시 골라 주세요.')
  return jsonError(400, '업로드가 중간에 끊겼어요. 다시 올려 주세요.')
}
