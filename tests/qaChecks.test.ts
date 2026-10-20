import { describe, expect, test } from 'vitest'
import type { askClaude } from '../src/core/llm.ts'
import type { PersonBox, PersonTrack } from '../src/core/person.ts'
import {
  applyCorrections,
  checkAudioLevels,
  checkBlackSegments,
  checkCueTiming,
  checkFraming,
  checkResolution,
  flagLowConfidence,
  parseBlackdetect,
  parseVolumeDetect,
  proofreadCues,
  upscaleFactor,
} from '../src/core/qaChecks.ts'
import type { CaptionCue, Word } from '../src/core/types.ts'

const SHORT = { width: 1080, height: 1920 }
const POST = { width: 1920, height: 1080 }

describe('upscaleFactor / checkResolution', () => {
  const table: [string, { width: number; height: number }, typeof SHORT, 'track' | 'none' | 'blur-fill', number, 'medium' | 'high' | null][] = [
    ['1080p 가로 → 세로 크롭', { width: 1920, height: 1080 }, SHORT, 'track', 1920 / 1080, 'medium'],
    ['4K 가로 → 세로 크롭', { width: 3840, height: 2160 }, SHORT, 'track', 1920 / 2160, null],
    ['720p 가로 → 세로 크롭', { width: 1280, height: 720 }, SHORT, 'track', 1920 / 720, 'high'],
    ['1080p 가로 → 가로 그대로', { width: 1920, height: 1080 }, POST, 'none', 1, null],
    ['세로 → 가로 블러 채움', { width: 1080, height: 1920 }, POST, 'blur-fill', 1080 / 1920, null],
  ]
  test.each(table)('%s', (_n, src, canvas, mode, factor, severity) => {
    expect(upscaleFactor(src, canvas, mode)).toBeCloseTo(factor, 3)
    const f = checkResolution(src, canvas, mode)
    if (!severity) return expect(f).toEqual([])
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ severity, fixHint: 'none' })
    expect(f[0]!.message).toContain(`${factor.toFixed(1)}배`)
  })
})

describe('parseBlackdetect / checkBlackSegments', () => {
  test('blackdetect 출력에서 검은 구간을 읽는다', () => {
    const stderr = '[blackdetect @ 0x6000] black_start:3.5 black_end:4.2 black_duration:0.7\n[blackdetect @ 0x6000] black_start:9 black_end:9.1 black_duration:0.1'
    expect(parseBlackdetect(stderr)).toEqual([{ start: 3.5, end: 4.2 }, { start: 9, end: 9.1 }])
    expect(parseBlackdetect('없음')).toEqual([])
  })
  test('0.5초 이상 검은 구간만 high, 재렌더 힌트', () => {
    const f = checkBlackSegments([{ start: 3.5, end: 4.2 }, { start: 9, end: 9.1 }])
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ severity: 'high', fixHint: 'rerender-quality', atSec: 3.5 })
  })
})

describe('parseVolumeDetect / checkAudioLevels', () => {
  test('volumedetect 출력에서 평균·최대 음량을 읽는다', () => {
    const v = parseVolumeDetect('[Parsed_volumedetect_0 @ 0x1] mean_volume: -22.3 dB\n[Parsed_volumedetect_0 @ 0x1] max_volume: -0.0 dB')
    expect(v.meanDb).toBeCloseTo(-22.3, 5)
    expect(v.maxDb).toBeCloseTo(0, 5)
  })
  test('최대가 -0.1dB 이상이면 클리핑, 평균이 -35dB 미만이면 너무 작음 (둘 다 medium)', () => {
    expect(checkAudioLevels({ meanDb: -22, maxDb: -0.0 }).map((f) => f.id)).toEqual(['audio-clipping'])
    expect(checkAudioLevels({ meanDb: -40, maxDb: -6 }).map((f) => f.id)).toEqual(['audio-quiet'])
    expect(checkAudioLevels({ meanDb: -20, maxDb: -3 })).toEqual([])
    for (const f of checkAudioLevels({ meanDb: -40, maxDb: 0 })) expect(f.severity).toBe('medium')
  })
  test('값을 못 읽으면 빈 결과 대신 던진다', () => {
    expect(() => parseVolumeDetect('아무것도 없음')).toThrow()
  })
})

