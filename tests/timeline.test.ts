import { describe, expect, test } from 'vitest'
import { buildTimeline, groupWordsIntoCues, remapKeyframes, remapSpans, remapTime, remapWords, shiftCues, srcToOut } from '../src/core/timeline.ts'
import type { Word } from '../src/core/types.ts'

const w = (text: string, start: number, end: number): Word => ({ text, start, end, confidence: 0.9 })
const KEPT = [{ start: 0, end: 2 }, { start: 4, end: 6 }]

describe('remapTime', () => {
  test('남은 구간 안의 시각은 컷 이후 시간으로, 제거된 구간은 null', () => {
    expect(remapTime(4.5, KEPT)).toBe(2.5)
    expect(remapTime(1.9, KEPT)).toBe(1.9)
    expect(remapTime(3, KEPT)).toBeNull()
    expect(remapTime(0, KEPT)).toBe(0)
    expect(remapTime(7, KEPT)).toBeNull()
  })
  test('구간 경계 값은 그 구간의 끝/시작으로 매핑된다', () => {
    expect(remapTime(2, KEPT)).toBe(2)
    expect(remapTime(4, KEPT)).toBe(2)
    expect(remapTime(6, KEPT)).toBe(4)
  })
})

describe('remapWords', () => {
  test('완전히 제거된 단어는 빠지고, 걸친 단어는 경계로 잘린다', () => {
    const out = remapWords([w('제거', 3, 3.4), w('걸침', 1.8, 2.4), w('뒤', 4.5, 5), w('앞', 0.1, 0.5)], KEPT)
    expect(out.map((x) => x.text)).toEqual(['앞', '걸침', '뒤'])
    expect(out[1]).toMatchObject({ start: 1.8, end: 2 })
    expect(out[2]).toMatchObject({ start: 2.5, end: 3 })
  })
  test('제거 구간을 가로지르는 단어는 이어 붙은 하나의 단어가 된다', () => {
    const [x] = remapWords([w('긴단어', 1.8, 4.2)], KEPT)
    expect(x!.start).toBeCloseTo(1.8, 6)
    expect(x!.end).toBeCloseTo(2.2, 6)
  })
  test('신뢰도 같은 나머지 필드는 그대로 둔다', () => {
    expect(remapWords([{ text: '가', start: 4.2, end: 4.6, confidence: 0.33 }], KEPT)[0]!.confidence).toBe(0.33)
  })
  test('경계에 닿기만 하는 단어는 버린다', () => {
    expect(remapWords([w('닿음', 2, 2.3)], KEPT)).toEqual([])
  })
})

describe('remapSpans (I4)', () => {
  test('원본 구간을 남은 구간과 겹치는 부분만 컷 이후 시간으로 옮긴다', () => {
    expect(remapSpans([{ start: 1, end: 3 }, { start: 2.5, end: 5 }], KEPT)).toEqual([{ start: 1, end: 2 }, { start: 2, end: 3 }])
  })
  test('완전히 제거된 구간과 경계에 닿기만 하는 구간은 버린다', () => {
    expect(remapSpans([{ start: 2.2, end: 3.8 }, { start: 2, end: 2 }], KEPT)).toEqual([])
  })
  test('시작 시각 순으로 돌려준다', () => {
    expect(remapSpans([{ start: 5, end: 6 }, { start: 0, end: 1 }], KEPT)).toEqual([{ start: 0, end: 1 }, { start: 3, end: 4 }])
  })
})

