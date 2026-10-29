import fs from 'node:fs'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import nodePath from 'node:path'

// 맥·윈도우·리눅스가 다른 곳(PATH 조립, 실행 파일 찾기, 환경 변수 이름, .cmd 실행, 설치 안내)을 한 곳에 모은다.
// 플랫폼과 환경을 인자로 받는 순수 함수라서 맥에서도 윈도우 동작을 시험할 수 있다.

// Next 의 타입 정의는 NodeJS.ProcessEnv 에 NODE_ENV 를 필수로 만든다 — 여기서는 어떤 환경이든 받는 느슨한 타입을 쓰고, 자식 프로세스에 넘길 때만 ProcessEnv 로 본다
type Env = Record<string, string | undefined>
const pathFor = (platform: NodeJS.Platform) => (platform === 'win32' ? nodePath.win32 : nodePath.posix)
const delimiterFor = (platform: NodeJS.Platform) => (platform === 'win32' ? ';' : ':')

/** 윈도우는 환경 변수 이름의 대소문자를 가리지 않는다(Path·PATH). 찾는 이름과 같은 키를 돌려준다. */
function findKey(env: Env, name: string, platform: NodeJS.Platform): string | undefined {
  if (platform !== 'win32') return name in env ? name : undefined
  return Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase())
}
export const envValue = (env: Env, name: string, platform: NodeJS.Platform = process.platform): string | undefined => getEnv(env, name, platform)
const getEnv = (env: Env, name: string, platform: NodeJS.Platform): string | undefined => {
  const k = findKey(env, name, platform)
  return k === undefined ? undefined : env[k]
}

/** GUI·서비스로 실행돼도 도구를 찾을 수 있게 흔한 설치 위치를 덧붙인 기본 PATH. */
export function searchPathFor(o: { platform?: NodeJS.Platform; env?: Env; home?: string } = {}): string {
  const platform = o.platform ?? process.platform
  const env = o.env ?? process.env
  const home = o.home ?? os.homedir()
  const p = pathFor(platform)
  const extra =
    platform === 'win32'
      ? [p.join(home, '.local', 'bin'), p.join(getEnv(env, 'APPDATA', platform) ?? p.join(home, 'AppData', 'Roaming'), 'npm'), p.join(getEnv(env, 'LOCALAPPDATA', platform) ?? p.join(home, 'AppData', 'Local'), 'Microsoft', 'WinGet', 'Links')]
      : [...(platform === 'darwin' ? ['/opt/homebrew/bin'] : []), '/usr/local/bin', p.join(home, '.local/bin'), p.join(home, '.npm-global/bin')]
  return [getEnv(env, 'PATH', platform) ?? '', ...extra].filter(Boolean).join(delimiterFor(platform))
}

function realIsExecutable(platform: NodeJS.Platform) {
  return (file: string): boolean => {
    try {
      if (platform !== 'win32') fs.accessSync(file, fs.constants.X_OK)
      return fs.statSync(file).isFile()
    } catch {
      return false
    }
  }
}

