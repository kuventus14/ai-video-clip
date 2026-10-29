import { describe, expect, it } from 'vitest'
import type { SoundAdjustDto } from '../src/shared/types.ts'
import { aiSummary, isChanged, sliderLabel } from '../src/ui/soundAdjust.ts'

describe('sliderLabel — 슬라이더 값을 말로', () => {
  it('0 은 "기본"(dB 표시 없음)', () => expect(sliderLabel(0)).toBe('기본'))
  it.each([
    [-12, '많이 작게 −12dB'],
    [-6, '많이 작게 −6dB'],
    [-2.5, '작게 −2.5dB'],
    [-0.5, '작게 −0.5dB'],
    [0.5, '크게 +0.5dB'],
    [3, '크게 +3dB'],
    [4, '많이 크게 +4dB'],
    [6, '많이 크게 +6dB'],
  ])('%s → %s', (db, label) => expect(sliderLabel(db)).toBe(label))
  it('범위 밖·숫자가 아닌 값도 범위 끝으로 안전하게', () => {
    expect(sliderLabel(99)).toBe('많이 크게 +6dB')
    expect(sliderLabel(-99)).toBe('많이 작게 −12dB')
    expect(sliderLabel(Number.NaN)).toBe('기본')
  })
})

describe('isChanged — 지금 영상에 쓰인 값과 슬라이더 값이 다른가', () => {
  const a = { bgmGainDb: 1, sfxGainDb: -2 }
  it('같으면 거짓', () => expect(isChanged(a, { bgmGainDb: 1, sfxGainDb: -2 })).toBe(false))
  it('하나라도 다르면 참', () => {
    expect(isChanged(a, { bgmGainDb: 1.5, sfxGainDb: -2 })).toBe(true)
    expect(isChanged(a, { bgmGainDb: 1, sfxGainDb: 0 })).toBe(true)
  })
})

describe('aiSummary — "AI 추천" 한 줄', () => {
  const sa = (over: Partial<SoundAdjustDto> = {}): SoundAdjustDto => ({
    available: true, reason: null, bgmGainDb: 0, sfxGainDb: 0, aiBgmGainDb: -1, aiSfxGainDb: 1.5, aiReason: '말이 많아요', ...over,
  })
  it('쓰는 소리만 값과 이유를 보인다', () => {
    expect(aiSummary(sa(), { bgm: true, sfx: true })).toBe('AI 추천: 음악 작게 −1dB · 효과음 크게 +1.5dB — 말이 많아요')
    expect(aiSummary(sa(), { bgm: true, sfx: false })).toBe('AI 추천: 음악 작게 −1dB — 말이 많아요')
    expect(aiSummary(sa(), { bgm: false, sfx: true })).toBe('AI 추천: 효과음 크게 +1.5dB — 말이 많아요')
  })
  it('이유가 없으면 값만', () => {
    expect(aiSummary(sa({ aiReason: '' }), { bgm: true, sfx: false })).toBe('AI 추천: 음악 작게 −1dB')
  })
  it('둘 다 0 이고 이유도 없으면(AI 를 못 썼거나 기본이 좋다고 본 경우) 기본 크기라고 말한다', () => {
    expect(aiSummary(sa({ aiBgmGainDb: 0, aiSfxGainDb: 0, aiReason: '' }), { bgm: true, sfx: true })).toBe('AI 추천: 기본 크기 그대로')
  })
})
