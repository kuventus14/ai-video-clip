import { describe, expect, it } from 'vitest'
import type { SoundTrackDto } from '../src/shared/types.ts'
import { durationLabel, groupByMood, moodLabel, reconcileSoundChoice } from '../src/ui/sound.ts'

const track = (id: string, mood: SoundTrackDto['mood']): SoundTrackDto => ({ id, title: id, author: '작가', mood, durationSec: 90, license: 'CC0' })

describe('moodLabel', () => {
  it('분위기를 한국어로', () => {
    expect(moodLabel('calm')).toBe('잔잔한')
    expect(moodLabel('bright')).toBe('밝은')
    expect(moodLabel('energetic')).toBe('신나는')
  })
})

describe('durationLabel', () => {
  it.each([
    [65, '1:05'],
    [0, '0:00'],
    [125, '2:05'],
    [3601, '60:01'],
    [59.6, '1:00'],
    [-3, '0:00'],
    [Number.NaN, '0:00'],
  ])('%s초 → %s', (sec, label) => expect(durationLabel(sec)).toBe(label))
})

describe('groupByMood — 곡 목록을 분위기별로 묶는다', () => {
  it('잔잔한 → 밝은 → 신나는 순서이고, 곡이 없는 분위기는 건너뛰며, 묶음 안 순서는 그대로', () => {
    const groups = groupByMood([track('e1', 'energetic'), track('c1', 'calm'), track('e2', 'energetic'), track('c2', 'calm')])
    expect(groups.map((g) => [g.label, g.tracks.map((t) => t.id)])).toEqual([
      ['잔잔한', ['c1', 'c2']],
      ['신나는', ['e1', 'e2']],
    ])
  })
  it('빈 목록이면 빈 배열', () => {
    expect(groupByMood([])).toEqual([])
  })
})

describe('reconcileSoundChoice — 음원 목록을 불러온 뒤 화면의 선택을 맞춘다', () => {
  const list = { bgm: [track('a', 'calm')], sfxCount: 2 }
  it('목록에 있는 곡과 효과음 켜기는 그대로', () => {
    expect(reconcileSoundChoice({ list, error: null, bgm: 'a', sfx: 'on' })).toEqual({ bgm: 'a', sfx: 'on' })
  })
  it('목록에 없는 곡(이전에 골라 둔 곡이 사라짐)은 푼다', () => {
    expect(reconcileSoundChoice({ list, error: null, bgm: 'gone', sfx: 'off' })).toEqual({ bgm: null, sfx: 'off' })
  })
  it('효과음 파일이 없으면 효과음은 끈다', () => {
    expect(reconcileSoundChoice({ list: { ...list, sfxCount: 0 }, error: null, bgm: null, sfx: 'on' })).toEqual({ bgm: null, sfx: 'off' })
  })
  it('목록을 불러오지 못했으면(화면에는 "음악 없이 만들 수 있어요") 이전 선택을 모두 푼다 — 그대로 보내면 서버가 거절해 빠져나올 수 없다', () => {
    expect(reconcileSoundChoice({ list: null, error: '목록 오류', bgm: 'a', sfx: 'on' })).toEqual({ bgm: null, sfx: 'off' })
  })
  it('아직 불러오는 중이면(목록·오류 모두 없음) 선택을 건드리지 않는다', () => {
    expect(reconcileSoundChoice({ list: null, error: null, bgm: 'a', sfx: 'on' })).toEqual({ bgm: 'a', sfx: 'on' })
  })
})
