import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, test } from 'vitest'
import { detectSilences, parseSilences, planCuts, type CutPlan } from '../src/core/cuts.ts'
import { run } from '../src/core/exec.ts'
import type { Transcript, Word } from '../src/core/types.ts'
import { ensureFixtures, type Fixtures } from './helpers/fixtures.ts'

const w = (text: string, start: number, end: number): Word => ({ text, start, end, confidence: 0.9 })

function tr(words: Word[], segments?: Transcript['segments'], durationSec = 10): Transcript {
  return {
    language: 'ko',
    durationSec,
    words,
    hasSpeech: words.length > 0,
    segments: segments ?? (words.length ? [{ text: words.map((x) => x.text).join(' '), start: words[0]!.start, end: words.at(-1)!.end }] : []),
  }
}

const sum = (spans: { start: number; end: number }[]) => spans.reduce((s, x) => s + (x.end - x.start), 0)
const plan = (t: Transcript, silences: { start: number; end: number }[], pad = 0.25, duration = 10): CutPlan => planCuts({ transcript: t, silences, durationSec: duration, padSec: pad })

describe('parseSilences', () => {
  test('silencedetect 출력에서 무음 구간을 짝지어 읽는다', () => {
    const stderr = [
      '[silencedetect @ 0x6000] silence_start: 4',
      '[silencedetect @ 0x6000] silence_end: 6 | silence_duration: 2',
      '[silencedetect @ 0x6000] silence_start: 8.5',
      '[silencedetect @ 0x6000] silence_end: 9.25 | silence_duration: 0.75',
    ].join('\n')
    expect(parseSilences(stderr)).toEqual([{ start: 4, end: 6 }, { start: 8.5, end: 9.25 }])
  })
  test('끝나지 않은 무음(영상 끝까지)은 end 가 Infinity', () => {
    expect(parseSilences('[silencedetect @ 0x1] silence_start: 7.5')).toEqual([{ start: 7.5, end: Infinity }])
  })
  test('없으면 빈 배열', () => {
    expect(parseSilences('아무것도 없음')).toEqual([])
  })
})

describe('detectSilences', () => {
  let fx: Fixtures
  let gap: string
  beforeAll(async () => {
    fx = await ensureFixtures()
    gap = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gap-')), 'gap.wav')
    await run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:d=2', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:d=2', '-filter_complex', 'concat=n=3:v=0:a=1', gap])
  }, 120_000)

  test('2~4초가 조용한 오디오에서 그 구간을 찾는다', async () => {
    const s = await detectSilences(gap)
    expect(s).toHaveLength(1)
    expect(s[0]!.start).toBeGreaterThan(1.9)
    expect(s[0]!.start).toBeLessThan(2.2)
    expect(s[0]!.end).toBeGreaterThan(3.8)
    expect(s[0]!.end).toBeLessThan(4.1)
  })
  test('오디오가 없는 영상은 빈 배열', async () => {
    expect(await detectSilences(fx.silent)).toEqual([])
  })
})

