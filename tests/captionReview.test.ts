import { describe, expect, test } from 'vitest'
import { applyTranscriptEdits, reviewParts, REVIEW_LIMITS } from '../src/core/captionReview.ts'
import { segmentWords } from '../src/core/transcribe.ts'
import type { Transcript, Word } from '../src/core/types.ts'

const w = (text: string, start: number, end: number, confidence = 0.9): Word => ({ text, start, end, confidence })
const tr = (words: Word[]): Transcript => ({ language: 'ko', durationSec: 10, words, segments: segmentWords(words), hasSpeech: words.length > 0 })

/** 줄 0 = 앞 네 단어(14자), 줄 1 = 뒤 세 단어(9자, 앞과 1.0초 떨어짐) */
const WORDS = [
  w('이렇게', 0, 0.5, 0.2), w('되면서', 0.5, 1.0, 0.3), w('해네도', 1.0, 1.6, 0.4), w('올라오고,', 1.6, 2.4, 0.9),
  w('이게', 3.4, 3.8, 0.1), w('섀도우', 3.8, 4.4, 0.45), w('생활을', 4.4, 5.0, 0.5),
]

describe('reviewParts', () => {
  test('한도 값', () => {
    expect(REVIEW_LIMITS).toEqual({ maxChars: 18, maxGapSec: 0.7, lowConfidence: 0.5, maxTextChars: 160 })
  })

  test('글자 수(공백 뺀)가 18자를 넘기게 되면 줄을 나눈다', () => {
    const ws = [w('가나다라마', 0, 0.5), w('가나다라마', 0.5, 1), w('가나다라마', 1, 1.5), w('가나다라마', 1.5, 2)]
    expect(reviewParts(tr(ws)).map((p) => p.text)).toEqual(['가나다라마 가나다라마 가나다라마', '가나다라마'])
  })

  test('0.7초를 넘게 쉬면 나누고, 짧게 쉬면 한 줄', () => {
    expect(reviewParts(tr([w('가', 0, 0.5), w('나', 1.1, 1.5)])).map((p) => p.text)).toEqual(['가 나'])
    expect(reviewParts(tr([w('가', 0, 0.5), w('나', 1.4, 1.8)])).map((p) => p.text)).toEqual(['가', '나'])
  })

  test('문장부호(. ? !)로 끝난 단어 뒤에서 나눈다', () => {
    expect(reviewParts(tr([w('안녕하세요.', 0, 0.8), w('반갑습니다', 0.9, 1.6)])).map((p) => p.text)).toEqual(['안녕하세요.', '반갑습니다'])
  })

  test('글자 수 한도보다 긴 한 단어는 혼자 한 줄이다', () => {
    const long = '가'.repeat(25)
    expect(reviewParts(tr([w('앞', 0, 0.3), w(long, 0.3, 1), w('뒤', 1, 1.3)])).map((p) => p.text)).toEqual(['앞', long, '뒤'])
  })

  test('신뢰도 0.5 미만인 단어만 lowWords(0.5 는 아니다)', () => {
    const parts = reviewParts(tr(WORDS))
    expect(parts[0]!.lowWords).toEqual(['이렇게', '되면서', '해네도'])
    expect(parts[1]!.lowWords).toEqual(['이게', '섀도우'])
  })

  test('줄 번호는 0부터, 시각·from/to 가 단어 구간을 정확히 가리킨다', () => {
    const t = tr(WORDS)
    const parts = reviewParts(t)
    expect(parts.map((p) => [p.i, p.start, p.end, p.from, p.to])).toEqual([[0, 0, 2.4, 0, 4], [1, 3.4, 5, 4, 7]])
    for (const p of parts) expect(t.words.slice(p.from, p.to).map((x) => x.text).join(' ')).toBe(p.text)
  })

  test('단어가 없으면 빈 목록', () => {
    expect(reviewParts(tr([]))).toEqual([])
  })
})

