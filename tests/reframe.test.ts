import { describe, expect, test } from 'vitest'
import type { PersonBox, PersonTrack } from '../src/core/person.ts'
import { computeCropPath, cropReversalsPerSec } from '../src/core/reframe.ts'

const SRC = { srcW: 1920, srcH: 1080, target: { width: 1080, height: 1920 } }
const CROP_W = (1080 / 1920) * (1080 / 1920) // (target 비율) × srcH / srcW = 0.31640625
const MAX_CENTER = 1 - CROP_W / 2

/** 중심 cx, 폭 w, 높이 h 인 사람 박스 */
const person = (cx: number, w = 0.08, h = 0.5, kind: 'human' | 'face' = 'human'): PersonBox => ({ x: cx - w / 2, y: 0.2, w, h, confidence: 0.9, kind })

function trackOf(boxesAt: (t: number) => PersonBox[], o: { fps?: number; duration?: number } = {}): PersonTrack {
  const fps = o.fps ?? 4
  const duration = o.duration ?? 10
  const samples = Array.from({ length: Math.floor(duration * fps) }, (_, i) => ({ t: i / fps, boxes: boxesAt(i / fps) }))
  return { width: 1920, height: 1080, samples }
}

const path = (track: PersonTrack, extra: Partial<Parameters<typeof computeCropPath>[1]> = {}) =>
  computeCropPath(track, { ...SRC, shotCuts: [], durationSec: 10, ...extra })

