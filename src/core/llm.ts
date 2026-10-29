// claude CLI 를 하위 프로세스로 띄우는 호출기. 선례: ~/ai-staff/lib/claude.mjs
// 부모 환경을 그대로 물려주면 CLAUDECODE / CLAUDE_CODE_SESSION_ID 가 딸려 들어가 자식이 중첩 세션으로 착각해 영영 멈춘다
// → 화이트리스트로 환경을 새로 짓는다.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import type { ZodType } from 'zod'
import { envValue, killProcessTree, pathFor, prepareSpawn, searchPathFor, spawnArgs, withPath } from './platform.ts'

export class LlmError extends Error {
  kind: 'spawn' | 'timeout' | 'invalid-json' | 'schema'
  constructor(kind: LlmError['kind'], message: string) {
    super(message)
    this.name = 'LlmError'
    this.kind = kind
  }
}

export interface AskOpts {
  prompt: string
  system?: string
  /** 함께 보여줄 이미지 파일(JPEG) 경로 */
  images?: string[]
  model?: string
  effort?: 'low' | 'medium' | 'high'
  timeoutMs?: number
  /** 자식 프로세스에 더 넘길 환경변수 */
  env?: Record<string, string>
}

const SAFE_KEYS = ['HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'SSH_AUTH_SOCK', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']
/** 윈도우에서 프로그램이 돌려면 필요한 변수(없으면 claude 가 시작도 못 한다). Git for Windows 의 bash 위치를 직접 정해 둔 경우도 넘긴다. */
const WINDOWS_KEYS = ['SystemRoot', 'SystemDrive', 'windir', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'TEMP', 'TMP', 'ComSpec', 'PATHEXT', 'USERNAME', 'USERDOMAIN', 'OS', 'PROCESSOR_ARCHITECTURE', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_GIT_BASH_PATH']

/**
 * claude 를 부를 때 자식 프로세스에 줄 환경. 아무 변수나 넘기지 않고 화이트리스트로 새로 짓는다.
 * 맥은 정해 둔 위치만 PATH 로 쓰고(예전 그대로), 리눅스·윈도우는 지금 PATH 도 함께 쓴다(nvm·Git for Windows 등으로 깔린 도구를 찾게).
 */
export function cleanEnv(extra: Record<string, string> = {}, o: { platform?: NodeJS.Platform; env?: Record<string, string | undefined>; home?: string } = {}): NodeJS.ProcessEnv {
  const platform = o.platform ?? process.platform
  const src = o.env ?? process.env
  const home = o.home ?? os.homedir()
  const env: Record<string, string> = {} // Next 의 타입 정의는 NODE_ENV 를 필수로 만든다 — 여기서는 화이트리스트로 짓는 빈 환경이라 느슨한 타입으로 짓는다
  if (platform === 'win32') {
    for (const k of WINDOWS_KEYS) {
      const v = envValue(src, k, platform)
      if (v) env[k] = v
    }
    return { ...withPath(env, searchPathFor({ platform, env: src, home }), platform), ...extra } as NodeJS.ProcessEnv
  }
  for (const k of SAFE_KEYS) if (src[k]) env[k] = src[k]!
  env.HOME ||= home
  env.LANG ||= 'ko_KR.UTF-8'
  const p = pathFor(platform)
  const fixed = ['/usr/local/bin', ...(platform === 'darwin' ? ['/opt/homebrew/bin'] : []), p.join(home, '.npm-global/bin'), p.join(home, '.local/bin'), '/usr/bin', '/bin', '/usr/sbin', '/sbin']
  // 맥은 정해 둔 위치만(예전 그대로). 리눅스는 지금 PATH 를 앞에 둔다 — 정해 둔 /usr/bin 의 오래된 node 가 nvm 으로 깐 node 를 가리지 않게
  env.PATH = (platform === 'darwin' ? fixed : [...(src.PATH ?? '').split(':').filter(Boolean), ...fixed]).join(':')
  return { ...env, ...extra } as unknown as NodeJS.ProcessEnv
}

function runClaude(o: AskOpts): Promise<string> {
  const timeoutMs = o.timeoutMs ?? 360_000
  return new Promise((resolve, reject) => {
    const args = [
      '-p', '--model', o.model ?? 'sonnet',
      '--output-format', 'stream-json', '--verbose',
      '--strict-mcp-config', '--mcp-config', JSON.stringify({ mcpServers: {} }),
      '--disable-slash-commands', '--no-session-persistence',
      '--tools', '',
    ]
    if (o.system) args.push('--append-system-prompt', o.system)
    if (o.effort) args.push('--effort', o.effort)
    const images = o.images ?? []
    if (images.length) args.push('--input-format', 'stream-json')

    const env = cleanEnv(o.env)
    const plan = prepareSpawn(process.env.VAE_CLAUDE_BIN || 'claude', args, env)
    const [command, commandArgs] = spawnArgs(plan)
    const child = spawn(command, commandArgs, { cwd: os.tmpdir(), env, stdio: ['pipe', 'pipe', 'pipe'], shell: plan.shell, windowsHide: true })
    let buf = ''
    let stderr = ''
    let result: { is_error?: boolean; result?: unknown } | null = null
    let settled = false

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    const timer = setTimeout(() => {
      killProcessTree(child.pid)
      finish(() => reject(new LlmError('timeout', `claude 응답 시간 초과 (${Math.round(timeoutMs / 1000)}초)`)))
    }, timeoutMs)

    const handleLine = (line: string) => {
      const t = line.trim()
      if (!t) return
      try {
        const e = JSON.parse(t) as { type?: string; is_error?: boolean; result?: unknown }
        if (e.type === 'result') result = e // 최종 답은 assistant 블록과 result 로 두 번 오므로 result 만 쓴다
      } catch {
        // JSON 이 아닌 줄은 무시
      }
    }

    child.stdout.on('data', (d: Buffer) => {
      buf += d.toString('utf8')
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        handleLine(buf.slice(0, i))
        buf = buf.slice(i + 1)
      }
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString('utf8')).slice(-2000)
    })
    child.on('error', (err) => finish(() => reject(new LlmError('spawn', `claude 를 실행할 수 없어요: ${err.message}`))))
    child.on('close', (code) => {
      handleLine(buf)
      const r = result as { is_error?: boolean; result?: unknown } | null
      if (r && !r.is_error) return finish(() => resolve(String(r.result ?? '')))
      const detail = r?.result ? `claude 오류: ${String(r.result).slice(0, 300)}` : `claude 종료 코드 ${code}: ${stderr.trim().slice(-300) || '출력 없음'}`
      finish(() => reject(new LlmError('spawn', detail)))
    })
    child.stdin.on('error', () => {})

    if (!images.length) child.stdin.end(o.prompt)
    else {
      const content: unknown[] = []
      images.forEach((file, i) => {
        content.push(
          { type: 'text', text: `이미지 ${i + 1}` },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(file).toString('base64') } },
        )
      })
      content.push({ type: 'text', text: o.prompt })
      child.stdin.end(JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n')
    }
  })
}

