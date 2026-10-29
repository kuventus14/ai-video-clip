import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { defaultSearchPath, run } from './exec.ts'
import { installHint, resolveTool, withPath } from './platform.ts'

export { defaultSearchPath }

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

const VERSION_ARGS: Record<ToolName, string[] | null> = {
  node: ['--version'],
  ffmpeg: ['-version'],
  ffprobe: ['-version'],
  hyperframes: ['--version'],
  'whisper-cli': null,
  'yt-dlp': ['--version'],
  claude: ['--version'],
  swiftc: ['--version'],
}

/** 앱이 쓰지 않는 도구(사람 추적용 Swift 컴파일러, 맥 전용) — 없어도 환경은 정상이다 */
const NOT_NEEDED: ToolName[] = ['swiftc']

export async function checkEnvironment(opts: { path?: string; platform?: NodeJS.Platform; isExecutable?: (file: string) => boolean; modelPath?: string } = {}): Promise<EnvReport> {
  const platform = opts.platform ?? process.platform
  const searchPath = opts.path ?? defaultSearchPath()
  const env = withPath(process.env, searchPath)
  const names = Object.keys(VERSION_ARGS) as ToolName[]

  const entries = await Promise.all(
    names.map(async (name): Promise<[ToolName, ToolStatus]> => {
      const versionArgs = VERSION_ARGS[name]
      const found = resolveTool(name, searchPath, { platform, isExecutable: opts.isExecutable })
      if (!found) return [name, { ok: false, hint: installHint(name, platform) }]
      if (!versionArgs) return [name, { ok: true }]
      try {
        const { stdout, stderr } = await run(found, versionArgs, { env, timeoutMs: 15_000 })
        const first = (stdout || stderr).split('\n')[0]?.trim()
        return [name, { ok: true, version: first }]
      } catch {
        return [name, { ok: true }]
      }
    }),
  )

  const tools = Object.fromEntries(entries) as Record<ToolName, ToolStatus>
  const modelPath = opts.modelPath ?? WHISPER_MODEL_PATH
  const whisperModel = { ok: fs.existsSync(modelPath), path: modelPath }
  const ok = names.filter((n) => !NOT_NEEDED.includes(n)).every((n) => tools[n].ok) && whisperModel.ok
  return { ok, tools, whisperModel }
}
