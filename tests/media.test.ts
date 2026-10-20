import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, test } from 'vitest'
import { ToolError } from '../src/core/exec.ts'
import { extractFrames, probeVideo } from '../src/core/media.ts'
import { ensureFixtures, type Fixtures } from './helpers/fixtures.ts'

let fx: Fixtures
beforeAll(async () => {
  fx = await ensureFixtures()
})

describe('probeVideo', () => {
  test('가로 영상의 크기·길이·fps·오디오·비트레이트를 읽는다', async () => {
    const info = await probeVideo(fx.landscape)
    expect(info.path).toBe(fx.landscape)
    expect(info.width).toBe(1920)
    expect(info.height).toBe(1080)
    expect(info.hasAudio).toBe(true)
    expect(info.durationSec).toBeGreaterThan(4.9)
    expect(info.durationSec).toBeLessThan(5.1)
    expect(info.fps).toBeCloseTo(30, 0)
    expect(info.videoBitrate).toBeGreaterThan(0)
  })

  test('오디오 트랙이 없으면 hasAudio=false', async () => {
    expect((await probeVideo(fx.silent)).hasAudio).toBe(false)
  })

  test('세로·정사각 영상의 크기를 읽는다', async () => {
    const p = await probeVideo(fx.portrait)
    expect([p.width, p.height]).toEqual([1080, 1920])
    const s = await probeVideo(fx.square)
    expect([s.width, s.height]).toEqual([1080, 1080])
  })

  test('한글·공백·괄호가 든 파일명도 읽는다', async () => {
    const info = await probeVideo(fx.koreanName)
    expect(info.width).toBe(1920)
    expect(info.path).toBe(fx.koreanName)
  })

  test('회전 메타데이터가 있으면 화면에 보이는 방향의 크기를 돌려준다', async () => {
    const info = await probeVideo(fx.rotated)
    expect([info.width, info.height]).toEqual([1080, 1920])
  })

  test('영상이 아닌 파일은 ToolError', async () => {
    const txt = path.join(os.tmpdir(), `not-video-${process.pid}.txt`)
    fs.writeFileSync(txt, '영상 아님')
    await expect(probeVideo(txt)).rejects.toBeInstanceOf(ToolError)
    fs.rmSync(txt)
  })
})

describe('extractFrames', () => {
  test('지정한 시각마다 비어 있지 않은 jpg 를 만들고 긴 변은 1024px 이하', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frames-'))
    const files = await extractFrames(fx.landscape, [0.5, 2], dir)
    expect(files).toHaveLength(2)
    for (const f of files) {
      expect(f.endsWith('.jpg')).toBe(true)
      expect(fs.statSync(f).size).toBeGreaterThan(0)
      const img = await probeVideo(f)
      expect(Math.max(img.width, img.height)).toBeLessThanOrEqual(1024)
    }
    fs.rmSync(dir, { recursive: true })
  })

  test('한글 파일명에서도 프레임을 뽑는다', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frames-'))
    const files = await extractFrames(fx.koreanName, [1], dir)
    expect(fs.statSync(files[0]!).size).toBeGreaterThan(0)
    fs.rmSync(dir, { recursive: true })
  })
})