describe('applyTranscriptEdits', () => {
  const t = tr(WORDS)

  test('edits 가 null·빈 배열이면 같은 값을 돌려준다', () => {
    expect(applyTranscriptEdits(t, null)).toBe(t)
    expect(applyTranscriptEdits(t, undefined)).toBe(t)
    expect(applyTranscriptEdits(t, [])).toBe(t)
  })

  test('고친 줄만 바뀌고 다른 줄의 단어는 시각·신뢰도까지 그대로다', () => {
    const out = applyTranscriptEdits(t, [{ i: 1, text: '이게 섀도우 스윙을' }])
    expect(out.words.slice(0, 4)).toEqual(WORDS.slice(0, 4))
    expect(out.words.slice(4).map((x) => x.text)).toEqual(['이게', '섀도우', '스윙을'])
  })

  test('새 단어들은 줄의 시작~끝 안에서 글자 수에 비례해 이어 붙고, 신뢰도는 1이다', () => {
    const out = applyTranscriptEdits(t, [{ i: 1, text: '이게 섀도우 스윙을' }])
    const [a, b, c] = out.words.slice(4) as [Word, Word, Word]
    expect(a.start).toBeCloseTo(3.4, 3)
    expect(c.end).toBeCloseTo(5, 3)
    expect(a.end).toBeCloseTo(b.start, 3)
    expect(b.end).toBeCloseTo(c.start, 3)
    expect(a.end - a.start).toBeCloseTo(0.4, 2) // 2글자 / 8글자 × 1.6초
    expect(b.end - b.start).toBeCloseTo(0.6, 2)
    expect([a, b, c].every((x) => x.confidence === 1)).toBe(true)
  })

  test('segments 가 고친 글자로 다시 만들어진다', () => {
    const out = applyTranscriptEdits(t, [{ i: 1, text: '이게 섀도우 스윙을' }])
    expect(out.segments.map((s) => s.text).join(' ')).toContain('이게 섀도우 스윙을')
    expect(out.hasSpeech).toBe(true)
  })

  test('지우는 줄(null·공백뿐)은 단어가 빠지고 segments 도 줄어든다', () => {
    for (const text of [null, '   ']) {
      const out = applyTranscriptEdits(t, [{ i: 0, text }])
      expect(out.words).toEqual(WORDS.slice(4))
      expect(out.segments).toHaveLength(1)
    }
  })

  test('모든 줄을 지우면 hasSpeech=false 이고 던지지 않는다', () => {
    const out = applyTranscriptEdits(t, [{ i: 0, text: null }, { i: 1, text: '' }])
    expect(out).toMatchObject({ words: [], segments: [], hasSpeech: false })
  })

  test('범위 밖 줄 번호·글자가 아닌 text 는 무시한다', () => {
    const out = applyTranscriptEdits(t, [{ i: 9, text: 'x' }, { i: -1, text: 'y' }, { i: 0, text: 5 as never }, { i: 1.5, text: 'z' }])
    expect(out).toEqual(t)
  })

  test('같은 줄을 두 번 고치면 마지막이 이긴다', () => {
    const out = applyTranscriptEdits(t, [{ i: 1, text: '처음' }, { i: 1, text: '나중' }])
    expect(out.words.slice(4).map((x) => x.text)).toEqual(['나중'])
  })

  test('원문과 같은 글자로 "고치면" 단어가 그대로다(신뢰도도 그대로)', () => {
    const out = applyTranscriptEdits(t, [{ i: 1, text: '  이게   섀도우 생활을 ' }])
    expect(out.words).toEqual(WORDS)
  })

  test('글자가 160자를 넘으면 160자까지만 쓴다', () => {
    const out = applyTranscriptEdits(t, [{ i: 1, text: `${'가'.repeat(100)} ${'나'.repeat(100)}` }])
    const text = out.words.slice(4).map((x) => x.text).join(' ') // 공백까지 세어 160자(API 의 text 한도와 같은 기준)
    expect(Array.from(text).length).toBe(160)
  })

  test('원본 transcript 는 바뀌지 않는다', () => {
    const before = JSON.stringify(t)
    applyTranscriptEdits(t, [{ i: 0, text: '새 글' }, { i: 1, text: null }])
    expect(JSON.stringify(t)).toBe(before)
  })
})

describe('segmentWords', () => {
  test('0.8초 넘게 쉬거나 문장부호로 끝나면 나눈다', () => {
    const ws = [w('가', 0, 0.5), w('나', 1.5, 2), w('다?', 2.1, 2.6), w('라', 2.7, 3)]
    expect(segmentWords(ws).map((s) => s.text)).toEqual(['가', '나 다?', '라'])
  })
})
