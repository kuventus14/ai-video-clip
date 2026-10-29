import { clampGainDb } from '../shared/soundGain.ts'
import type { SoundAdjustDto } from '../shared/types.ts'

const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

/** 슬라이더 값(dB)을 말로: 0 은 "기본", 그 밖은 "작게 −2.5dB" 처럼 방향과 크기. 범위 밖·숫자가 아닌 값은 안전하게 자른다. */
export function sliderLabel(db: number): string {
  const v = clampGainDb(db)
  if (v === 0) return '기본'
  const word = v <= -6 ? '많이 작게' : v < 0 ? '작게' : v >= 4 ? '많이 크게' : '크게'
  return `${word} ${v < 0 ? '−' : '+'}${num(Math.abs(v))}dB`
}

export type Gains = { bgmGainDb: number; sfxGainDb: number }

/** 슬라이더 값이 지금 영상에 쓰인 값과 다른가 */
export const isChanged = (a: Gains, b: Gains): boolean => a.bgmGainDb !== b.bgmGainDb || a.sfxGainDb !== b.sfxGainDb

/** "AI 추천: 음악 작게 −1dB · 효과음 크게 +1.5dB — 말이 많아요". 쓰는 소리만 보인다. */
export function aiSummary(sa: SoundAdjustDto, uses: { bgm: boolean; sfx: boolean }): string {
  const parts: string[] = []
  if (uses.bgm) parts.push(`음악 ${sliderLabel(sa.aiBgmGainDb)}`)
  if (uses.sfx) parts.push(`효과음 ${sliderLabel(sa.aiSfxGainDb)}`)
  const flat = (!uses.bgm || sa.aiBgmGainDb === 0) && (!uses.sfx || sa.aiSfxGainDb === 0)
  if (flat && !sa.aiReason) return 'AI 추천: 기본 크기 그대로'
  return `AI 추천: ${parts.join(' · ')}${sa.aiReason ? ` — ${sa.aiReason}` : ''}`
}
