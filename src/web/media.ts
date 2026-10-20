import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { jsonError } from './http.ts'

const CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.jpg': 'image/jpeg',
}

export const contentTypeOf = (file: string) => CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream'

/** `bytes=a-b` / `bytes=a-` / `bytes=-n` 한 구간만 지원한다. 범위가 아니거나 모르는 형식이면 null(전체 응답). */
function parseRange(header: string | null, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  const m = header?.match(/^bytes=(\d*)-(\d*)$/)
  if (!m || (m[1] === '' && m[2] === '')) return null
  if (m[1] === '') {
    const n = Number(m[2])
    return n === 0 ? 'unsatisfiable' : { start: Math.max(0, size - n), end: size - 1 }
  }
  const start = Number(m[1])
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  return start >= size || end < start ? 'unsatisfiable' : { start, end }
}

/** 파일을 스트리밍으로 돌려준다. 영상 미리보기가 구간을 건너뛸 수 있게 Range(206)를 지원한다. */
export function rangeResponse(file: string, req: Request, contentType = contentTypeOf(file)): Response {
  let size: number
  try {
    size = fs.statSync(file).size
  } catch {
    return jsonError(404, '파일을 찾을 수 없어요')
  }
  const base = { 'Content-Type': contentType, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' }
  const range = parseRange(req.headers.get('range'), size)
  if (range === 'unsatisfiable') return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } })

  const [start, end, status] = range ? [range.start, range.end, 206] : [0, size - 1, 200]
  const headers: Record<string, string> = { ...base, 'Content-Length': String(size === 0 ? 0 : end - start + 1) }
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
  if (size === 0) return new Response(null, { status: 200, headers })
  return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })) as unknown as ReadableStream, { status, headers })
}
