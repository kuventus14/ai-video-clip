import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run, ToolError } from './exec.ts'
import { probeVideo } from './media.ts'
import type { VideoInfo } from './types.ts'

/** 이름이 자바스크립트 내장 ReferenceError 와 겹치지 않도록 ReferenceFetchError 로 둔다. */
export class ReferenceFetchError extends Error {
  kind: 'not-found' | 'unreachable' | 'private' | 'unsupported'
  constructor(kind: ReferenceFetchError['kind'], message: string) {
    super(message)
    this.name = 'ReferenceFetchError'
    this.kind = kind
  }
}

export function classifySource(s: string): 'file' | 'youtube' | 'instagram' | 'other-url' {
  if (!/^https?:\/\//i.test(s)) return 'file'
  let host = ''
  try {
    host = new URL(s).hostname.toLowerCase()
  } catch {
    return 'other-url'
  }
  if (host === 'youtu.be' || host.endsWith('youtube.com')) return 'youtube'
  if (host.endsWith('instagram.com')) return 'instagram'
  return 'other-url'
}

export interface FetchedReference {
  path: string
  info: VideoInfo
  origin: 'file' | 'url'
  /** 내려받거나 복사한 레퍼런스 파일을 지운다 (원본 파일은 건드리지 않는다) */
  cleanup(): Promise<void>
}

const SECTION = '*0-180' // 앞 3분만 받는다
const NOT_VIDEO_PARTS = /\.(part|ytdl|temp|tmp)$/i

function mapYtdlpError(e: unknown): ReferenceFetchError {
  const text = e instanceof ToolError ? `${e.stderr}\n${e.message}` : String(e)
  if (/private video|sign in|log ?in|members-only|confirm your age|cookies/i.test(text))
    return new ReferenceFetchError('private', '비공개이거나 로그인이 필요한 영상이에요. 영상을 mp4 파일로 직접 올려 주세요.')
  if (/unsupported url/i.test(text)) return new ReferenceFetchError('unsupported', '지원하지 않는 주소예요. 유튜브·인스타 링크이거나 mp4 파일을 올려 주세요.')
  return new ReferenceFetchError('unreachable', '레퍼런스 영상을 내려받지 못했어요. 링크를 확인하거나 mp4 파일로 올려 주세요.')
}

export async function fetchReference(src: string, workDir: string, deps: { run?: typeof run } = {}): Promise<FetchedReference> {
  const exec = deps.run ?? run
  fs.mkdirSync(workDir, { recursive: true })
  const cleanup = async () => {
    for (const f of fs.readdirSync(workDir)) if (f.startsWith('reference.')) fs.rmSync(path.join(workDir, f), { force: true })
  }

  if (classifySource(src) === 'file') {
    const from = src.startsWith('~') ? path.join(os.homedir(), src.slice(1)) : src
    if (!fs.existsSync(from)) throw new ReferenceFetchError('not-found', `레퍼런스 파일을 찾을 수 없어요: ${src}`)
    const dest = path.join(workDir, `reference${path.extname(from) || '.mp4'}`)
    fs.copyFileSync(from, dest)
    try {
      return { path: dest, info: await probeVideo(dest), origin: 'file', cleanup }
    } catch (e) {
      await cleanup()
      if (e instanceof ToolError) throw new ReferenceFetchError('unsupported', '레퍼런스 파일을 영상으로 읽을 수 없어요.')
      throw e
    }
  }

  const args = [
    '-f', 'bv*[height<=1080]+ba/b',
    '--merge-output-format', 'mp4',
    '--download-sections', SECTION,
    '--no-playlist', '--no-warnings',
    '-o', path.join(workDir, 'reference.%(ext)s'),
    src,
  ]
  try {
    await exec('yt-dlp', args, { timeoutMs: 10 * 60_000 })
  } catch (e) {
    await cleanup()
    throw mapYtdlpError(e)
  }

  const got = fs.readdirSync(workDir).filter((f) => f.startsWith('reference.') && !NOT_VIDEO_PARTS.test(f))
  const file = got.find((f) => f.endsWith('.mp4')) ?? got[0]
  if (!file) throw new ReferenceFetchError('unreachable', '레퍼런스 영상을 내려받지 못했어요. 링크를 확인하거나 mp4 파일로 올려 주세요.')
  const p = path.join(workDir, file)
  return { path: p, info: await probeVideo(p), origin: 'url', cleanup }
}
