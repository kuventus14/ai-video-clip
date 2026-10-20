import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, test } from 'vitest'
import { ToolError } from '../src/core/exec.ts'
import { run } from '../src/core/exec.ts'
import { ensureH264, extractFrames, probeVideo } from '../src/core/media.ts'
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

  test('코덱과 회전 값도 읽는다', async () => {
    const info = await probeVideo(fx.landscape)
    expect(info.videoCodec).toBe('h264')
    expect(info.rotation).toBe(0)
    expect(Math.abs((await probeVideo(fx.rotated)).rotation ?? 0)).toBe(90)
  })

  test('영상이 아닌 파일은 ToolError', async () => {
    const txt = path.join(os.tmpdir(), `not-video-${process.pid}.txt`)
    fs.writeFileSync(txt, '영상 아님')
    await expect(probeVideo(txt)).rejects.toBeInstanceOf(ToolError)
    fs.rmSync(txt)
  })
})

describe('ensureH264', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'h264-'))

  test('이미 H.264 mp4 이고 회전이 없으면 그대로 쓴다', async () => {
    const info = await probeVideo(fx.landscape)
    const r = await ensureH264(fx.landscape, info, tmp())
    expect(r.converted).toBe(false)
    expect(r.path).toBe(fx.landscape)
    expect(r.info).toBe(info)
  })

  // 실험으로 확인: hyperframes 0.8.181 은 HEVC 와 회전 메타데이터가 있는 영상도 변환 없이 색·방향 맞게 렌더링한다.
  // 4K 아이폰 영상을 통째로 다시 인코딩하면 수십 분이 걸려서, 그런 흔한 입력은 그대로 쓴다.
  test('HEVC(아이폰 기본 코덱)는 hyperframes 가 그대로 읽으므로 변환하지 않는다', async () => {
    const dir = tmp()
    const hevc = path.join(dir, '아이폰 영상.mov')
    await run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:d=1', '-c:v', 'libx265', '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p', hevc])
    const info = await probeVideo(hevc)
    expect(info.videoCodec).toBe('hevc')
    const r = await ensureH264(hevc, info, dir)
    expect(r.converted).toBe(false)
    expect(r.path).toBe(hevc)
  }, 120_000)

  test('회전 메타데이터가 있는 영상과 mp4 가 아닌 H.264 컨테이너도 그대로 쓴다', async () => {
    const info = await probeVideo(fx.rotated)
    expect((await ensureH264(fx.rotated, info, tmp())).converted).toBe(false)
    const dir = tmp()
    const mov = path.join(dir, 'clip.mov')
    fs.copyFileSync(fx.silent, mov)
    expect((await ensureH264(mov, await probeVideo(mov), dir)).converted).toBe(false)
  })

  test('hyperframes 가 못 읽을 수 있는 드문 코덱(mpeg4 등)만 H.264 mp4 로 바꾼다 — 크기·길이는 그대로, 원본은 보존', async () => {
    const dir = tmp()
    const odd = path.join(dir, '옛날 영상.avi')
    await run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:d=1', '-c:v', 'mpeg4', odd])
    const info = await probeVideo(odd)
    expect(info.videoCodec).toBe('mpeg4')
    const r = await ensureH264(odd, info, dir)
    expect(r.converted).toBe(true)
    expect(r.path.endsWith('.mp4')).toBe(true)
    expect(path.dirname(r.path)).toBe(dir)
    expect(r.info.videoCodec).toBe('h264')
    expect([r.info.width, r.info.height]).toEqual([640, 360])
    expect(r.info.durationSec).toBeGreaterThan(0.9)
    expect(fs.existsSync(odd)).toBe(true)
  }, 120_000)
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
