import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { run } from '../src/core/exec.ts'
import { probeVideo } from '../src/core/media.ts'
import { applyTempo, scaleSec, TempoError } from '../src/core/tempo.ts'
import { ensureFixtures, type Fixtures } from './helpers/fixtures.ts'

let fx: Fixtures
let tmp: string
const f = (n: string) => path.join(tmp, n)

/** 소리의 주파수를 0 교차 횟수로 어림한다(사인파 시험용) */
function frequencyHz(file: string): number {
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], { maxBuffer: 64 * 1024 * 1024 })
  const n = pcm.length / 2
  let crossings = 0
  let prev = pcm.readInt16LE(0)
  for (let k = 1; k < n; k++) {
    const cur = pcm.readInt16LE(k * 2)
    if ((prev < 0 && cur >= 0) || (prev >= 0 && cur < 0)) crossings++
    prev = cur
  }
  return crossings / 2 / (n / 16000)
}

beforeAll(async () => {
  fx = await ensureFixtures()
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vae-tempo-'))
})
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

describe('scaleSec', () => {
  test('시각을 속도로 나눈다', () => {
    expect(scaleSec(11, 1.1)).toBeCloseTo(10, 6)
    expect(scaleSec(5, 1)).toBe(5)
  })
})

describe('applyTempo — 실제 ffmpeg', () => {
  test('1.1배속: 길이 5/1.1 ±0.1초, 화면 크기·30fps 유지, 소리 있음', async () => {
    const out = await applyTempo({ inputPath: fx.landscape, outPath: f('t11.mp4'), speed: 1.1, hasAudio: true })
    expect(out).toBe(f('t11.mp4'))
    const info = await probeVideo(out)
    expect(info.durationSec).toBeGreaterThan(5 / 1.1 - 0.1)
    expect(info.durationSec).toBeLessThan(5 / 1.1 + 0.1)
    expect([info.width, info.height]).toEqual([1920, 1080])
    expect(Math.round(info.fps)).toBe(30)
    expect(info.hasAudio).toBe(true)
  })

  test('소리 높이는 보존된다 — 440Hz 사인파를 1.25배속으로 돌려도 440Hz 근처(±3%)', async () => {
    const out = await applyTempo({ inputPath: fx.landscape, outPath: f('t125.mp4'), speed: 1.25, hasAudio: true })
    const hz = frequencyHz(out)
    expect(hz).toBeGreaterThan(440 * 0.97)
    expect(hz).toBeLessThan(440 * 1.03)
  })

  test('소리가 없는 영상은 영상만 속도를 바꾼다(소리 없음 유지)', async () => {
    const out = await applyTempo({ inputPath: fx.silent, outPath: f('silent.mp4'), speed: 1.25, hasAudio: false })
    const info = await probeVideo(out)
    expect(info.hasAudio).toBe(false)
    expect(info.durationSec).toBeGreaterThan(2 / 1.25 - 0.1)
    expect(info.durationSec).toBeLessThan(2 / 1.25 + 0.1)
  })

  test('speed 1(또는 1.001 이하)이면 파일을 만들지 않고 입력 경로를 그대로 돌려준다', async () => {
    for (const speed of [1, 1.0005, 0.9]) {
      const out = await applyTempo({ inputPath: fx.landscape, outPath: f(`none-${speed}.mp4`), speed, hasAudio: true })
      expect(out).toBe(fx.landscape)
      expect(fs.existsSync(f(`none-${speed}.mp4`))).toBe(false)
    }
  })

  test('색인(moov)이 데이터(mdat)보다 앞에 있다(faststart)', async () => {
    const out = await applyTempo({ inputPath: fx.landscape, outPath: f('fast.mp4'), speed: 1.1, hasAudio: true })
    const buf = fs.readFileSync(out)
    expect(buf.indexOf('moov')).toBeGreaterThan(-1)
    expect(buf.indexOf('moov')).toBeLessThan(buf.indexOf('mdat'))
  })

  test('ffmpeg 가 실패하면 한국어 TempoError', async () => {
    const p = applyTempo({ inputPath: f('없는파일.mp4'), outPath: f('x.mp4'), speed: 1.1, hasAudio: true })
    await expect(p).rejects.toBeInstanceOf(TempoError)
    await expect(p).rejects.toThrow(/속도/)
  })

  test('가짜 run 으로 인자를 확인한다: atempo 와 setpts 가 같은 배수', async () => {
    const calls: string[][] = []
    const fake = (async (_file: string, args: string[]) => (calls.push(args), { stdout: '', stderr: '' })) as unknown as typeof run
    await applyTempo({ inputPath: '/a.mp4', outPath: '/b.mp4', speed: 1.1, hasAudio: true }, { run: fake })
    const graph = calls[0]![calls[0]!.indexOf('-filter_complex') + 1]!
    expect(graph).toContain('setpts=PTS/1.1')
    expect(graph).toContain('atempo=1.1')
  })
})
