import { describe, expect, test } from 'vitest'
import type { EnvReport, ToolName } from '../src/core/env.ts'
import { describeSetup } from '../src/core/setup.ts'

const ALL: ToolName[] = ['node', 'ffmpeg', 'ffprobe', 'hyperframes', 'whisper-cli', 'yt-dlp', 'claude', 'swiftc']
const report = (missing: ToolName[] = [], model = true): EnvReport => ({
  ok: missing.length === 0 && model,
  tools: Object.fromEntries(ALL.map((n) => [n, missing.includes(n) ? { ok: false, hint: `설치: ${n}` } : { ok: true, version: '1.0' }])) as EnvReport['tools'],
  whisperModel: { ok: model, path: '/home/u/.cache/hyperframes/whisper/models/ggml-small.bin' },
})

describe('describeSetup — 처음 쓰는 사람을 위한 환경 점검 결과', () => {
  test('모두 있으면 준비 완료이고 다음에 할 일(npm run app)을 알려 준다', () => {
    const r = describeSetup(report(), true)
    expect(r.ready).toBe(true)
    expect(r.lines.join('\n')).toContain('npm run app')
    expect(r.lines.some((l) => l.startsWith('✗'))).toBe(false)
  })

  test('빠진 프로그램은 ✗ 와 설치 방법을 보여 주고 준비 완료가 아니다', () => {
    const r = describeSetup(report(['ffmpeg', 'yt-dlp']), true)
    expect(r.ready).toBe(false)
    const text = r.lines.join('\n')
    expect(text).toContain('✗ ffmpeg')
    expect(text).toContain('설치: ffmpeg')
    expect(text).toContain('✗ yt-dlp')
    expect(text).not.toContain('npm run app')
  })

  test('swiftc(사람 추적용, 앱이 더는 쓰지 않음)는 없어도 준비 완료다', () => {
    const r = describeSetup(report(['swiftc']), true)
    expect(r.ready).toBe(true)
    expect(r.lines.join('\n')).not.toContain('swiftc')
  })

  test('인식 모델이 없으면 받는 명령과 확인 해시를 보여 준다', () => {
    const r = describeSetup(report([], false), true)
    expect(r.ready).toBe(false)
    const text = r.lines.join('\n')
    expect(text).toContain('✗ 음성 인식 모델')
    expect(text).toContain('curl -L --create-dirs -o /home/u/.cache/hyperframes/whisper/models/ggml-small.bin')
    expect(text).toContain('1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b')
  })

  test('목소리 보정 도구(deep-filter)는 선택이라 없어도 준비 완료이고 안내만 한다', () => {
    const r = describeSetup(report(), false)
    expect(r.ready).toBe(true)
    expect(r.lines.join('\n')).toContain('목소리 보정')
    expect(r.lines.some((l) => l.startsWith('✗') && l.includes('목소리'))).toBe(false)
  })

  test('claude 는 설치만 확인할 수 있어서 로그인을 직접 확인하라고 알려 준다', () => {
    expect(describeSetup(report(), true).lines.join('\n')).toMatch(/claude.*로그인/s)
  })
})