/** PATH 에서 실행 파일을 찾는다. 윈도우는 확장자 없이 불러도 PATHEXT(.exe·.cmd 등) 순서로 찾는다. 없으면 null. */
export function resolveTool(name: string, searchPath: string, o: { platform?: NodeJS.Platform; pathext?: string; isExecutable?: (file: string) => boolean } = {}): string | null {
  const platform = o.platform ?? process.platform
  const p = pathFor(platform)
  const isExec = o.isExecutable ?? realIsExecutable(platform)
  const exts = platform === 'win32' ? (o.pathext ?? process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : []
  const hasExt = exts.some((e) => name.toLowerCase().endsWith(e.toLowerCase()))
  const names = platform === 'win32' && !hasExt ? exts.map((e) => name + e.toLowerCase()) : [name]
  for (const dir of searchPath.split(delimiterFor(platform))) {
    if (!dir) continue
    for (const n of names) {
      const candidate = p.join(dir, n)
      if (isExec(candidate)) return candidate
    }
  }
  return null
}

/** 자식 프로세스에 줄 환경에 PATH 를 넣는다. 윈도우는 Path·PATH 가 둘 다 들어가 어느 쪽이 쓰일지 모르게 되지 않도록 하나만 둔다. */
export function withPath(env: Env, searchPath: string, platform: NodeJS.Platform = process.platform): NodeJS.ProcessEnv {
  if (platform !== 'win32') return { ...env, PATH: searchPath } as unknown as NodeJS.ProcessEnv
  const out: Env = {}
  let key: string | undefined
  for (const [k, v] of Object.entries(env)) {
    if (k.toLowerCase() === 'path') key ??= k
    else out[k] = v
  }
  out[key ?? 'PATH'] = searchPath
  return out as unknown as NodeJS.ProcessEnv
}

/** cmd.exe 로 넘길 때 공백·따옴표·특수문자가 든 글자를 따옴표로 감싼다. */
const quoteCmd = (s: string): string => (s === '' ? '""' : /[\s"&|<>^()%!]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

/**
 * 어떻게 실행할까. 윈도우의 .cmd/.bat(npm 전역 설치 도구가 이 모양)는 Node 가 shell 없이는 실행을 거절하므로 shell 로 실행하고 인자를 따옴표로 감싼다.
 * shortcut: cmd.exe 는 인자 안의 줄바꿈과 %변수% 를 안전하게 막지 못한다 — .cmd 도구에는 한 줄짜리 인자만 넘길 것, .exe 는 영향 없음.
 */
export function spawnPlan(file: string, args: string[], platform: NodeJS.Platform = process.platform): { command: string; args: string[]; shell: boolean } {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(file)) return { command: quoteCmd(file), args: args.map(quoteCmd), shell: true }
  return { command: file, args, shell: false }
}

type Tool = 'node' | 'ffmpeg' | 'ffprobe' | 'hyperframes' | 'whisper-cli' | 'yt-dlp' | 'claude' | 'swiftc'

const WHISPER_RELEASES = 'https://github.com/ggml-org/whisper.cpp/releases'

/** 도구가 없을 때 보여 줄 설치 안내(그 컴퓨터에 맞는 명령). */
export function installHint(tool: Tool, platform: NodeJS.Platform = process.platform): string {
  const win = platform === 'win32'
  const mac = platform === 'darwin'
  switch (tool) {
    case 'node':
      return `Node.js 22 이상이 필요해요 (${mac ? 'brew install node' : win ? 'winget install OpenJS.NodeJS' : 'https://nodejs.org 에서 22 이상을 설치하세요'})`
    case 'ffmpeg':
    case 'ffprobe':
      return mac ? 'brew install ffmpeg' : win ? 'winget install Gyan.FFmpeg (설치 뒤 터미널을 다시 여세요)' : 'sudo apt install ffmpeg'
    case 'hyperframes':
      return 'npm i -g hyperframes'
    case 'whisper-cli':
      return mac ? 'brew install whisper-cpp' : win ? `${WHISPER_RELEASES} 에서 Windows 용 zip 을 받아 whisper-cli.exe 가 있는 폴더를 PATH 에 추가하세요` : `${WHISPER_RELEASES} 를 받아 빌드한 뒤 whisper-cli 를 PATH 에 두세요`
    case 'yt-dlp':
      return win ? 'winget install yt-dlp.yt-dlp' : 'uv tool install yt-dlp'
    case 'claude':
      return win ? 'PowerShell 에서 `irm https://claude.ai/install.ps1 | iex` 로 Claude Code 를 설치하고 로그인하세요' : 'Claude Code 를 설치하고 로그인하세요'
    case 'swiftc':
      return mac ? 'xcode-select --install (또는 Xcode 설치)' : '맥에서만 쓰는 도구예요 — 이 앱은 지금 쓰지 않아요'
  }
}

/** 프로세스와 그 자식들을 끝낸다. 윈도우는 process.kill 이 자식을 안 끝내서 taskkill 의 /T(트리)를 쓴다. */
export function killProcessTree(pid: number | undefined, platform: NodeJS.Platform = process.platform): void {
  if (pid === undefined) return
  try {
    if (platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    else process.kill(pid, 'SIGKILL')
  } catch {
    // 이미 끝났다
  }
}
