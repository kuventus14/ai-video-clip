import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { run } from '../src/core/exec.ts'
import { cropToContent, detectContentRect, type ContentRect } from '../src/core/letterbox.ts'
import { probeVideo } from '../src/core/media.ts'
import { ensureFixtures, type Fixtures } from './helpers/fixtures.ts'

let fx: Fixtures
let tmp: string
const f = (n: string) => path.join(tmp, n)

/** 1920x1080 화면 안에 cw x ch 내용이 (x, y) 에 놓이고 나머지가 검정인 영상(소리 포함) */
async function boxed(name: string, o: { cw: number; ch: number; x: number; y: number; seconds?: number }): Promise<string> {
  const out = f(name)
  const sec = o.seconds ?? 6
  await run('ffmpeg', [
    '-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${o.cw}x${o.ch}:rate=30:duration=${sec}`, '-f', 'lavfi', '-i', `sine=frequency=440:duration=${sec}`,
    '-vf', `pad=1920:1080:${o.x}:${o.y}:black`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-c:a', 'aac', '-shortest', out,
  ])
  return out
}

const near = (r: ContentRect | null, e: ContentRect, tol = 4) => {
  expect(r).not.toBeNull()
  for (const k of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(r![k] - e[k]), k).toBeLessThanOrEqual(tol)
}

beforeAll(async () => {
  fx = await ensureFixtures()
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vae-letterbox-'))
})
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

describe('detectContentRect — 실제 ffmpeg', () => {
  test('1920x1080 안에 1920x800 내용이 있고 위아래가 검정이면 rect ≈ {0,140,1920,800}', async () => {
    const p = await boxed('top.mp4', { cw: 1920, ch: 800, x: 0, y: 140 })
    const r = await detectContentRect(p, await probeVideo(p))
    near(r, { x: 0, y: 140, width: 1920, height: 800 })
    for (const v of Object.values(r!)) expect(v % 2).toBe(0) // 짝수 정수
  })

  test('양옆 띠(필러박스)도 찾는다', async () => {
    const p = await boxed('side.mp4', { cw: 1440, ch: 1080, x: 240, y: 0 })
    near(await detectContentRect(p, await probeVideo(p)), { x: 240, y: 0, width: 1440, height: 1080 })
  })

  test('띠가 없는 영상은 null', async () => {
    expect(await detectContentRect(fx.landscape, await probeVideo(fx.landscape))).toBeNull()
  })

  test('띠가 4% 뿐이면 null(6% 미만은 건드리지 않는다)', async () => {
    const p = await boxed('thin.mp4', { cw: 1920, ch: 1040, x: 0, y: 20 }) // 위아래 20px씩 = 3.7%
    expect(await detectContentRect(p, await probeVideo(p))).toBeNull()
  })

  test('전체가 어두운 영상(검은 화면 + 약한 노이즈)은 띠로 오인해 자르지 않는다(null)', async () => {
    const p = f('dark.mp4')
    await run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:size=1920x1080:rate=30:duration=6,noise=alls=8:allf=t', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', p])
    expect(await detectContentRect(p, await probeVideo(p))).toBeNull()
  })

  test('지점마다 사각형이 다르면(앞은 띠가 있고 뒤는 꽉 찬 화면) null', async () => {
    const p = f('shaky.mp4')
    await run('ffmpeg', [
      '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1920x800:rate=30:duration=3', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=3',
      '-filter_complex', '[0:v]pad=1920:1080:0:140:black[a];[a][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', p,
    ])
    expect(await detectContentRect(p, await probeVideo(p))).toBeNull()
  })

  test('읽을 수 없는 영상이면 던지지 않고 null', async () => {
    const info = await probeVideo(fx.landscape)
    expect(await detectContentRect(f('없는파일.mp4'), info)).toBeNull()
  })

  test('ffmpeg 호출은 네 지점(20·40·60·80%)을 본다', async () => {
    const seen: string[][] = []
    const fake = async (_file: string, args: string[]) => {
      seen.push(args)
      return { stdout: '', stderr: 'crop=1920:800:0:140' }
    }
    const info = { ...(await probeVideo(fx.landscape)), durationSec: 10 }
    await detectContentRect(fx.landscape, info, { run: fake })
    const starts = seen.map((a) => Number(a[a.indexOf('-ss') + 1]))
    expect(starts).toEqual([2, 4, 6, 8])
    expect(seen.every((a) => a.join(' ').includes('cropdetect=limit=24:round=2'))).toBe(true)
  })
})

describe('cropToContent — 실제 ffmpeg', () => {
  const rect: ContentRect = { x: 0, y: 140, width: 1920, height: 800 }

  test('결과 크기가 rect 와 같고 길이·소리가 유지된다', async () => {
    const src = await boxed('crop-src.mp4', { cw: 1920, ch: 800, x: 0, y: 140, seconds: 4 })
    const out = await cropToContent({ inputPath: src, outPath: f('cropped.mp4'), rect, hasAudio: true })
    expect(out).toBe(f('cropped.mp4'))
    const a = await probeVideo(src)
    const b = await probeVideo(out)
    expect([b.width, b.height]).toEqual([1920, 800])
    expect(Math.abs(b.durationSec - a.durationSec)).toBeLessThan(0.2)
    expect(b.hasAudio).toBe(true)
    expect(b.videoCodec).toBe('h264')
  })

  test('색인(moov)이 데이터(mdat)보다 앞에 있다(faststart)', async () => {
    const buf = fs.readFileSync(f('cropped.mp4'))
    expect(buf.indexOf('moov')).toBeGreaterThan(-1)
    expect(buf.indexOf('moov')).toBeLessThan(buf.indexOf('mdat'))
  })

  test('소리가 없는 영상도 자른다', async () => {
    const out = await cropToContent({ inputPath: fx.silent, outPath: f('silent-cropped.mp4'), rect: { x: 0, y: 140, width: 1920, height: 800 }, hasAudio: false })
    const b = await probeVideo(out)
    expect([b.width, b.height, b.hasAudio]).toEqual([1920, 800, false])
  })

  test('ffmpeg 가 실패하면 던진다(호출하는 쪽이 원본으로 계속한다)', async () => {
    await expect(cropToContent({ inputPath: f('없는파일.mp4'), outPath: f('x.mp4'), rect, hasAudio: true })).rejects.toThrow()
  })
})
