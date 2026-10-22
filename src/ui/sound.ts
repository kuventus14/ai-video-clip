import type { BgmMood } from '../shared/sound.ts' // 값(BGM_MOODS 등)은 가져오지 않는다 — shared/sound.ts 는 node:fs 를 써서 브라우저 번들에 들어가면 빌드가 깨진다
import type { SoundTrackDto } from '../shared/types.ts'

/** 키 순서가 화면에 보이는 분위기 순서다 */
const MOOD_KO: Record<BgmMood, string> = { calm: '잔잔한', bright: '밝은', energetic: '신나는' }
const MOODS = Object.keys(MOOD_KO) as BgmMood[]

export const moodLabel = (m: BgmMood): string => MOOD_KO[m]

/** 곡 길이를 분:초로. 65 → "1:05" */
export function durationLabel(sec: number): string {
  const total = Number.isFinite(sec) && sec > 0 ? Math.round(sec) : 0
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** 곡 목록을 분위기별로 묶는다(잔잔한 → 밝은 → 신나는). 곡이 없는 분위기는 건너뛴다. */
export function groupByMood(tracks: SoundTrackDto[]): { mood: BgmMood; label: string; tracks: SoundTrackDto[] }[] {
  return MOODS.map((mood) => ({ mood, label: moodLabel(mood), tracks: tracks.filter((t) => t.mood === mood) })).filter((g) => g.tracks.length > 0)
}
