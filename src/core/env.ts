import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run } from './exec.ts'

export type ToolName = 'node' | 'ffmpeg' | 'ffprobe' | 'hyperframes' | 'whisper-cli' | 'yt-dlp' | 'claude' | 'swiftc'

export interface ToolStatus {
  ok: boolean
  version?: string
  hint?: string
}

export interface EnvReport {
  ok: boolean
  tools: Record<ToolName, ToolStatus>
  whisperModel: { ok: boolean; path: string }
}

export const WHISPER_MODEL_PATH = path.join(os.homedir(), '.cache/hyperframes/whisper/models/ggml-small.bin')

/** GUI·서비스로 실행돼도 도구를 찾을 수 있게 흔한 설치 위치를 덧붙인 기본 PATH. */
export function defaultSearchPath(): string {
  const home = os.homedir()
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.local/bin'), path.join(home, '.npm-global/bin')]
  return [process.env.PATH ?? '', ...extra].filter(Boolean).join(path.delimiter)
}

const SPEC: Record<ToolName, { versionArgs: string[] | null; hint: string }> = {
  node: { versionArgs: ['--version'], hint: 'Node.js 22 이상이 필요해요 (brew install node)' },
  ffmpeg: { versionArgs: ['-version'], hint: 'brew install ffmpeg' },
  ffprobe: { versionArgs: ['-version'], hint: 'brew install ffmpeg' },
  hyperframes: { versionArgs: ['--version'], hint: 'npm i -g hyperframes' },
  'whisper-cli': { versionArgs: null, hint: 'brew install whisper-cpp' },
  'yt-dlp': { versionArgs: ['--version'], hint: 'uv tool install yt-dlp' },
  claude: { versionArgs: ['--version'], hint: 'Claude Code 를 설치하고 로그인하세요' },
  swiftc: { versionArgs: ['--version'], hint: 'xcode-select --install (또는 Xcode 설치)' },
}

function findOnPath(name: string, searchPath: string): string | null {
  for (const dir of searchPath.split(path.delimiter)) {
    if (!dir) continue
    const candidate = path.join(dir, name)
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      if (fs.statSync(candidate).isFile()) return candidate
    } catch {
      // 다음 후보
    }
  }
  return null
}

export async function checkEnvironment(opts: { path?: string } = {}): Promise<EnvReport> {
  const searchPath = opts.path ?? defaultSearchPath()
  const env = { ...process.env, PATH: searchPath }
  const names = Object.keys(SPEC) as ToolName[]

  const entries = await Promise.all(
    names.map(async (name): Promise<[ToolName, ToolStatus]> => {
      const spec = SPEC[name]
      const found = findOnPath(name, searchPath)
      if (!found) return [name, { ok: false, hint: spec.hint }]
      if (!spec.versionArgs) return [name, { ok: true }]
      try {
        const { stdout, stderr } = await run(found, spec.versionArgs, { env, timeoutMs: 15_000 })
        const first = (stdout || stderr).split('\n')[0]?.trim()
        return [name, { ok: true, version: first }]
      } catch {
        return [name, { ok: true }]
      }
    }),
  )

  const tools = Object.fromEntries(entries) as Record<ToolName, ToolStatus>
  const whisperModel = { ok: fs.existsSync(WHISPER_MODEL_PATH), path: WHISPER_MODEL_PATH }
  const ok = names.every((n) => tools[n].ok) && whisperModel.ok
  return { ok, tools, whisperModel }
}