describe('checkCueTiming', () => {
  const ok: CaptionCue[] = [{ text: '안녕하세요', start: 0, end: 1.5 }, { text: '반갑습니다', start: 1.5, end: 3 }]
  test('정상이면 빈 결과', () => {
    expect(checkCueTiming(ok, 10, 14)).toEqual([])
  })
  test('겹치는 큐는 high, 0.3초 미만은 medium, 글자 수 초과는 medium, 길이 밖은 medium', () => {
    const f = checkCueTiming(
      [
        { text: '가나다', start: 0, end: 2 },
        { text: '겹침', start: 1.5, end: 3 },
        { text: '짧음', start: 3, end: 3.2 },
        { text: '가나다라마바사아자차카타파하하', start: 4, end: 6 },
        { text: '밖', start: 9.9, end: 11 },
      ],
      10,
      14,
    )
    const byId = Object.fromEntries(f.map((x) => [x.id, x]))
    expect(byId['cue-overlap']).toMatchObject({ severity: 'high', fixHint: 'recaption', atSec: 1.5 })
    expect(byId['cue-short']).toMatchObject({ severity: 'medium', atSec: 3 })
    expect(byId['cue-too-long']).toMatchObject({ severity: 'medium', atSec: 4 })
    expect(byId['cue-out-of-range']).toMatchObject({ severity: 'medium', atSec: 9.9 })
  })
})

describe('flagLowConfidence', () => {
  const word = (text: string, confidence: number, start = 1): Word => ({ text, start, end: start + 0.4, confidence })
  test('신뢰도가 기준(기본 0.5) 미만인 단어를 알린다', () => {
    const f = flagLowConfidence([word('백싱', 0.19, 3), word('좋아요', 0.9)])
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ id: 'low-confidence', severity: 'medium', fixHint: 'recaption', atSec: 3 })
    expect(f[0]!.message).toContain('백싱')
    expect(f[0]!.message).toContain('19%')
  })
  test('기준을 바꿀 수 있다', () => {
    expect(flagLowConfidence([word('가', 0.6)], 0.7)).toHaveLength(1)
    expect(flagLowConfidence([word('가', 0.6)], 0.5)).toHaveLength(0)
  })
})

describe('proofreadCues / applyCorrections', () => {
  const cues: CaptionCue[] = [{ text: '백싱을 낮게', start: 0, end: 1 }, { text: '좋아요', start: 1, end: 2 }]

  function fakeAsk(reply: unknown) {
    const calls: { prompt: string; schema?: { safeParse: (v: unknown) => { success: boolean } } }[] = []
    const ask = (async (o: (typeof calls)[number]) => {
      calls.push(o)
      return reply
    }) as unknown as typeof askClaude
    return { calls, ask }
  }

  test('주제 맥락과 번호 붙인 자막을 보내고, 의미 있는 교정만 돌려준다', async () => {
    const f = fakeAsk({ corrections: [{ index: 0, text: '백스윙을 낮게', reason: 'term' }, { index: 1, text: '좋아요', reason: 'typo' }, { index: 9, text: '범위 밖', reason: 'typo' }] })
    const out = await proofreadCues(cues, { topic: '롱아이언', genre: '골프 레슨' }, { ask: f.ask })
    expect(out).toEqual([{ index: 0, text: '백스윙을 낮게', reason: 'term' }])
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0]!.prompt).toContain('골프 레슨')
    expect(f.calls[0]!.prompt).toContain('0: 백싱을 낮게')
  })
  test('신뢰도가 낮은 의심 단어를 알려 주면 프롬프트에서 특히 살피라고 한다', async () => {
    const f = fakeAsk({ corrections: [] })
    await proofreadCues(cues, { topic: '롱아이언', genre: '골프 레슨', suspectWords: ['동화연칠', '요렁이'] }, { ask: f.ask })
    expect(f.calls[0]!.prompt).toContain('동화연칠')
    expect(f.calls[0]!.prompt).toContain('요렁이')
    const none = fakeAsk({ corrections: [] })
    await proofreadCues(cues, { topic: 'a', genre: 'b' }, { ask: none.ask })
    expect(none.calls[0]!.prompt).not.toContain('의심')
  })
  test('스키마는 이상한 reason 과 음수 index 를 거부한다', async () => {
    const f = fakeAsk({ corrections: [] })
    await proofreadCues(cues, { topic: 'a', genre: 'b' }, { ask: f.ask })
    const schema = f.calls[0]!.schema!
    expect(schema.safeParse({ corrections: [{ index: 0, text: 'x', reason: 'typo' }] }).success).toBe(true)
    expect(schema.safeParse({ corrections: [{ index: 0, text: 'x', reason: '기분' }] }).success).toBe(false)
    expect(schema.safeParse({ corrections: [{ index: -1, text: 'x', reason: 'typo' }] }).success).toBe(false)
  })
  test('큐가 없으면 LLM 을 부르지 않는다', async () => {
    const f = fakeAsk({ corrections: [] })
    expect(await proofreadCues([], { topic: 'a', genre: 'b' }, { ask: f.ask })).toEqual([])
    expect(f.calls).toHaveLength(0)
  })
  test('applyCorrections: 범위 밖 index 는 무시하고 원본 배열은 바꾸지 않는다', () => {
    const out = applyCorrections(cues, [{ index: 0, text: '백스윙을 낮게', reason: 'term' }, { index: 99, text: '무시', reason: 'typo' }])
    expect(out.map((c) => c.text)).toEqual(['백스윙을 낮게', '좋아요'])
    expect(out[0]).toMatchObject({ start: 0, end: 1 })
    expect(cues[0]!.text).toBe('백싱을 낮게')
  })
})