/** 응답 텍스트에서 첫 JSON 값을 꺼낸다 (코드펜스·잡담 허용, 문자열 안의 괄호는 무시). */
export function extractJson(text: string): unknown {
  const t = text.replace(/```(?:json)?/gi, '')
  const start = t.search(/[[{]/)
  if (start < 0) throw new Error('응답에 JSON 이 없음')
  const open = t[start]!
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < t.length; i++) {
    const c = t[i]!
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === open) depth++
    else if (c === close && --depth === 0) return JSON.parse(t.slice(start, i + 1))
  }
  throw new Error('JSON 이 닫히지 않음')
}

export function askClaude(o: AskOpts): Promise<string>
export function askClaude<T>(o: AskOpts & { schema: ZodType<T> }): Promise<T>
export async function askClaude<T>(o: AskOpts & { schema?: ZodType<T> }): Promise<string | T> {
  if (!o.schema) return runClaude(o)

  let lastKind: 'invalid-json' | 'schema' = 'invalid-json'
  let lastMessage = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt =
      attempt === 0 ? o.prompt : `${o.prompt}\n\n[재요청] 직전 응답이 올바르지 않았습니다(${lastMessage}). 설명 없이 요구한 형식의 유효한 JSON 만 출력하세요.`
    const text = await runClaude({ ...o, prompt })
    let json: unknown
    try {
      json = extractJson(text)
    } catch (e) {
      lastKind = 'invalid-json'
      lastMessage = (e as Error).message
      continue
    }
    const parsed = o.schema.safeParse(json)
    if (parsed.success) return parsed.data
    lastKind = 'schema'
    lastMessage = parsed.error.issues.map((i) => `${i.path.join('.') || '(루트)'}: ${i.message}`).join('; ')
  }
  throw new LlmError(lastKind, `claude 응답을 해석하지 못했어요 (${lastMessage})`)
}