describe('remapKeyframes', () => {
  const kf = [{ t: 0, centerX: 0.2 }, { t: 1, centerX: 0.3 }, { t: 3, centerX: 0.9 }, { t: 5, centerX: 0.8 }]

  test('각 남은 구간의 시작·끝에 보간한 값을 찍고 구간 사이는 점프로 이어 붙인다', () => {
    const out = remapKeyframes(kf, KEPT)
    expect(out).toEqual([
      { t: 0, centerX: 0.2 },
      { t: 1, centerX: 0.3 },
      { t: 1.999, centerX: 0.6 }, // 원본 2초: (1,0.3)~(3,0.9) 사이 보간
      { t: 2, centerX: 0.85 }, // 원본 4초: (3,0.9)~(5,0.8) 사이 보간
      { t: 3, centerX: 0.8 },
      { t: 4, centerX: 0.8 }, // 원본 6초: 마지막 키프레임 이후는 유지
    ])
  })
  test('시간은 항상 증가한다', () => {
    const out = remapKeyframes(kf, [{ start: 0.5, end: 1.5 }, { start: 3, end: 3.0005 }, { start: 4, end: 6 }])
    for (let i = 1; i < out.length; i++) expect(out[i]!.t).toBeGreaterThan(out[i - 1]!.t)
  })
  test('키프레임이 없으면 빈 배열', () => {
    expect(remapKeyframes([], KEPT)).toEqual([])
  })
})

describe('groupWordsIntoCues', () => {
  const ten = Array.from({ length: 10 }, (_, i) => w('가나다', i * 0.3, i * 0.3 + 0.25))

  test('한글 3글자 단어 10개를 maxChars 14 로 → 각 큐 글자 수 ≤14, 단어 중간에서 안 나뉨', () => {
    const cues = groupWordsIntoCues(ten, { maxChars: 14 })
    expect(cues.map((c) => c.text.split(' ').length)).toEqual([4, 4, 2])
    for (const c of cues) {
      expect(c.text.replace(/\s/g, '').length).toBeLessThanOrEqual(14)
      for (const word of c.text.split(' ')) expect(word).toBe('가나다')
    }
  })
  test('큐는 시간순이고 겹치지 않는다', () => {
    const cues = groupWordsIntoCues(ten, { maxChars: 14 })
    for (let i = 1; i < cues.length; i++) expect(cues[i]!.start).toBeGreaterThanOrEqual(cues[i - 1]!.end)
    expect(cues[0]).toMatchObject({ start: 0, end: 1.15 })
  })
  test('단어 사이가 1초 넘게 벌어지면 새 큐', () => {
    const cues = groupWordsIntoCues([w('가', 0, 0.3), w('나', 1.5, 1.8)], { maxChars: 20 })
    expect(cues.map((c) => c.text)).toEqual(['가', '나'])
  })
  test('큐가 maxDurationSec 를 넘기면 나눈다', () => {
    const slow = Array.from({ length: 4 }, (_, i) => w('말', i * 1, i * 1 + 0.9))
    const cues = groupWordsIntoCues(slow, { maxChars: 50, maxDurationSec: 2.5 })
    expect(cues.map((c) => c.text)).toEqual(['말 말', '말 말'])
  })
  test('너무 짧은 큐는 다음 큐를 침범하지 않는 선에서 minDurationSec 까지 늘린다', () => {
    const cues = groupWordsIntoCues([w('가', 0, 0.1), w('나', 3, 3.1)], { maxChars: 20, minDurationSec: 0.4 })
    expect(cues[0]).toMatchObject({ start: 0, end: 0.4 })
    const tight = groupWordsIntoCues([w('가', 0, 0.1), w('나', 1.05, 1.5)], { maxChars: 1, minDurationSec: 2 })
    expect(tight[0]!.end).toBeLessThanOrEqual(tight[1]!.start)
  })
  test('maxChars 보다 긴 단어 하나는 쪼개지 않고 혼자 큐가 된다', () => {
    const cues = groupWordsIntoCues([w('아주아주긴단어입니다', 0, 1), w('짧', 1.1, 1.3)], { maxChars: 5 })
    expect(cues.map((c) => c.text)).toEqual(['아주아주긴단어입니다', '짧'])
  })
  test('단어가 없으면 큐도 없다', () => {
    expect(groupWordsIntoCues([], { maxChars: 14 })).toEqual([])
  })
})

