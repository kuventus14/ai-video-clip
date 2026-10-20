import { describe, expect, test } from 'vitest'
import type { askClaude } from '../src/core/llm.ts'
import type { extractFrames } from '../src/core/media.ts'
import type { Transcript, VideoInfo } from '../src/core/types.ts'
import { describeVideo, VideoSummary } from '../src/core/understand.ts'

const info: VideoInfo = { path: '/v/골프.mp4', durationSec: 60, width: 1080, height: 1920, fps: 30, hasAudio: true, videoBitrate: 2_000_000 }
const transcript: Transcript = {
  language: 'ko',
  durationSec: 60,
  hasSpeech: true,
  words: [],
  segments: [{ text: '롱아이언 칠 때 백스윙은 낮고 넓게 가져가세요', start: 0, end: 5 }],
}
const silentTranscript: Transcript = { ...transcript, hasSpeech: false, segments: [] }

const CORE = {
  topic: '롱아이언 레슨',
  genre: '골프 레슨',
  oneLine: '롱아이언 백스윙을 낮고 넓게 하는 팁',
  language: 'ko',
  hasPeople: true,
  hookTitle: '롱아이언 이것만 기억',
  searchQueries: ['롱아이언 레슨', '롱아이언 백스윙', '골프 아이언 팁'],
}

function setup() {
  const asks: { prompt: string; images?: string[]; schema?: { safeParse: (v: unknown) => { success: boolean } } }[] = []
  const ask = (async (o: (typeof asks)[number]) => {
    asks.push(o)
    return CORE
  }) as unknown as typeof askClaude
  const frameCalls: { times: number[]; dir: string }[] = []
  const frames = (async (_p: string, times: number[], dir: string) => {
    frameCalls.push({ times, dir })
    return times.map((_, i) => `${dir}/f${i}.jpg`)
  }) as unknown as typeof extractFrames
  return { asks, ask, frameCalls, frames }
}

describe('describeVideo', () => {
  test('설명이 있으면 source=user, 이미지 없이 설명을 프롬프트에 넣는다', async () => {
    const s = setup()
    const out = await describeVideo({ info, transcript, userDescription: '골프 레슨 영상입니다', workDir: '/w' }, { ask: s.ask, frames: s.frames })
    expect(out.source).toBe('user')
    expect(s.asks).toHaveLength(1)
    expect(s.asks[0]!.images ?? []).toHaveLength(0)
    expect(s.asks[0]!.prompt).toContain('골프 레슨 영상입니다')
    expect(s.frameCalls).toHaveLength(0)
  })

  test('설명이 비었거나 공백이면 source=analyzed, 프레임 6장을 균등하게 뽑아 첨부한다', async () => {
    const s = setup()
    const out = await describeVideo({ info, transcript, userDescription: '  ', workDir: '/w' }, { ask: s.ask, frames: s.frames })
    expect(out.source).toBe('analyzed')
    expect(s.frameCalls).toHaveLength(1)
    const { times } = s.frameCalls[0]!
    expect(times).toHaveLength(6)
    expect(times[0]).toBeCloseTo(5, 5)
    expect(times[5]).toBeCloseTo(55, 5)
    expect(s.asks[0]!.images).toHaveLength(6)
  })

  test('전사 앞부분을 프롬프트에 넣는다', async () => {
    const s = setup()
    await describeVideo({ info, transcript, workDir: '/w' }, { ask: s.ask, frames: s.frames })
    expect(s.asks[0]!.prompt).toContain('롱아이언 칠 때 백스윙은 낮고 넓게')
  })

  test('음성이 없으면 프롬프트에 "음성 없음" 을 밝힌다', async () => {
    const s = setup()
    await describeVideo({ info: { ...info, hasAudio: false }, transcript: silentTranscript, workDir: '/w' }, { ask: s.ask, frames: s.frames })
    expect(s.asks[0]!.prompt).toContain('음성 없음')
  })

  test('결과의 source 는 LLM 이 아니라 코드가 정하고 나머지 필드는 그대로 둔다', async () => {
    const s = setup()
    const out = await describeVideo({ info, transcript, userDescription: '골프', workDir: '/w' }, { ask: s.ask, frames: s.frames })
    expect(out).toEqual({ ...CORE, source: 'user' })
  })

  test('ask 에 넘기는 스키마는 검색어 3~5개, 훅 제목 16자 이하를 강제한다', async () => {
    const s = setup()
    await describeVideo({ info, transcript, workDir: '/w' }, { ask: s.ask, frames: s.frames })
    const schema = s.asks[0]!.schema!
    expect(schema.safeParse(CORE).success).toBe(true)
    expect(schema.safeParse({ ...CORE, searchQueries: ['a', 'b'] }).success).toBe(false)
    expect(schema.safeParse({ ...CORE, searchQueries: ['a', 'b', 'c', 'd', 'e', 'f'] }).success).toBe(false)
    expect(schema.safeParse({ ...CORE, hookTitle: '가'.repeat(17) }).success).toBe(false)
    expect(schema.safeParse({ ...CORE, searchQueries: ['a', '', 'c'] }).success).toBe(false)
  })

  test('VideoSummary 스키마는 source 를 포함한다', () => {
    expect(VideoSummary.safeParse({ ...CORE, source: 'analyzed' }).success).toBe(true)
    expect(VideoSummary.safeParse({ ...CORE, source: 'other' }).success).toBe(false)
  })
})
