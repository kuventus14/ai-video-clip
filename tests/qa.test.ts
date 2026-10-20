import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, test } from 'vitest'
import { run } from '../src/core/exec.ts'
import type { askClaude } from '../src/core/llm.ts'
import { probeVideo } from '../src/core/media.ts'
import type { PersonTrack } from '../src/core/person.ts'
import type { trackPeople } from '../src/core/person.ts'
import { runQa, type QaInput } from '../src/core/qa.ts'
import type { VideoInfo, Word } from '../src/core/types.ts'
import { ensureFixtures, type Fixtures } from './helpers/fixtures.ts'

const SHORT = { width: 1080, height: 1920 }
const POST = { width: 1920, height: 1080 }

let fx: Fixtures
let landscape: VideoInfo
let silent: VideoInfo
let blackVideo: string
beforeAll(async () => {
  fx = await ensureFixtures()
  landscape = await probeVideo(fx.landscape)
  silent = await probeVideo(fx.silent)
  blackVideo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'black-')), 'black.mp4')
  await run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=1080x1920:r=30:d=3', '-f', 'lavfi', '-i', 'sine=frequency=440:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', blackVideo])
}, 120_000)

const word = (text: string, start: number, confidence = 0.9): Word => ({ text, start, end: start + 0.4, confidence })
const centered: PersonTrack = { width: 1080, height: 1920, samples: Array.from({ length: 12 }, (_, i) => ({ t: i * 0.25, boxes: [{ x: 0.4, y: 0.2, w: 0.2, h: 0.6, confidence: 0.9, kind: 'human' as const }] })) }

const fakeAsk = (corrections: unknown[] = []) => {
  const calls: unknown[] = []
  const ask = (async (o: unknown) => {
    calls.push(o)
    return { corrections }
  }) as unknown as typeof askClaude
  return { calls, ask }
}
const fakeTrack = (track: PersonTrack = centered) => {
  const calls: string[] = []
  const fn = (async (p: string) => {
    calls.push(p)
    return track
  }) as unknown as typeof trackPeople
  return { calls, fn }
}

const base = (over: Partial<QaInput> = {}): QaInput => ({
  sourceInfo: landscape,
  outputPath: fx.portrait,
  canvas: SHORT,
  reframe: 'track',
  cues: [{ text: '안녕하세요', start: 0, end: 1 }],
  words: [word('안녕하세요', 0)],
  maxChars: 14,
  summary: { topic: '인사', genre: '일상' },
  ...over,
})

describe('runQa', () => {
  test('(c) 정상 영상 + 교정 없음 + 인물 중앙 → 통과 (high 없음)', async () => {
    const a = fakeAsk()
    const t = fakeTrack()
    const r = await runQa(base(), { ask: a.ask, track: t.fn })
    expect(r.passed).toBe(true)
    expect(r.findings.filter((f) => f.severity === 'high')).toEqual([])
    expect(r.corrections).toEqual([])
    expect(new Date(r.checkedAt).toString()).not.toBe('Invalid Date')
    expect(t.calls).toEqual([fx.portrait])
    // 1080p 가로를 세로로 자르면 1.8배 확대라는 사실은 medium 으로 남는다
    expect(r.findings.some((f) => f.id === 'upscale' && f.severity === 'medium')).toBe(true)
  })

  test('(a) 통째로 검은 영상은 high 이고 통과하지 못한다', async () => {
    const r = await runQa(base({ outputPath: blackVideo }), { ask: fakeAsk().ask, track: fakeTrack().fn })
    expect(r.passed).toBe(false)
    expect(r.findings.some((f) => f.id === 'black-frames' && f.severity === 'high')).toBe(true)
  })

  test('(b) 캔버스와 다른 크기는 high', async () => {
    const r = await runQa(base({ outputPath: fx.landscape }), { ask: fakeAsk().ask, track: fakeTrack().fn })
    expect(r.passed).toBe(false)
    const f = r.findings.find((x) => x.id === 'output-size')!
    expect(f.severity).toBe('high')
    expect(f.message).toContain('1920x1080')
  })

  test('(d) 음성이 없으면 자막 점검을 건너뛰고 info 를 남기며 통과한다', async () => {
    const a = fakeAsk()
    const r = await runQa(
      base({ sourceInfo: silent, outputPath: fx.silent, canvas: POST, reframe: 'none', cues: [], words: [] }),
      { ask: a.ask, track: fakeTrack().fn },
    )
    expect(r.passed).toBe(true)
    expect(r.findings.find((f) => f.id === 'no-speech')).toMatchObject({ severity: 'info' })
    expect(a.calls).toHaveLength(0) // 교정 LLM 호출 없음
    expect(r.findings.some((f) => f.id.startsWith('cue-') || f.id === 'low-confidence')).toBe(false)
  })

  test('원본엔 소리가 있었는데 결과물에 소리가 없으면 high', async () => {
    const r = await runQa(base({ sourceInfo: { ...silent, hasAudio: true }, outputPath: fx.silent, canvas: POST, reframe: 'none' }), { ask: fakeAsk().ask, track: fakeTrack().fn })
    expect(r.findings.find((f) => f.id === 'output-no-audio')).toMatchObject({ severity: 'high' })
  })

  test('(e) 교정 제안이 있으면 corrections 로 돌려주고 recaption 힌트를 남긴다', async () => {
    const a = fakeAsk([{ index: 0, text: '안녕하세요!', reason: 'spacing' }])
    const r = await runQa(base(), { ask: a.ask, track: fakeTrack().fn })
    expect(r.corrections).toEqual([{ index: 0, text: '안녕하세요!', reason: 'spacing' }])
    expect(r.findings.find((f) => f.id === 'caption-corrections')).toMatchObject({ severity: 'medium', fixHint: 'recaption' })
    expect(r.passed).toBe(true)
  })

  test('신뢰도가 낮은 단어는 findings 에 남고 교정기에 의심 단어로 전달된다', async () => {
    const a = fakeAsk()
    const r = await runQa(base({ words: [word('백싱', 0, 0.19), word('좋아요', 1)] }), { ask: a.ask, track: fakeTrack().fn })
    expect(r.findings.some((f) => f.id === 'low-confidence' && f.message.includes('백싱'))).toBe(true)
    expect((a.calls[0] as { prompt: string }).prompt).toContain('백싱')
  })

  test('track 모드가 아니면 사람 인식을 돌리지 않는다', async () => {
    const t = fakeTrack()
    await runQa(base({ sourceInfo: silent, outputPath: fx.silent, canvas: POST, reframe: 'none', cues: [], words: [] }), { ask: fakeAsk().ask, track: t.fn })
    expect(t.calls).toEqual([])
  })

  test('인물이 치우쳐 있으면 high + recrop', async () => {
    const off: PersonTrack = { ...centered, samples: centered.samples.map((s) => ({ ...s, boxes: [{ x: 0, y: 0.2, w: 0.1, h: 0.6, confidence: 0.9, kind: 'human' as const }] })) }
    const r = await runQa(base(), { ask: fakeAsk().ask, track: fakeTrack(off).fn })
    expect(r.passed).toBe(false)
    expect(r.findings.find((f) => f.id === 'framing')).toMatchObject({ severity: 'high', fixHint: 'recrop' })
  })
})