describe('checkFraming', () => {
  const box = (cx: number, w = 0.2, kind: 'human' | 'face' = 'human'): PersonBox => ({ x: cx - w / 2, y: 0.2, w, h: 0.6, confidence: 0.9, kind })
  const track = (boxesOf: (i: number) => PersonBox[], n = 10): PersonTrack => ({ width: 1080, height: 1920, samples: Array.from({ length: n }, (_, i) => ({ t: i * 0.25, boxes: boxesOf(i) })) })

  test('인물이 중앙 근처면 빈 결과', () => {
    expect(checkFraming(track(() => [box(0.5)]), 'track', SHORT)).toEqual([])
  })
  test('인물이 가장자리에 치우치면 high + recrop', () => {
    const f = checkFraming(track(() => [box(0.05, 0.1)]), 'track', SHORT)
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ id: 'framing', severity: 'high', fixHint: 'recrop' })
  })
  test('중심은 범위 안이어도 몸이 화면 가장자리에 닿아 잘렸으면 나쁜 샘플로 센다', () => {
    const cut: PersonBox = { x: 0, y: 0.2, w: 0.6, h: 0.6, confidence: 0.9, kind: 'human' } // 중심 0.3, 왼쪽 끝에 닿음
    expect(checkFraming(track(() => [cut]), 'track', SHORT)[0]).toMatchObject({ severity: 'high' })
  })
  test('좋은 샘플이 80% 이상이면 통과, 70% 면 실패', () => {
    expect(checkFraming(track((i) => [box(i < 9 ? 0.5 : 0.05, i < 9 ? 0.2 : 0.1)]), 'track', SHORT)).toEqual([])
    expect(checkFraming(track((i) => [box(i < 7 ? 0.5 : 0.05, i < 7 ? 0.2 : 0.1)]), 'track', SHORT)).toHaveLength(1)
  })
  test('사람이 전혀 없으면 info', () => {
    const f = checkFraming(track(() => []), 'track', SHORT)
    expect(f).toHaveLength(1)
    expect(f[0]).toMatchObject({ id: 'framing-no-person', severity: 'info', fixHint: 'none' })
  })
  test('track 이 아니면 구도를 따지지 않는다', () => {
    expect(checkFraming(track(() => [box(0.05, 0.1)]), 'blur-fill', POST)).toEqual([])
    expect(checkFraming(track(() => []), 'none', POST)).toEqual([])
  })
})
