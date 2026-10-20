import { spawn } from 'node:child_process'
import path from 'node:path'

export class ToolError extends Error {
  tool: string
  code: number | null
  stderr: string
  constructor(tool: string, code: number | null, stderr: string, message?: string) {
    super(message ?? `${tool} 실행 실패 (종료 코드 ${code}): ${stderr.trim().slice(-500)}`)
    this.name = 'ToolError'
    this.tool = tool
    this.code = code
    this.stderr = stderr
  }
}

export interface RunOpts {
  cwd?: string
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
  input?: string
}

/** 외부 명령을 실행해 stdout/stderr 를 돌려준다. 종료 코드가 0 이 아니거나 실행할 수 없으면 ToolError. */
export function run(file: string, args: string[], opts: RunOpts = {}): Promise<{ stdout: string; stderr: string }> {
  const tool = path.basename(file)
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const out: Buffer[] = []
    const err: Buffer[] = []
    let timedOut = false
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true
          child.kill('SIGKILL')
        }, opts.timeoutMs)
      : null

    child.stdout.on('data', (d: Buffer) => out.push(d))
    child.stderr.on('data', (d: Buffer) => err.push(d))
    child.on('error', (e) => {
      if (timer) clearTimeout(timer)
      reject(new ToolError(tool, null, String(e.message), `${tool} 를 실행할 수 없어요: ${e.message}`))
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      const stdout = Buffer.concat(out).toString('utf8')
      const stderr = Buffer.concat(err).toString('utf8')
      if (timedOut) return reject(new ToolError(tool, code, stderr, `${tool} 가 제한 시간(${opts.timeoutMs}ms)을 넘겼어요`))
      if (code !== 0) return reject(new ToolError(tool, code, stderr))
      resolve({ stdout, stderr })
    })
    child.stdin.on('error', () => {})
    child.stdin.end(opts.input ?? '')
  })
}
