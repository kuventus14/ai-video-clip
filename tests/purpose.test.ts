import { describe, expect, test } from 'vitest'
import { canvasFor, detectPurpose, resolvePurpose } from '../src/core/purpose.ts'

const info = (width: number, height: number, durationSec: number) => ({ width, height, durationSec })

describe('detectPurpose', () => {
  test('세로 56.8초 영상은 short, 확신이 높다', () => {
    const g = detectPurpose({ info: info(1080, 1920, 56.8) })
    expect(g.purpose).toBe('short')
    expect(g.confidence).toBeCloseTo(5 / 6, 2)
    expect(g.reasons.length).toBeGreaterThan(0)
  })

  test('가로 10분 영상은 post', () => {
    expect(detectPurpose({ info: info(1920, 1080, 600) }).purpose).toBe('post')
  })

  test('가로 45초 영상은 post 이지만 확신이 낮다', () => {
    const g = detectPurpose({ info: info(1920, 1080, 45) })
    expect(g.purpose).toBe('post')
    expect(g.confidence).toBeLessThan(0.4)
  })

  test('정사각 90초 영상은 short 이지만 확신이 낮다', () => {
    const g = detectPurpose({ info: info(1080, 1080, 90) })
    expect(g.purpose).toBe('short')
    expect(g.confidence).toBeLessThan(0.4)
  })

  test('가로 45초 영상도 세로 레퍼런스가 있으면 short', () => {
    const g = detectPurpose({ info: info(1920, 1080, 45), reference: { width: 1080, height: 1920 } })
    expect(g.purpose).toBe('short')
  })

  test('설명의 "릴스" 키워드는 점수를 올리지만 가로 10분이면 여전히 post', () => {
    const g = detectPurpose({ info: info(1920, 1080, 600), description: '릴스용 영상' })
    expect(g.purpose).toBe('post')
  })

  test('설명의 "강의" 키워드는 post 쪽으로 기운다', () => {
    const g = detectPurpose({ info: info(1080, 1080, 40), description: '골프 강의 영상입니다' })
    expect(g.purpose).toBe('post')
  })

  test('적용된 규칙마다 한국어 사유가 하나씩 붙는다', () => {
    const g = detectPurpose({ info: info(1080, 1920, 30), reference: { width: 1080, height: 1920 }, description: '숏츠' })
    expect(g.reasons).toHaveLength(4)
    for (const r of g.reasons) expect(r).toMatch(/[가-힣]/)
  })
})

describe('resolvePurpose', () => {
  const guess = detectPurpose({ info: info(1080, 1920, 56.8) })

  test('사용자가 고른 값이 자동 인식보다 우선한다', () => {
    expect(resolvePurpose(guess, 'post')).toBe('post')
  })

  test("'auto' 나 미지정이면 자동 인식 결과", () => {
    expect(resolvePurpose(guess, 'auto')).toBe('short')
    expect(resolvePurpose(guess)).toBe('short')
  })
})

describe('canvasFor', () => {
  test('post 는 1920x1080, short 는 1080x1920', () => {
    expect(canvasFor('post')).toEqual({ width: 1920, height: 1080 })
    expect(canvasFor('short')).toEqual({ width: 1080, height: 1920 })
  })
})
