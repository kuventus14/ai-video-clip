import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { run, ToolError } from '../src/core/exec.ts'
import { checkEnvironment } from '../src/core/env.ts'

// 어느 컴퓨터에서나 있는 실행 파일(지금 돌고 있는 node)로 시험한다 — false·echo 는 윈도우에 없다
const NODE = process.execPath

describe('run', () => {
  test('실패한 명령은 종료 코드를 담은 ToolError 를 던진다', async () => {
    const err = await run(NODE, ['-e', 'process.exit(1)']).catch((e) => e)
    expect(err).toBeInstanceOf(ToolError)
    expect((err as ToolError).code).toBe(1)
    expect((err as ToolError).tool).toBe(path.basename(NODE))
  })

  test.skipIf(process.platform === 'win32')('PATH 가 비어 있어도 흔한 설치 위치(brew 등)의 도구를 찾는다', async () => {
    const saved = process.env.PATH
    process.env.PATH = '/usr/bin:/bin'
    try {
      const { stdout } = await run('ffmpeg', ['-version'])
      expect(stdout).toContain('ffmpeg version')
    } finally {
      process.env.PATH = saved
    }
  })

  test('성공하면 stdout 을 돌려준다', async () => {
    const { stdout } = await run(NODE, ['-e', 'console.log("안녕")'])
    expect(stdout.trim()).toBe('안녕')
  })
})

describe('checkEnvironment', () => {
  test('도구가 하나도 없으면 ok=false 이고 설치 힌트를 준다(맥)', async () => {
    const report = await checkEnvironment({ path: '/nonexistent', platform: 'darwin' })
    expect(report.ok).toBe(false)
    expect(report.tools.ffmpeg.ok).toBe(false)
    expect(report.tools.ffmpeg.hint).toContain('brew install ffmpeg')
    expect(report.tools['whisper-cli'].hint).toContain('brew install whisper-cpp')
    expect(report.tools.hyperframes.hint).toContain('npm i -g hyperframes')
    expect(report.tools['yt-dlp'].hint).toContain('uv tool install yt-dlp')
  })

  test('윈도우·리눅스는 그 컴퓨터에 맞는 설치 명령을 준다', async () => {
    const win = await checkEnvironment({ path: 'C:\\nonexistent', platform: 'win32' })
    expect(win.tools.ffmpeg.hint).toContain('winget install')
    expect(win.tools.claude.hint).toContain('install.ps1')
    const linux = await checkEnvironment({ path: '/nonexistent', platform: 'linux' })
    expect(linux.tools.ffmpeg.hint).toContain('apt install ffmpeg')
    for (const t of Object.values({ ...win.tools, ...linux.tools })) expect(t.hint ?? '').not.toMatch(/brew /)
  })

  test('swiftc(맥 전용, 앱이 쓰지 않음)가 없어도 나머지가 다 있으면 ok 다', async () => {
    const report = await checkEnvironment({ path: '/bin', platform: 'linux', isExecutable: (f) => !f.endsWith('swiftc'), modelPath: NODE })
    expect(report.tools.swiftc.ok).toBe(false)
    expect(report.ok).toBe(true)
  })
})
