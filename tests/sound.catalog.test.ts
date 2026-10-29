import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { ALLOWED_LICENSES, BGM_MOODS, loadCatalog, trackPath } from '../src/shared/sound.ts'

// 이 컴퓨터에 둔 실제 음원(assets/sound)을 검사한다. 음원을 바꾸면 npm run sound:measure 로 목록을 다시 만든다.
// 음원 파일은 라이선스 때문에 저장소에 없다 — 음원 목록(manifest.json)이 없는 곳(내려받은 직후)에서는 이 검사를 건너뛴다.
const DIR = path.resolve(import.meta.dirname, '../assets/sound')
const MAX_TOTAL_BYTES = 80 * 1024 * 1024
const catalog = () => loadCatalog(DIR)

describe.skipIf(!fs.existsSync(path.join(DIR, 'manifest.json')))('내장 음원 목록(assets/sound)', () => {
  test('목록이 읽힌다(형식·파일 존재·id 중복 검증 통과)', () => {
    const c = catalog()
    expect(c.bgm.length).toBeGreaterThan(0)
    expect(c.sfx.length).toBeGreaterThan(0)
  })

  test('모든 곡이 허용 라이선스·https 출처·측정 음량을 갖는다', () => {
    const c = catalog()
    for (const t of [...c.bgm, ...c.sfx]) {
      expect(ALLOWED_LICENSES).toContain(t.license)
      expect(t.sourceUrl.startsWith('https://')).toBe(true)
      expect(Number.isFinite(t.peakDb)).toBe(true)
      expect(t.peakDb).toBeLessThanOrEqual(3) // 크게 마스터링된 곡은 참 최대치(true peak)가 0dB 를 조금 넘는다(실측 +1.1). 섞을 때 곡마다 음량을 맞춰 줄이므로 문제 없다
    }
    for (const t of c.bgm) expect(Number.isFinite(t.lufs)).toBe(true)
  })

  test.each(BGM_MOODS)('분위기 %s 배경음악이 3곡 이상', (mood) => {
    expect(catalog().bgm.filter((t) => t.mood === mood).length).toBeGreaterThanOrEqual(3)
  })

  test('배경음악은 모두 60초 이상, 효과음은 모두 3초 이하', () => {
    const c = catalog()
    for (const t of c.bgm) expect(t.durationSec, t.id).toBeGreaterThanOrEqual(60)
    for (const t of c.sfx) expect(t.durationSec, t.id).toBeLessThanOrEqual(3)
  })

  test('효과음에 whoosh(컷)와 pop(제목 카드)이 있다', () => {
    const roles = new Set(catalog().sfx.map((t) => t.role))
    expect(roles.has('whoosh')).toBe(true)
    expect(roles.has('pop')).toBe(true)
  })

  test('sources.json 과 manifest.json 이 같은 곡들을 가리킨다(목록을 고친 뒤 sound:measure 를 잊지 않았다)', () => {
    const ids = (f: string) => (JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) as { tracks: { id: string }[] }).tracks.map((t) => t.id).sort()
    expect(ids('manifest.json')).toEqual(ids('sources.json'))
  })

  test('CREDITS.md 에 모든 곡의 id 가 적혀 있다', () => {
    const c = catalog()
    const credits = fs.readFileSync(path.join(DIR, 'CREDITS.md'), 'utf8')
    for (const t of [...c.bgm, ...c.sfx]) expect(credits, t.id).toContain(t.id)
  })

  test('음원 파일 전체 용량이 80MB 이하', () => {
    const c = catalog()
    const total = [...c.bgm, ...c.sfx].reduce((sum, t) => sum + fs.statSync(trackPath(c, t)).size, 0)
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_BYTES)
  })
})
