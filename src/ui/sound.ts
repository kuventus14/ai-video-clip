import type { BgmMood, SfxMode } from '../shared/sound.ts' // 값(BGM_MOODS 등)은 가져오지 않는다 — shared/sound.ts 는 node:fs 를 써서 브라우저 번들에 들어가면 빌드가 깨진다
import type { SoundListDto, SoundTrackDto } from '../shared/types.ts'

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

/**
 * 음원 목록을 불러온 뒤 화면의 선택을 맞춘다. 목록에 없는 곡(이전에 골라 둔 곡이 사라짐)·없는 효과음은 풀고,
 * 목록을 아예 못 불러왔다면(화면에는 "음악 없이 만들 수 있어요") 이전 선택을 모두 푼다 — 그대로 보내면 서버가 거절해서 빠져나올 수 없다.
 * 아직 불러오는 중이면(목록·오류 모두 없음) 건드리지 않는다.
 */
export function reconcileSoundChoice(i: { list: SoundListDto | null; error: string | null; bgm: string | null; sfx: SfxMode }): { bgm: string | null; sfx: SfxMode } {
  if (i.error !== null) return { bgm: null, sfx: 'off' }
  if (i.list === null) return { bgm: i.bgm, sfx: i.sfx }
  return { bgm: i.bgm && i.list.bgm.some((t) => t.id === i.bgm) ? i.bgm : null, sfx: i.list.sfxCount > 0 ? i.sfx : 'off' }
}