describe('computeCropPath', () => {
  test('크롭 폭은 목표 비율과 원본 크기로 정해진다 (16:9 → 9:16 ≈ 0.3164)', () => {
    expect(path(trackOf(() => [person(0.5)])).cropWidth).toBeCloseTo(CROP_W, 6)
  })

  test('(a) 가만히 선 사람은 키프레임이 모두 그 사람의 중심', () => {
    const p = path(trackOf(() => [person(0.7)]))
    expect(p.keyframes.length).toBeGreaterThan(5)
    for (const k of p.keyframes) expect(k.centerX).toBeCloseTo(0.7, 6)
    expect(p.coverage).toBe(1)
    expect(p.warnings).toEqual([])
  })

  test('(b) 화면 끝의 사람은 크롭 창이 화면 밖으로 나가지 않게 제한된다', () => {
    const p = path(trackOf(() => [person(0.95)]))
    for (const k of p.keyframes) expect(k.centerX).toBeCloseTo(MAX_CENTER, 3)
    const left = path(trackOf(() => [person(0.02)]))
    for (const k of left.keyframes) expect(k.centerX).toBeCloseTo(CROP_W / 2, 3)
  })

  test('(c) 사람이 미세하게 흔들려도 크롭은 안 흔들린다 (데드밴드)', () => {
    const p = path(trackOf((t) => [person(0.5 + (Math.round(t * 4) % 2 === 0 ? 0.01 : -0.01))]))
    for (let i = 1; i < p.keyframes.length; i++) expect(Math.abs(p.keyframes[i]!.centerX - p.keyframes[i - 1]!.centerX)).toBeLessThan(0.005)
  })

  describe('(d) 사람이 0.2 → 0.8 로 갑자기 옮겨 갈 때 (5.0초)', () => {
    const track = trackOf((t) => [person(t < 5 ? 0.2 : 0.8)])

    test('컷이 없으면 점진적으로 따라간다 (연속 키프레임 차이 ≤ 0.1)', () => {
      const p = path(track)
      for (let i = 1; i < p.keyframes.length; i++) expect(Math.abs(p.keyframes[i]!.centerX - p.keyframes[i - 1]!.centerX)).toBeLessThanOrEqual(0.1 + 1e-9)
      expect(p.keyframes.at(-1)!.centerX).toBeCloseTo(0.8, 1)
    })

    test('샷이 바뀌는 시각이면 훑지 않고 즉시 점프한다', () => {
      const p = path(track, { shotCuts: [5.0] })
      const at5 = p.keyframes.find((k) => k.t === 5)!
      expect(at5.centerX).toBeCloseTo(0.8, 6)
      const before = p.keyframes.filter((k) => k.t < 5).at(-1)!
      expect(before.t).toBeGreaterThan(4.99)
      expect(before.centerX).toBeCloseTo(0.2, 6)
    })
  })

  test('(e) 사람이 전혀 없으면 중앙, coverage 0, no-person 경고', () => {
    const p = path(trackOf(() => []))
    for (const k of p.keyframes) expect(k.centerX).toBe(0.5)
    expect(p.coverage).toBe(0)
    expect(p.warnings).toEqual(['no-person'])
  })

  test('검출이 드물면 low-coverage 경고', () => {
    const p = path(trackOf((t) => (Math.round(t * 4) % 5 === 0 ? [person(0.4)] : [])))
    expect(p.coverage).toBeCloseTo(0.2, 1)
    expect(p.warnings).toEqual(['low-coverage'])
  })

  describe('(f) 여러 사람', () => {
    test('모두 크롭 창에 들어가면 합집합의 중심', () => {
      const p = path(trackOf(() => [person(0.3, 0.05), person(0.45, 0.05)]))
      for (const k of p.keyframes) expect(k.centerX).toBeCloseTo(0.375, 2)
    })
    test('다 못 들어가면 가장 큰 사람을 따른다', () => {
      const p = path(trackOf(() => [person(0.1, 0.1, 0.5), person(0.9, 0.15, 0.6)]))
      for (const k of p.keyframes) expect(k.centerX).toBeCloseTo(MAX_CENTER, 3)
    })
    test('preferLargest 면 들어갈 수 있어도 가장 큰 사람을 따른다', () => {
      const boxes = [person(0.3, 0.05, 0.3), person(0.45, 0.1, 0.6)]
      const p = path(trackOf(() => boxes), { smoothing: { preferLargest: true } })
      for (const k of p.keyframes) expect(k.centerX).toBeCloseTo(0.45, 2)
    })
  })

  describe('(I2) 대상 선택에 히스테리시스', () => {
    const jitter = (i: number, k: number) => Math.sin(i * 1.7 + k * 2.3) * 0.01

    test('두 사람의 합집합 폭이 크롭 폭 근처에서 흔들려도 크롭이 좌우로 왔다 갔다 하지 않는다', () => {
      const t = trackOf(
        (time) => {
          const i = Math.round(time * 4)
          return [person(0.3 + jitter(i, 0), 0.08, 0.5), person(0.52 + jitter(i, 1), 0.08, 0.5)]
        },
        { duration: 20 },
      )
      const p = path(t, { durationSec: 20 })
      const xs = p.keyframes.map((k) => k.centerX)
      expect(cropReversalsPerSec(p.keyframes)).toBeLessThan(0.2)
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.03)
    })

    test('멀리 떨어진 두 사람은 처음 따라가던 사람을 계속 따라간다 (크기가 번갈아 더 커 보여도)', () => {
      const t = trackOf((time) => [person(0.1, 0.1, 0.5), person(0.9, 0.1, Math.round(time * 4) % 2 ? 0.52 : 0.5)])
      const xs = path(t).keyframes.map((k) => k.centerX)
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(1e-6)
    })

    test('따라가던 사람이 사라지면 남은 사람(가장 큰 박스)으로 옮겨 간다', () => {
      const t = trackOf((time) => (time < 5 ? [person(0.1, 0.1, 0.5), person(0.9, 0.1, 0.4)] : [person(0.9, 0.1, 0.4)]))
      const last = path(t).keyframes.at(-1)!
      expect(last.centerX).toBeGreaterThan(0.8)
    })
  })

  describe('cropReversalsPerSec', () => {
    test('일정하거나 한 방향이면 0', () => {
      expect(cropReversalsPerSec([{ t: 0, centerX: 0.5 }, { t: 1, centerX: 0.5 }, { t: 2, centerX: 0.5 }])).toBe(0)
      expect(cropReversalsPerSec([{ t: 0, centerX: 0.3 }, { t: 1, centerX: 0.4 }, { t: 2, centerX: 0.5 }])).toBe(0)
    })
    test('좌우로 번갈아 움직이면 방향 전환 횟수 / 길이(초)', () => {
      const zig = [0.5, 0.6, 0.5, 0.6, 0.5].map((centerX, i) => ({ t: i, centerX }))
      expect(cropReversalsPerSec(zig)).toBeCloseTo(3 / 4, 6)
    })
    test('키프레임이 둘 이하면 0', () => {
      expect(cropReversalsPerSec([{ t: 0, centerX: 0.5 }])).toBe(0)
    })
  })

  test('몸이 안 잡히고 얼굴만 잡히면 얼굴을 쓰고, 둘 다 있으면 몸을 쓴다', () => {
    const faceOnly = path(trackOf(() => [person(0.6, 0.05, 0.1, 'face')]))
    for (const k of faceOnly.keyframes) expect(k.centerX).toBeCloseTo(0.6, 6)
    const both = path(trackOf(() => [person(0.3), person(0.8, 0.05, 0.1, 'face')]))
    for (const k of both.keyframes) expect(k.centerX).toBeCloseTo(0.3, 6)
  })

  test('검출이 끊기면 1.5초는 마지막 위치를 유지하고, 이후 3초에 걸쳐 중앙으로 돌아온다', () => {
    const p = path(trackOf((t) => (t < 2 ? [person(0.7)] : [])))
    const at = (t: number) => p.keyframes.filter((k) => k.t <= t).at(-1)!.centerX
    expect(at(3.0)).toBeCloseTo(0.7, 3)
    expect(Math.abs(at(9.5) - 0.5)).toBeLessThan(0.02)
  })

  test('데드밴드를 키우면 더 큰 움직임도 무시한다', () => {
    const wobble = trackOf((t) => [person(0.5 + (Math.round(t * 4) % 2 === 0 ? 0.04 : -0.04))])
    const normal = path(wobble)
    const calm = path(wobble, { smoothing: { deadband: 0.2 } })
    const range = (p: typeof normal) => Math.max(...p.keyframes.map((k) => k.centerX)) - Math.min(...p.keyframes.map((k) => k.centerX))
    expect(range(calm)).toBeLessThanOrEqual(range(normal))
    expect(range(calm)).toBeLessThan(0.001)
  })

  test('(g) 원본과 목표 비율이 같으면 크롭하지 않는다 (키프레임 1개, 중앙)', () => {
    const p = computeCropPath(trackOf(() => [person(0.3)]), { srcW: 1920, srcH: 1080, target: { width: 1920, height: 1080 }, shotCuts: [], durationSec: 10 })
    expect(p.keyframes).toEqual([{ t: 0, centerX: 0.5 }])
    expect(p.cropWidth).toBeGreaterThanOrEqual(1)
  })

  test('키프레임은 초당 4개 이하이고 시간순이며 마지막은 영상 끝에 닿는다', () => {
    const p = path(trackOf((t) => [person(0.3 + 0.04 * Math.sin(t * 2))], { fps: 12 }))
    for (let i = 1; i < p.keyframes.length; i++) expect(p.keyframes[i]!.t).toBeGreaterThan(p.keyframes[i - 1]!.t)
    const perSec = new Map<number, number>()
    for (const k of p.keyframes) perSec.set(Math.floor(k.t), (perSec.get(Math.floor(k.t)) ?? 0) + 1)
    for (const n of perSec.values()) expect(n).toBeLessThanOrEqual(4)
    expect(p.keyframes.at(-1)!.t).toBeCloseTo(10, 6)
  })

  test('입력 트랙을 바꾸지 않는다', () => {
    const track = trackOf(() => [person(0.9)])
    const snapshot = JSON.stringify(track)
    path(track)
    expect(JSON.stringify(track)).toBe(snapshot)
  })
})
