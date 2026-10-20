import { describe, expect, test } from 'vitest'
import { run, ToolError } from '../src/core/exec.ts'
import { checkEnvironment } from '../src/core/env.ts'

describe('run', () => {
  test('실패한 명령은 종료 코드를 담은 ToolError 를 던진다', async () => {
    const err = await run('false', []).catch((e) => e)
    expect(err).toBeInstanceOf(ToolError)
    expect((err as ToolError).code).toBe(1)
    expect((err as ToolError).tool).toBe('false')
  })

  test('PATH 가 비어 있어도 흔한 설치 위치(brew 등)의 도구를 찾는다', async () => {
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
    const { stdout } = await run('echo', ['안녕'])
    expect(stdout.trim()).toBe('안녕')
  })
})

describe('checkEnvironment', () => {
  test('도구가 하나도 없으면 ok=false 이고 설치 힌트를 준다', async () => {
    const report = await checkEnvironment({ path: '/nonexistent' })
    expect(report.ok).toBe(false)
    expect(report.tools.ffmpeg.ok).toBe(false)
    expect(report.tools.ffmpeg.hint).toContain('brew install ffmpeg')
    expect(report.tools['whisper-cli'].hint).toContain('brew install whisper-cpp')
    expect(report.tools.hyperframes.hint).toContain('npm i -g hyperframes')
    expect(report.tools['yt-dlp'].hint).toContain('uv tool install yt-dlp')
  })
})