describe('buildTimeline — 훅을 앞에 붙인 출력 타임라인', () => {
  const kept = [{ start: 0, end: 10 }, { start: 20, end: 30 }]
  test('훅 {54,57} + 남은 구간 2개 → [훅, 0-10, 20-30], hookSec 3, totalSec 23', () => {
    expect(buildTimeline(kept, { start: 54, end: 57 })).toEqual({ segments: [{ start: 54, end: 57 }, ...kept], hookSec: 3, totalSec: 23 })
  })
  test('훅이 없으면 segments = kept, hookSec 0 (기존과 같음)', () => {
    expect(buildTimeline(kept)).toEqual({ segments: kept, hookSec: 0, totalSec: 20 })
  })
  test('훅 구간이 본편과 겹쳐도(원본 54~57 이 본편에도 있음) 그대로 앞에 붙는다', () => {
    const t = buildTimeline([{ start: 0, end: 60 }], { start: 54, end: 57 })
    expect(t.segments[0]).toEqual({ start: 54, end: 57 })
    expect(t.totalSec).toBe(63)
  })
})

describe('srcToOut — 원본 시각을 출력 시각으로', () => {
  const kept = [{ start: 0, end: 10 }, { start: 20, end: 30 }]
  test('훅 길이만큼 밀린다', () => {
    expect(srcToOut(5, kept, 3)).toBe(8)
    expect(srcToOut(25, kept, 3)).toBe(18)
  })
  test('훅이 없으면(0) 기존 remapTime 과 같다', () => {
    expect(srcToOut(25, kept, 0)).toBe(remapTime(25, kept))
  })
  test('잘려 나간 자리(15초)는 그 뒤 첫 남은 구간의 시작(출력 10+3=13)에 붙는다', () => {
    expect(srcToOut(15, kept, 3)).toBe(13)
  })
  test('첫 구간보다 앞(앞부분이 잘림)은 첫 구간 시작(훅 길이)에 붙는다', () => {
    expect(srcToOut(1, [{ start: 2, end: 8 }], 3)).toBe(3)
  })
  test('영상 밖(음수·마지막 구간 뒤)은 null', () => {
    expect(srcToOut(-1, kept, 3)).toBeNull()
    expect(srcToOut(31, kept, 3)).toBeNull()
  })
})

describe('shiftCues', () => {
  test('start·end 를 같이 밀고 다른 필드는 그대로', () => {
    expect(shiftCues([{ text: 'a', start: 1, end: 2 }], 3)).toEqual([{ text: 'a', start: 4, end: 5 }])
  })
})

describe('훅이 본편과 겹칠 때 자막과 크롭 (Review Focus 1)', () => {
  test('본편 kept 로만 만든 단어 자막은 훅 구간에 들어가지 않고, 같은 단어가 두 번 나오지 않는다', () => {
    const words = [w('가', 1, 1.5), w('스윙', 55, 55.6)] // '스윙'(55초)은 훅(54~57)에도, 본편 kept [0,60]에도 있다
    const kept = [{ start: 0, end: 60 }]
    const tl = buildTimeline(kept, { start: 54, end: 57 })
    const cues = shiftCues(groupWordsIntoCues(remapWords(words, kept), { maxChars: 20 }), tl.hookSec)
    expect(cues.map((c) => c.text)).toEqual(['가', '스윙']) // 1초 넘게 떨어진 단어라 큐가 따로 만들어진다
    for (const c of cues) expect(c.start).toBeGreaterThanOrEqual(tl.hookSec) // 훅 구간(0~3초)에는 자막이 없다
    expect(remapWords(words, kept)).toHaveLength(2) // 단어가 중복되지 않는다
  })
  test('크롭 키프레임: 훅 구간 키프레임이 맨 앞에 생기고 본편은 훅 길이만큼 뒤에서 시작한다', () => {
    const kf = [{ t: 0, centerX: 0.3 }, { t: 54, centerX: 0.8 }, { t: 60, centerX: 0.8 }]
    const tl = buildTimeline([{ start: 0, end: 10 }], { start: 54, end: 57 })
    const out = remapKeyframes(kf, tl.segments)
    expect(out[0]).toEqual({ t: 0, centerX: 0.8 }) // 훅 구간(원본 54~57)의 시선 위치
    const bodyStart = out.find((k) => k.t >= tl.hookSec)!
    expect(bodyStart.t).toBeCloseTo(3, 3)
    expect(bodyStart.centerX).toBeCloseTo(0.3, 3) // 본편(원본 0초)의 위치로 돌아온다
  })
})