describe('planCuts', () => {
  const speech = tr([w('시작', 0.2, 0.8), w('끝', 6.2, 6.8)])

  test('무음(≥0.7초)은 양끝 여백을 남기고 제거한다 (4~6초, 여백 0.25 → 4.25~5.75)', () => {
    const p = plan(speech, [{ start: 4, end: 6 }])
    expect(p.removed).toContainEqual({ start: 4.25, end: 5.75, reason: 'silence' })
  })

  test('0.7초 미만의 짧은 쉼은 그대로 둔다', () => {
    const p = plan(speech, [{ start: 10 - 3, end: 7.5 }])
    expect(p.removed).toEqual([])
  })

  test('영상 맨 앞·맨 끝의 무음은 가장자리까지 제거한다', () => {
    const p = plan(tr([w('말', 2.1, 2.6), w('끝', 7.4, 7.9)]), [{ start: 0, end: 2 }, { start: 8, end: Infinity }])
    expect(p.removed).toContainEqual({ start: 0, end: 1.75, reason: 'silence' })
    expect(p.removed).toContainEqual({ start: 8.25, end: 10, reason: 'silence' })
  })

  test('단독 군더더기("음")는 제거하고, 일반 단어·짧은 군더더기는 건드리지 않는다', () => {
    const t = tr([w('오늘', 0, 0.5), w('음', 3.0, 3.5), w('어머니', 4, 4.6), w('아침', 5, 5.5), w('어', 6, 6.1)])
    const p = plan(t, [])
    expect(p.removed).toEqual([{ start: 3.0, end: 3.5, reason: 'filler' }])
  })

  test('같은 문장을 다시 말하면 앞쪽 세그먼트를 NG 로 제거한다', () => {
    const t = tr(
      [w('오늘은', 0, 1), w('롱아이언', 1, 2), w('치는', 2, 2.5), w('법', 2.5, 3), w('오늘은', 3.5, 4.5), w('롱아이언', 4.5, 5.5), w('치는', 5.5, 6), w('법', 6, 6.5)],
      [{ text: '오늘은 롱아이언 치는 법', start: 0, end: 3 }, { text: '오늘은 롱아이언 치는 법', start: 3.5, end: 6.5 }],
    )
    const p = plan(t, [])
    expect(p.removed).toContainEqual({ start: 0, end: 3, reason: 'retake' })
    expect(p.kept[0]!.start).toBeGreaterThanOrEqual(3)
  })

  test('세 단어 미만의 짧은 반복("네"→"네")은 NG 로 보지 않는다', () => {
    const t = tr([w('네', 0, 0.4), w('네', 1, 1.4)], [{ text: '네', start: 0, end: 0.4 }, { text: '네', start: 1, end: 1.4 }])
    expect(plan(t, []).removed).toEqual([])
  })

  test('제거 구간은 일반 단어의 내부를 가르지 않는다 (단어 시간이 무음 쪽으로 번진 경우)', () => {
    const t = tr([w('다', 3.8, 4.4), w('끝', 7, 7.5)])
    const p = plan(t, [{ start: 4, end: 6.5 }])
    const r = p.removed.find((x) => x.reason === 'silence')!
    expect(r.start).toBeGreaterThanOrEqual(4.4)
    expect(r.end).toBeCloseTo(6.25, 6)
  })

  test('남은 구간 + 제거 구간 = 전체 길이, 둘 다 시간순·비중첩', () => {
    const t = tr([w('가', 0.2, 0.6), w('음', 2, 2.4), w('나', 3, 3.5), w('다', 8, 8.5)])
    const p = plan(t, [{ start: 3.6, end: 7.9 }])
    expect(sum(p.kept) + sum(p.removed)).toBeCloseTo(10, 6)
    expect(p.keptDurationSec).toBeCloseTo(sum(p.kept), 6)
    for (const list of [p.kept, p.removed]) for (let i = 1; i < list.length; i++) expect(list[i]!.start).toBeGreaterThanOrEqual(list[i - 1]!.end)
  })

  test('음성이 없는 영상은 컷 없이 전체를 유지한다 (무음 제거도 안 함)', () => {
    const p = plan(tr([]), [{ start: 1, end: 9 }])
    expect(p.kept).toEqual([{ start: 0, end: 10 }])
    expect(p.removed).toEqual([])
    expect(p.keptDurationSec).toBe(10)
  })

  test('0.3초 미만으로 남는 조각: 말이 없으면 이웃 제거 구간과 합친다', () => {
    // 무음 두 곳 사이에 0.2초만 남게 되는 경우 (여백 0 으로 계산)
    const t = tr([w('앞', 0.1, 0.5), w('뒤', 9, 9.5)])
    const p = plan(t, [{ start: 1, end: 4 }, { start: 4.2, end: 8 }], 0)
    for (const k of p.kept) expect(k.end - k.start).toBeGreaterThanOrEqual(0.3 - 1e-9)
    expect(sum(p.kept) + sum(p.removed)).toBeCloseTo(10, 6)
  })

  test('0.3초 미만으로 남는 조각: 말이 들어 있으면 그 말을 지키려고 짧은 쪽 제거를 취소한다', () => {
    const t = tr([w('앞', 0.1, 0.5), w('네', 4.05, 4.15), w('뒤', 9, 9.5)])
    const p = plan(t, [{ start: 1, end: 4 }, { start: 4.2, end: 8 }], 0)
    for (const x of p.removed) expect(x.start < 4.15 && x.end > 4.05).toBe(false) // '네' 는 살아 있다
    for (const k of p.kept) expect(k.end - k.start).toBeGreaterThanOrEqual(0.3 - 1e-9)
  })
})
