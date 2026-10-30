import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { AUDIO_MODES, findDeepFilter, VOICE_TOOL_MISSING } from '../src/shared/voice.ts'

let home: string
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'vae-voice-home-'))
})

const install = (file: string, mode = 0o755) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, '#!/bin/sh\n', { mode })
  fs.chmodSync(file, mode)
  return file
}

describe('소리 설정 값', () => {
  test('원본 그대로(original)와 목소리 또렷하게(voice) 두 가지다', () => {
    expect(AUDIO_MODES).toEqual(['original', 'voice', 'mic'])
  })
})

describe('findDeepFilter', () => {
  test('기본 위치(~/.local/share/deep-filter/deep-filter)에 실행 파일이 있으면 그 경로', () => {
    const bin = install(path.join(home, '.local/share/deep-filter/deep-filter'))
    expect(findDeepFilter({ env: {}, home, platform: 'linux' })).toBe(bin)
  })
  test('VAE_DEEP_FILTER 가 있으면 그것이 기본 위치보다 우선한다', () => {
    install(path.join(home, '.local/share/deep-filter/deep-filter'))
    const mine = install(path.join(home, 'elsewhere/df'))
    expect(findDeepFilter({ env: { VAE_DEEP_FILTER: mine }, home, platform: 'linux' })).toBe(mine)
  })
  test('VAE_DEEP_FILTER 가 틀린 경로면 기본 위치로 돌아가지 않고 null(잘못 적은 것을 조용히 넘기지 않는다)', () => {
    install(path.join(home, '.local/share/deep-filter/deep-filter'))
    expect(findDeepFilter({ env: { VAE_DEEP_FILTER: path.join(home, 'nope') }, home, platform: 'linux' })).toBeNull()
  })
  test.skipIf(process.platform === 'win32')('없거나, 폴더이거나, 실행 권한이 없으면 null', () => {
    expect(findDeepFilter({ env: {}, home, platform: 'linux' })).toBeNull()
    fs.mkdirSync(path.join(home, '.local/share/deep-filter/deep-filter'), { recursive: true })
    expect(findDeepFilter({ env: {}, home, platform: 'linux' })).toBeNull()
    fs.rmSync(path.join(home, '.local/share/deep-filter/deep-filter'), { recursive: true })
    install(path.join(home, '.local/share/deep-filter/deep-filter'), 0o644)
    expect(findDeepFilter({ env: {}, home, platform: 'linux' })).toBeNull()
  })
  test('없을 때 보여 줄 문구는 설치 방법과 원본 그대로를 알려 준다', () => {
    expect(VOICE_TOOL_MISSING).toContain('README')
    expect(VOICE_TOOL_MISSING).toContain('원본 그대로')
  })
})

describe('findDeepFilter — 윈도우', () => {
  test('기본 위치는 deep-filter.exe 다', () => {
    const bin = install(path.join(home, '.local/share/deep-filter/deep-filter.exe'))
    expect(findDeepFilter({ env: {}, home, platform: 'win32' })).toBe(bin)
  })
  test('윈도우에서 확장자 없는 deep-filter 는 찾지 않는다(맥·리눅스 이름)', () => {
    install(path.join(home, '.local/share/deep-filter/deep-filter'))
    expect(findDeepFilter({ env: {}, home, platform: 'win32' })).toBeNull()
  })
  test('VAE_DEEP_FILTER 는 어느 플랫폼이든 그대로 쓴다', () => {
    const mine = install(path.join(home, 'tools/df.exe'))
    expect(findDeepFilter({ env: { VAE_DEEP_FILTER: mine }, home, platform: 'win32' })).toBe(mine)
  })
})
