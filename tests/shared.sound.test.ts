import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { clampGainDb, findTrack, loadCatalog, SFX_MODES, SOUND_GAIN_RANGE, SoundError, soundChoiceProblem, soundDir } from '../src/shared/sound.ts'

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vae-sound-'))
})

const bgm = (id: string, extra: Record<string, unknown> = {}) => ({
  kind: 'bgm', id, file: `bgm/${id}.mp3`, title: `곡 ${id}`, author: '작가', sourceUrl: 'https://pixabay.com/music/x',
  license: 'Pixabay License', durationSec: 90, lufs: -14, peakDb: -1, mood: 'calm', ...extra,
})
const sfx = (id: string, extra: Record<string, unknown> = {}) => ({
  kind: 'sfx', id, file: `sfx/${id}.mp3`, title: `효과 ${id}`, author: '작가', sourceUrl: 'https://mixkit.co/free-sound-effects/x',
  license: 'Mixkit Free License', durationSec: 1, lufs: null, peakDb: -3, role: 'whoosh', ...extra,
})

/** 목록과 (목록에 적힌) 가짜 파일을 만든다 */
function write(tracks: Record<string, unknown>[], opts: { skipFile?: string } = {}) {
  for (const t of tracks) {
    if (t.id === opts.skipFile) continue
    const f = path.join(dir, String(t.file))
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, 'x')
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version: 1, tracks }))
}

describe('효과음 설정 값', () => {
  test('끄기(off)와 켜기(on) 두 가지다', () => {
    expect(SFX_MODES).toEqual(['off', 'on'])
  })
})

describe('loadCatalog', () => {
  test('manifest 가 없으면 빈 목록(던지지 않는다)', () => {
    expect(loadCatalog(dir)).toEqual({ dir, bgm: [], sfx: [] })
  })
  test('폴더 자체가 없어도 빈 목록', () => {
    expect(loadCatalog(path.join(dir, 'nope')).bgm).toEqual([])
  })
  test('배경음악 2개와 효과음 1개를 읽어 나눈다', () => {
    write([bgm('a'), bgm('b', { mood: 'bright' }), sfx('s1')])
    const c = loadCatalog(dir)
    expect(c.bgm.map((t) => t.id)).toEqual(['a', 'b'])
    expect(c.bgm[1]!.mood).toBe('bright')
    expect(c.sfx.map((t) => [t.id, t.role])).toEqual([['s1', 'whoosh']])
    expect(findTrack(c, 's1')?.kind).toBe('sfx')
    expect(findTrack(c, 'zzz')).toBeUndefined()
  })
  test('id 가 겹치면 SoundError(그 id 를 말한다)', () => {
    write([bgm('a'), bgm('a', { title: '다른 곡' })])
    expect(() => loadCatalog(dir)).toThrow(SoundError)
    expect(() => loadCatalog(dir)).toThrow(/a/)
  })
  test('허용하지 않는 라이선스(CC BY 4.0)면 SoundError', () => {
    write([bgm('a', { license: 'CC BY 4.0' })])
    expect(() => loadCatalog(dir)).toThrow(SoundError)
  })
  test('출처 주소가 https 가 아니면 SoundError', () => {
    write([bgm('a', { sourceUrl: 'http://example.com/a' })])
    expect(() => loadCatalog(dir)).toThrow(SoundError)
  })
  test('목록에는 있는데 파일이 없으면 SoundError(그 id 를 말한다)', () => {
    write([bgm('gone')], { skipFile: 'gone' })
    expect(() => loadCatalog(dir)).toThrow(/gone/)
  })
  test('file 이 폴더 밖(../)을 가리키면 SoundError', () => {
    write([bgm('a', { file: '../outside.mp3' })])
    expect(() => loadCatalog(dir)).toThrow(SoundError)
  })
  test('file 이 절대 경로면 SoundError', () => {
    write([bgm('a', { file: '/etc/passwd' })])
    expect(() => loadCatalog(dir)).toThrow(SoundError)
  })
  test('JSON 이 깨졌으면 SoundError(한국어 안내)', () => {
    fs.writeFileSync(path.join(dir, 'manifest.json'), '{ not json')
    expect(() => loadCatalog(dir)).toThrow(SoundError)
    expect(() => loadCatalog(dir)).toThrow(/manifest\.json/)
  })
  test('id 에 허용 밖 글자(대문자·공백·점)가 있으면 SoundError', () => {
    write([bgm('Bad Id')])
    expect(() => loadCatalog(dir)).toThrow(SoundError)
  })
})

describe('soundDir', () => {
  test('VAE_SOUND_DIR 가 있으면 그 폴더(절대 경로로)', () => {
    expect(soundDir({ VAE_SOUND_DIR: dir })).toBe(path.resolve(dir))
  })
  test('없으면 실행 위치의 assets/sound', () => {
    expect(soundDir({})).toBe(path.join(process.cwd(), 'assets/sound'))
  })
})

describe('soundChoiceProblem — 고른 곡·효과음을 지금 쓸 수 있나', () => {
  const catalog = () => {
    write([bgm('a'), sfx('s1')])
    return loadCatalog(dir)
  }
  test('아무것도 고르지 않았거나 목록에 있으면 null', () => {
    const c = catalog()
    expect(soundChoiceProblem(c, null, 'off')).toBeNull()
    expect(soundChoiceProblem(c, 'a', 'on')).toBeNull()
  })
  test('목록에 없는 곡이면 그 id 를 말하는 한국어 안내', () => {
    expect(soundChoiceProblem(catalog(), 'gone', 'off')).toMatch(/gone.*찾을 수 없어요/)
  })
  test('효과음 id 를 배경음악으로 고르면 안내', () => {
    expect(soundChoiceProblem(catalog(), 's1', 'off')).not.toBeNull()
  })
  test('효과음을 켰는데 효과음 파일이 없으면 안내', () => {
    write([bgm('a')])
    expect(soundChoiceProblem(loadCatalog(dir), null, 'on')).toMatch(/효과음/)
  })
})

describe('clampGainDb — 볼륨 오프셋 정리', () => {
  test('범위는 -12 ~ +6 dB', () => {
    expect(SOUND_GAIN_RANGE).toEqual({ min: -12, max: 6 })
  })
  test('숫자가 아니면 0, 범위 밖은 끝값으로, 0.5 단위로 반올림', () => {
    expect(clampGainDb('x')).toBe(0)
    expect(clampGainDb(null)).toBe(0)
    expect(clampGainDb(NaN)).toBe(0)
    expect(clampGainDb(Infinity)).toBe(0)
    expect(clampGainDb(99)).toBe(6)
    expect(clampGainDb(-99)).toBe(-12)
    expect(clampGainDb(2.74)).toBe(2.5)
    expect(clampGainDb(-0.2)).toBe(0)
  })
})
