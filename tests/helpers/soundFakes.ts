import type { MixRecipe } from '../../src/core/sound.ts'
import type { SoundBalance } from '../../src/core/soundBalance.ts'

/** 파이프라인 시험의 가짜 applySound 가 돌려주는 섞는 방법 */
export const recipeOf = (a: { durationSec: number; hasAudio: boolean; choice: { bgm: string | null } }): Omit<MixRecipe, 'ai'> => ({
  durationSec: a.durationSec, hasAudio: a.hasAudio, voice: { lufs: -18, peakDb: -2 }, bgmId: a.choice.bgm, sfx: [],
})

/** AI 를 부르지 않는 가짜 balanceSound — 기본 규칙 그대로(오프셋 0) */
export const noBalance = async (): Promise<SoundBalance> => ({ bgmGainDb: 0, sfxGainDb: 0, reason: '' })
