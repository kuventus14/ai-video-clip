import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, test } from 'vitest'
import { run } from '../src/core/exec.ts'
import type { askClaude } from '../src/core/llm.ts'
import { probeVideo } from '../src/core/media.ts'
import { analyzeReference, computeCutStats, detectSceneCuts, FEASIBILITY, parseSceneTimes, StyleSpec } from '../src/core/styleSpec.ts'

let cutsVideo: string // 320x240, 6초, 2초·4초에 밝기가 확 바뀜 (ffmpeg 장면 감지는 밝기 차이를 본다 — 빨강→초록은 밝기가 비슷해 컷으로 안 잡힌다)

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuts-'))
  cutsVideo = path.join(dir, 'cuts.mp4')
  const colors = ['black', 'white', 'gray']
  const args = ['-v', 'error', '-y']
  for (const c of colors) args.push('-f', 'lavfi', '-i', `color=c=${c}:s=320x240:r=30:d=2`)
  args.push('-filter_complex', 'concat=n=3:v=1:a=0', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', cutsVideo)
  await run('ffmpeg', args)
})

const QUAL = {
  hook: { endSec: 3, description: '인물이 질문을 던지며 시작' },
  captions: { present: true, position: 'bottom', size: 'large', color: '#FFFFFF', highlightColor: '#FFE600', maxCharsPerLine: 14 },
  hookTitle: { present: true, text: '롱아이언 꿀팁' },
  transitions: { dominant: 'punch-zoom' },
  music: { present: true, energy: 'high', mood: '경쾌한 비트' },
  structure: ['질문 훅', '핵심 설명', '마무리 한마디'],
}

describe('parseSceneTimes', () => {
  test('showinfo 출력에서 장면 전환 시각을 뽑는다', () => {
    const stderr = [
      '[Parsed_showinfo_1 @ 0x600] n:   0 pts:  60060 pts_time:2.002   duration:  1001 fmt:yuv420p',
      'frame= 60 fps=0.0 q=-0.0 size=N/A',
      '[Parsed_showinfo_1 @ 0x600] n:   1 pts: 120120 pts_time:4.004   duration:  1001 fmt:yuv420p',
    ].join('\n')
    expect(parseSceneTimes(stderr)).toEqual([2.002, 4.004])
  })
  test('없으면 빈 배열', () => {
    expect(parseSceneTimes('아무것도 없음')).toEqual([])
  })
})

describe('computeCutStats', () => {
  test('컷 2개, 6초 → 샷 3개, 평균 2초, 분당 컷 20', () => {
    expect(computeCutStats([2, 4], 6)).toEqual({ shotCount: 3, avgShotLengthSec: 2, cutsPerMinute: 20 })
  })
  test('컷이 없으면 샷 1개', () => {
    expect(computeCutStats([], 10)).toEqual({ shotCount: 1, avgShotLengthSec: 10, cutsPerMinute: 0 })
  })
})

describe('detectSceneCuts', () => {
  test('색이 2초·4초에 바뀌는 영상에서 두 컷을 찾는다', async () => {
    const cuts = await detectSceneCuts(cutsVideo)
    expect(cuts).toHaveLength(2)
    expect(cuts[0]).toBeGreaterThan(1.85)
    expect(cuts[0]).toBeLessThan(2.15)
    expect(cuts[1]).toBeGreaterThan(3.85)
    expect(cuts[1]).toBeLessThan(4.15)
  })
  test('maxSec 이후의 컷은 보지 않는다', async () => {
    expect(await detectSceneCuts(cutsVideo, { maxSec: 3 })).toHaveLength(1)
  })
})

describe('FEASIBILITY', () => {
  test('따라 할 수 있는 정도를 항목별로 정직하게 표시한다', () => {
    expect(FEASIBILITY).toEqual({
      pacing: 'exact',
      captions: 'approximate',
      hookTitle: 'approximate',
      transitions: 'approximate',
      music: 'unsupported',
      structure: 'unsupported',
      orientation: 'exact',
    })
  })
})

describe('analyzeReference', () => {
  function fakeAsk() {
    const calls: { images?: string[]; prompt: string; schema?: { safeParse: (v: unknown) => { success: boolean } } }[] = []
    const ask = (async (o: (typeof calls)[number]) => {
      calls.push(o)
      return QUAL
    }) as unknown as typeof askClaude
    return { calls, ask }
  }

  test('측정값은 ffmpeg 로, 정성값은 LLM 으로 채우고 feasibility 는 상수에서 가져온다', async () => {
    const { calls, ask } = fakeAsk()
    const info = await probeVideo(cutsVideo)
    const spec = await analyzeReference({ path: cutsVideo, info }, { ask })
    expect(StyleSpec.safeParse(spec).success).toBe(true)
    expect(spec.orientation).toBe('landscape')
    expect(spec.durationSec).toBeCloseTo(6, 0)
    expect(spec.pacing.shotCount).toBe(3)
    expect(spec.pacing.cutsPerMinute).toBeCloseTo(20, 0)
    expect(spec.captions.position).toBe('bottom')
    expect(spec.feasibility.music).toBe('unsupported')
    expect(calls).toHaveLength(1)
    expect(calls[0]!.images).toHaveLength(8)
  })

  test('LLM 에 넘기는 스키마는 이상한 자막 위치를 거부한다', async () => {
    const { calls, ask } = fakeAsk()
    await analyzeReference({ path: cutsVideo, info: await probeVideo(cutsVideo) }, { ask })
    const schema = calls[0]!.schema!
    expect(schema.safeParse(QUAL).success).toBe(true)
    expect(schema.safeParse({ ...QUAL, captions: { ...QUAL.captions, position: 'left' } }).success).toBe(false)
  })

  test('분석 중 만든 임시 프레임 파일을 남기지 않는다', async () => {
    const { ask } = fakeAsk()
    const before = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('vae-ref-')).length
    await analyzeReference({ path: cutsVideo, info: await probeVideo(cutsVideo) }, { ask })
    const after = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('vae-ref-')).length
    expect(after).toBe(before)
  })
})
