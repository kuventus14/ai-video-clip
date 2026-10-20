import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, test } from 'vitest'
import { ToolError } from '../src/core/exec.ts'
import { ensurePersonTrackBinary, parsePersonTrack, trackPeople } from '../src/core/person.ts'
import { ensureFixtures, type Fixtures } from './helpers/fixtures.ts'

const SAMPLE = path.join(os.homedir(), 'Desktop/롱아이언_릴스_편집본.mp4')

let fx: Fixtures
beforeAll(async () => {
  fx = await ensureFixtures()
}, 300_000)

const box = (over = {}) => ({ x: 0.4, y: 0.1, w: 0.2, h: 0.7, confidence: 0.9, kind: 'human', ...over })

describe('parsePersonTrack', () => {
  test('올바른 JSON 을 통과시킨다', () => {
    const t = parsePersonTrack({ width: 1920, height: 1080, samples: [{ t: 0, boxes: [box()] }, { t: 0.25, boxes: [] }] })
    expect(t.samples).toHaveLength(2)
    expect(t.samples[0]!.boxes[0]!.kind).toBe('human')
  })
  test('정규화 범위를 벗어난 박스를 거부한다', () => {
    expect(() => parsePersonTrack({ width: 10, height: 10, samples: [{ t: 0, boxes: [box({ x: 1.5 })] }] })).toThrow()
    expect(() => parsePersonTrack({ width: 10, height: 10, samples: [{ t: 0, boxes: [box({ x: 0.9, w: 0.5 })] }] })).toThrow()
  })
  test('필드가 빠지거나 종류가 이상하면 거부한다', () => {
    expect(() => parsePersonTrack({ width: 10, samples: [] })).toThrow()
    expect(() => parsePersonTrack({ width: 10, height: 10, samples: [{ t: 0, boxes: [box({ kind: 'dog' })] }] })).toThrow()
  })
})

describe('ensurePersonTrackBinary', () => {
  test('Swift 도구를 컴파일해 실행 가능한 파일 경로를 돌려주고, 두 번째는 다시 컴파일하지 않는다', async () => {
    const p = await ensurePersonTrackBinary()
    expect(fs.statSync(p).isFile()).toBe(true)
    fs.accessSync(p, fs.constants.X_OK)
    const mtime = fs.statSync(p).mtimeMs
    expect(await ensurePersonTrackBinary()).toBe(p)
    expect(fs.statSync(p).mtimeMs).toBe(mtime)
  }, 300_000)
})

describe('trackPeople', () => {
  test('사람이 없는 영상은 모든 샘플의 박스가 빈 배열이다 (초당 4개)', async () => {
    const t = await trackPeople(fx.landscape)
    expect([t.width, t.height]).toEqual([1920, 1080])
    expect(t.samples.length).toBeGreaterThanOrEqual(19)
    expect(t.samples.length).toBeLessThanOrEqual(21)
    for (const s of t.samples) expect(s.boxes).toEqual([])
    expect(t.samples[1]!.t).toBeCloseTo(0.25, 5)
  }, 120_000)

  test('sampleFps 를 바꾸면 샘플 수가 따라간다', async () => {
    const t = await trackPeople(fx.silent, { sampleFps: 2 })
    expect(t.samples.length).toBe(4) // 2초 × 2
  }, 120_000)

  test('회전 메타데이터가 있으면 화면에 보이는 크기를 돌려준다', async () => {
    const t = await trackPeople(fx.rotated, { sampleFps: 1 })
    expect([t.width, t.height]).toEqual([1080, 1920])
  }, 120_000)

  test('한글·공백·괄호 파일명도 처리한다', async () => {
    const t = await trackPeople(fx.koreanName, { sampleFps: 1 })
    expect(t.samples.length).toBeGreaterThan(0)
  }, 120_000)

  test('없는 파일은 ToolError', async () => {
    await expect(trackPeople('/no/such/영상.mp4')).rejects.toBeInstanceOf(ToolError)
  }, 120_000)

  test.skipIf(process.env.INTEGRATION !== '1' || !fs.existsSync(SAMPLE))('실제 샘플 영상에서 사람을 찾는다', async () => {
    const t = await trackPeople(SAMPLE)
    const early = t.samples.slice(0, 5)
    expect(early.some((s) => s.boxes.some((b) => b.kind === 'human'))).toBe(true)
    for (const s of t.samples) for (const b of s.boxes) expect(b.x + b.w).toBeLessThanOrEqual(1.02)
  }, 300_000)
})
