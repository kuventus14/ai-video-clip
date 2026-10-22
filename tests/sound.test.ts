import { describe, expect, test } from 'vitest'
import type { SfxRole, SfxTrack } from '../src/shared/sound.ts'
import { planSfx } from '../src/core/sound.ts'

const sfx = (id: string, role: SfxRole): SfxTrack => ({
  kind: 'sfx', id, file: `sfx/${id}.mp3`, title: id, author: '작가', sourceUrl: 'https://mixkit.co/x',
  license: 'Mixkit Free License', durationSec: 1, lufs: null, peakDb: -3, role,
})
const WHOOSH = sfx('w1', 'whoosh')
const POP = sfx('p1', 'pop')
const span = (start: number, end: number) => ({ start, end })

describe('planSfx — 효과음을 어디에 넣을까', () => {
  test('남은 구간이 3개면 경계 두 곳(출력 시간 5초·9초)의 0.15초 앞에 whoosh', () => {
    const ev = planSfx({ kept: [span(0, 5), span(8, 12), span(15, 20)], hookTitle: false, sfx: [WHOOSH] })
    expect(ev.map((e) => e.role)).toEqual(['whoosh', 'whoosh'])
    expect(ev[0]!.atSec).toBeCloseTo(4.85, 5)
    expect(ev[1]!.atSec).toBeCloseTo(8.85, 5)
  })
  test('제목 카드가 있고 pop 파일이 있으면 0.1초에 pop 이 맨 앞', () => {
    const ev = planSfx({ kept: [span(0, 5), span(8, 12)], hookTitle: true, sfx: [WHOOSH, POP] })
    expect(ev[0]).toMatchObject({ role: 'pop', trackId: 'p1' })
    expect(ev[0]!.atSec).toBeCloseTo(0.1, 5)
    expect(ev[1]!.role).toBe('whoosh')
  })
  test('제목 카드가 없으면 pop 은 없다', () => {
    const ev = planSfx({ kept: [span(0, 5), span(8, 12)], hookTitle: false, sfx: [WHOOSH, POP] })
    expect(ev.map((e) => e.role)).toEqual(['whoosh'])
  })
  test('pop 파일이 없으면 제목 카드가 있어도 pop 은 없다', () => {
    const ev = planSfx({ kept: [span(0, 5)], hookTitle: true, sfx: [WHOOSH] })
    expect(ev).toEqual([])
  })
  test('whoosh 파일이 없으면 컷 경계에는 아무것도 넣지 않는다', () => {
    const ev = planSfx({ kept: [span(0, 5), span(8, 12), span(15, 20)], hookTitle: false, sfx: [POP] })
    expect(ev).toEqual([])
  })
  test('경계가 0.5초 간격으로 몰려 있으면 2초 간격 규칙으로 첫 번째만 남는다', () => {
    const ev = planSfx({ kept: [span(0, 0.5), span(1, 1.5), span(2, 2.5), span(3, 3.5)], hookTitle: false, sfx: [WHOOSH] })
    expect(ev).toHaveLength(1)
    expect(ev[0]!.atSec).toBeCloseTo(0.35, 5)
  })
  test('컷이 아주 많아도 이벤트 사이는 항상 2초 이상이다', () => {
    const kept = Array.from({ length: 200 }, (_, n) => span(n * 2, n * 2 + 0.7)) // 0.7초 조각 200개
    const ev = planSfx({ kept, hookTitle: true, sfx: [WHOOSH, POP] })
    expect(ev.length).toBeGreaterThan(5)
    for (let n = 1; n < ev.length; n++) expect(ev[n]!.atSec - ev[n - 1]!.atSec).toBeGreaterThanOrEqual(2 - 1e-6)
  })
  test('제목 pop 과 2초 안에 있는 첫 경계 whoosh 는 겹치지 않는다(pop 이 남는다)', () => {
    const ev = planSfx({ kept: [span(0, 1), span(3, 9)], hookTitle: true, sfx: [WHOOSH, POP] })
    expect(ev.map((e) => e.role)).toEqual(['pop'])
  })
  test('총 길이 끝 0.3초 안의 이벤트는 버린다', () => {
    const ev = planSfx({ kept: [span(0, 19.9), span(25, 25.1)], hookTitle: false, sfx: [WHOOSH] }) // 경계 19.9 → 19.75, 총 20
    expect(ev).toEqual([])
  })
  test('0초보다 앞(음수)이 되는 이벤트는 버린다', () => {
    const ev = planSfx({ kept: [span(0, 0.1), span(3, 9)], hookTitle: false, sfx: [WHOOSH] })
    expect(ev).toEqual([])
  })
  test('같은 역할의 파일이 여럿이면 이벤트 순서대로 번갈아 쓴다', () => {
    const w2 = sfx('w2', 'whoosh')
    const ev = planSfx({ kept: [span(0, 3), span(5, 8), span(10, 13), span(15, 18)], hookTitle: false, sfx: [WHOOSH, w2] })
    expect(ev.map((e) => e.trackId)).toEqual(['w1', 'w2', 'w1'])
  })
  test('같은 입력이면 늘 같은 결과', () => {
    const i = { kept: [span(0, 3), span(5, 8), span(10, 13)], hookTitle: true, sfx: [WHOOSH, POP] }
    expect(planSfx(i)).toEqual(planSfx(i))
  })
  test('남은 구간이 하나면 경계가 없어서 이벤트도 없다', () => {
    expect(planSfx({ kept: [span(0, 10)], hookTitle: false, sfx: [WHOOSH, POP] })).toEqual([])
  })
  test('남은 구간이 없어도 던지지 않는다', () => {
    expect(planSfx({ kept: [], hookTitle: true, sfx: [WHOOSH, POP] })).toEqual([])
  })
})
