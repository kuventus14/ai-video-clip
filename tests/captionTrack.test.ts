import { describe, expect, test } from 'vitest'
import { applyCaptionTrack, CAPTION_LINE_LIMITS, captionLineProblems, captionLinesOf, captionLinesWithEdits, cutTranscriptFor, normalizeCaptionLines, removedSpans, segmentWords } from '../src/shared/captionReview.ts'
import { planCuts } from '../src/core/cuts.ts'
import type { ReviewTranscript, ReviewWord } from '../src/shared/captionReview.ts'
import type { CaptionLine } from '../src/shared/types.ts'

const w = (text: string, start: number, end: number, confidence = 0.9): ReviewWord => ({ text, start, end, confidence })
const tr = (words: ReviewWord[]): ReviewTranscript => ({ words, segments: segmentWords(words), hasSpeech: words.length > 0 })

/** 줄 0 = 앞 네 단어(0~2.4초), 줄 1 = 뒤 세 단어(3.4~5초). 영상은 10초라고 본다 */
const WORDS = [w('이렇게', 0, 0.5, 0.2), w('되면서', 0.5, 1.0, 0.3), w('해네도', 1.0, 1.6, 0.4), w('올라오고,', 1.6, 2.4), w('이게', 3.4, 3.8, 0.1), w('섀도우', 3.8, 4.4, 0.45), w('생활을', 4.4, 5.0, 0.5)]
const T = tr(WORDS)
const L = (start: number, end: number, text: string): CaptionLine => ({ start, end, text })

describe('captionLinesOf', () => {
  test('인식한 줄을 시각·글자 목록으로 낸다', () => {
    expect(captionLinesOf(T)).toEqual([L(0, 2.4, '이렇게 되면서 해네도 올라오고,'), L(3.4, 5, '이게 섀도우 생활을')])
  })
  test('단어가 없으면 빈 목록', () => {
    expect(captionLinesOf(tr([]))).toEqual([])
  })
  test('시각은 소수 둘째 자리로 맞춘다', () => {
    expect(captionLinesOf(tr([w('가', 0.123456, 0.987654)]))).toEqual([L(0.12, 0.99, '가')])
  })
})

describe('captionLineProblems', () => {
  const ok = [L(0, 2.4, '가'), L(3.4, 5, '나')]
  test('한도 값', () => {
    expect(CAPTION_LINE_LIMITS).toEqual({ maxText: 160, minSec: 0.2, maxLines: 800, overlapSec: 0.01, endSlackSec: 0.5 })
  })
  test('정상이면 모두 null', () => {
    expect(captionLineProblems(ok, 10)).toEqual([null, null])
  })
  test('맞닿는 줄(앞 줄 끝 = 뒤 줄 시작)은 괜찮다', () => {
    expect(captionLineProblems([L(0, 2, '가'), L(2, 4, '나')], 10)).toEqual([null, null])
  })
  test('(Review Focus 1) 앞 줄과 겹치면 뒤 줄에 알린다', () => {
    expect(captionLineProblems([L(0, 3, '가'), L(2.5, 4, '나')], 10)).toEqual([null, '앞 줄과 겹쳐요'])
  })
  test('끝이 시작보다 빠르거나 0.2초보다 짧으면', () => {
    expect(captionLineProblems([L(3, 2, '가')], 10)[0]).toBe('끝이 시작보다 빨라요')
    expect(captionLineProblems([L(3, 3.1, '가')], 10)[0]).toBe('0.2초보다 짧아요')
  })
  test('160자를 넘거나 글자가 비었거나 글자가 아니면', () => {
    expect(captionLineProblems([L(0, 2, '가'.repeat(161))], 10)[0]).toBe('160자를 넘어요')
    expect(captionLineProblems([L(0, 2, '가'.repeat(160))], 10)[0]).toBeNull()
    expect(captionLineProblems([L(0, 2, '   ')], 10)[0]).toBe('글자가 비었어요')
    expect(captionLineProblems([{ start: 0, end: 2, text: 5 as never }], 10)[0]).toBe('글자가 비었어요')
  })
  test('시작이 음수거나 영상 길이(+0.5초)를 넘으면', () => {
    expect(captionLineProblems([L(-1, 2, '가')], 10)[0]).toBe('시작 시각이 잘못됐어요')
    expect(captionLineProblems([L(9, 10.5, '가')], 10)[0]).toBeNull()
    expect(captionLineProblems([L(9, 10.6, '가')], 10)[0]).toBe('영상 길이(10.0초)를 넘어요')
    expect(captionLineProblems([{ start: Number.NaN, end: 2, text: '가' }], 10)[0]).toBe('시작 시각이 잘못됐어요')
  })
})

describe('applyCaptionTrack', () => {
  test('트랙이 null·undefined 면 같은 값(예전 경로를 쓰라는 뜻)', () => {
    expect(applyCaptionTrack(T, null)).toBe(T)
    expect(applyCaptionTrack(T, undefined)).toBe(T)
  })
  test('원래 줄을 그대로 둔 트랙은 단어를 시각·신뢰도까지 그대로 낸다', () => {
    expect(applyCaptionTrack(T, captionLinesOf(T)).words).toEqual(WORDS)
  })
  test('글자를 고친 줄만 새 단어(신뢰도 1)가 되고 다른 줄은 그대로', () => {
    const out = applyCaptionTrack(T, [L(0, 2.4, '이렇게 되면서 해네도 올라오고,'), L(3.4, 5, '이게 섀도우 스윙을')])
    expect(out.words.slice(0, 4)).toEqual(WORDS.slice(0, 4))
    expect(out.words.slice(4).map((x) => x.text)).toEqual(['이게', '섀도우', '스윙을'])
    expect(out.words.slice(4).every((x) => x.confidence === 1)).toBe(true)
    expect(out.words.at(-1)!.end).toBeCloseTo(5, 3)
  })
  test('시각만 옮긴 줄은 새 구간 안에 단어가 놓이고 신뢰도 1', () => {
    const out = applyCaptionTrack(T, [L(0, 2.4, '이렇게 되면서 해네도 올라오고,'), L(3.0, 5.2, '이게 섀도우 생활을')])
    const moved = out.words.slice(4)
    expect(moved.map((x) => x.text).join(' ')).toBe('이게 섀도우 생활을')
    expect(moved[0]!.start).toBeGreaterThanOrEqual(3.0 - 1e-6)
    expect(moved.at(-1)!.end).toBeLessThanOrEqual(5.2 + 1e-6)
    expect(moved.every((x) => x.confidence === 1)).toBe(true)
  })
  test('(인식이 놓친 구간) 새 줄은 줄 전체 구간에 단어가 놓인다', () => {
    const out = applyCaptionTrack(T, [...captionLinesOf(T), L(6, 8, '새로 넣은 자막')])
    const added = out.words.filter((x) => x.start >= 6 - 1e-6)
    expect(added.map((x) => x.text)).toEqual(['새로', '넣은', '자막'])
    expect(added[0]!.start).toBe(6)
    expect(added.at(-1)!.end).toBe(8)
    expect(added.every((x) => x.confidence === 1)).toBe(true)
    expect(out.hasSpeech).toBe(true)
  })
  test('트랙에 없는 원래 줄의 단어는 빠진다', () => {
    const out = applyCaptionTrack(T, [L(3.4, 5, '이게 섀도우 생활을')])
    expect(out.words).toEqual(WORDS.slice(4))
    expect(out.segments).toHaveLength(1)
  })
  test('줄이 시작순이 아니어도 단어는 시각 순서로 나온다', () => {
    const out = applyCaptionTrack(T, [L(6, 8, '뒤에 넣음'), ...captionLinesOf(T)])
    const starts = out.words.map((x) => x.start)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
  })
  test('빈 글자 줄은 무시하고, 트랙이 빈 배열이면 단어가 없어 hasSpeech=false(던지지 않는다)', () => {
    expect(applyCaptionTrack(T, [L(0, 2, '   '), ...captionLinesOf(T)]).words).toEqual(WORDS)
    expect(applyCaptionTrack(T, [])).toMatchObject({ words: [], segments: [], hasSpeech: false })
  })
  test('(Plan 6 C2) 줄 안의 쉬는 구간에는 새 단어가 시작하거나 끝나지 않는다', () => {
    const ws = [w('그러니까', 0, 0.5), w('손목을', 0.5, 1.0), w('해네도', 1.6, 2.1), w('하면', 2.1, 2.6)]
    const out = applyCaptionTrack(tr(ws), [L(0, 2.6, '그러니까 손목을 이렇게 펴서 백스윙 하면')])
    const inGap = (t: number) => t > 1.0 + 1e-6 && t < 1.6 - 1e-6
    for (const x of out.words) {
      expect(inGap(x.start)).toBe(false)
      expect(inGap(x.end)).toBe(false)
    }
    expect(out.words.map((x) => x.text).join(' ')).toBe('그러니까 손목을 이렇게 펴서 백스윙 하면')
  })
  test('줄 글자가 160자를 넘으면 160자까지만 쓴다', () => {
    const out = applyCaptionTrack(T, [L(6, 8, `${'가'.repeat(100)} ${'나'.repeat(100)}`)])
    expect(Array.from(out.words.map((x) => x.text).join(' ')).length).toBe(160)
  })
  test('원본은 바뀌지 않는다', () => {
    const before = JSON.stringify(T)
    applyCaptionTrack(T, [L(6, 8, '새 줄')])
    expect(JSON.stringify(T)).toBe(before)
  })
})

describe('cutTranscriptFor — 컷이 사용자가 넣은 자막 구간을 지킨다', () => {
  test('트랙이 null 이면 같은 값', () => {
    expect(cutTranscriptFor(T, null)).toBe(T)
  })
  test('(Review Focus 2) 인식이 놓친 구간에 넣은 줄은 가짜 단어로 지켜지고, 원래 단어는 그대로 남는다', () => {
    const out = cutTranscriptFor(T, [...captionLinesOf(T), L(6, 8, '새로 넣은 자막')])
    expect(out.words.slice(0, 7)).toEqual(WORDS)
    expect(out.words).toHaveLength(8)
    expect(out.words[7]).toMatchObject({ start: 6, end: 8, confidence: 1 })
  })
  test('말이 인식된 줄 안(쉬는 구간 포함)은 새로 지키지 않는다 — 말 사이 무음 컷은 그대로', () => {
    expect(cutTranscriptFor(T, captionLinesOf(T)).words).toEqual(WORDS)
  })
  test('줄을 인식된 말 바깥으로 늘리면(앞·뒤 0.3초 이상) 그 늘린 곳이 지켜진다', () => {
    const out = cutTranscriptFor(T, [L(0, 2.4, '이렇게 되면서 해네도 올라오고,'), L(3.0, 6.0, '이게 섀도우 생활을')])
    const extra = out.words.filter((x) => !WORDS.includes(x))
    expect(extra.map((x) => [x.start, x.end])).toEqual([[3.0, 3.4], [5, 6]])
  })
  test('트랙에서 지운 줄의 원래 단어도 컷 계산에는 남는다(자막을 지워도 영상은 그대로)', () => {
    expect(cutTranscriptFor(T, [L(3.4, 5, '이게 섀도우 생활을')]).words).toEqual(WORDS)
  })

  // 최종 리뷰 지적: 보호용 가짜 단어가 컷의 다른 규칙(retake·filler)에 걸려 진짜 말이나 넣은 줄을 지우던 문제
  describe('가짜 보호 단어가 컷의 retake·filler 규칙에 걸리지 않는다', () => {
    const SPOKEN = { ...tr([w('오늘은', 5, 5.6), w('요리를', 5.7, 6.2), w('합니다.', 6.3, 6.9)]), language: 'ko', durationSec: 10 }
    const cuts = (t: typeof SPOKEN, silences: { start: number; end: number }[]) => planCuts({ transcript: t, silences, durationSec: 10, padSec: 0.25 })

    test('문장부호로 끝나는 세 낱말 이상 줄의 끝을 말 바깥으로 늘려도 진짜 말은 지워지지 않고 늘린 곳까지 남는다', () => {
      const plan = cuts(cutTranscriptFor(SPOKEN, [L(5, 7.5, '오늘은 요리를 합니다.')]), [{ start: 0, end: 4.8 }, { start: 6.9, end: 10 }])
      expect(plan.removed.some((r) => r.start < 6.9 && r.end > 5)).toBe(false)
      expect(plan.kept.some((k) => k.start <= 5 && k.end >= 7.5 - 1e-6)).toBe(true)
    })
    test('인식이 놓친 무음 구간에 넣은 짧은 감탄사 줄("아!")도 군더더기로 잘리지 않는다', () => {
      const base = { ...tr([w('안녕하세요', 0, 0.8), w('반갑습니다', 0.9, 1.7), w('오늘은', 5, 5.5)]), language: 'ko', durationSec: 10 }
      const plan = cuts(cutTranscriptFor(base, [L(3.0, 3.6, '아!')]) as typeof SPOKEN, [{ start: 1.8, end: 4.9 }])
      expect(plan.removed.some((r) => r.start < 3.6 && r.end > 3.0)).toBe(false)
    })
    test('컷 계산용 문장(segments)은 원래 인식 그대로다 — 보호 단어가 문장을 만들지 않는다', () => {
      expect(cutTranscriptFor(SPOKEN, [L(5, 7.5, '오늘은 요리를 합니다.')]).segments).toEqual(SPOKEN.segments)
    })
  })

  describe('줄을 말 바깥으로 늘리면 자막도 그 시간에 뜬다 (0.3초 이상 늘린 때만 — 컷이 그 구간을 지키는 때)', () => {
    const SPOKEN = tr([w('오늘은', 5, 5.6), w('요리를', 5.7, 6.2), w('합니다.', 6.3, 6.9)])
    test('앞·뒤로 1초 넘게 늘리면 첫 단어는 줄 시작에서, 마지막 단어는 줄 끝에서 끝난다', () => {
      const out = applyCaptionTrack(SPOKEN, [L(4.0, 8.0, '오늘은 요리를 합니다.')])
      expect(out.words[0]!.start).toBeCloseTo(4.0, 2)
      expect(out.words.at(-1)!.end).toBeCloseTo(8.0, 2)
      for (let k = 1; k < out.words.length; k++) expect(out.words[k]!.start).toBeGreaterThanOrEqual(out.words[k - 1]!.end - 1e-6)
    })
    test('0.3초 미만으로 늘린 건 그대로 말한 구간에만 놓인다(컷이 지키지 않는 곳에 자막만 띄우지 않는다)', () => {
      const out = applyCaptionTrack(SPOKEN, [L(4.8, 7.1, '오늘은 요리를 합니다.')])
      expect(out.words[0]!.start).toBeCloseTo(5.0, 2)
      expect(out.words.at(-1)!.end).toBeCloseTo(6.9, 2)
    })
  })

  describe('말이 없는 영상(음악만·소리 없음)에 자막을 넣어도 영상은 잘리지 않는다', () => {
    const quiet = { ...tr([]), language: 'ko', durationSec: 10 }
    test('인식된 단어가 하나도 없으면 줄을 넣어도 그대로 돌려준다 — "말 없음" 이어야 컷이 아무것도 안 자른다', () => {
      expect(cutTranscriptFor(quiet, [L(5, 8, '새로 넣은 자막')])).toBe(quiet)
    })
    test('컷 계산까지 이어 보면: 전부 무음인 10초 영상에 줄 하나를 넣어도 10초가 그대로 남는다', () => {
      const plan = planCuts({ transcript: cutTranscriptFor(quiet, [L(5, 8, '새로 넣은 자막')]), silences: [{ start: 0, end: 10 }], durationSec: 10, padSec: 0.25 })
      expect(plan.keptDurationSec).toBe(10)
      expect(plan.removed).toEqual([])
    })
    test('자막은 그대로 입혀진다 — 줄 전체 구간에 단어가 놓인다(말이 없어 겹치는 단어가 없다)', () => {
      const out = applyCaptionTrack(quiet, [L(5, 8, '새로 넣은 자막')])
      expect(out.hasSpeech).toBe(true)
      expect(out.words.map((x) => x.text)).toEqual(['새로', '넣은', '자막'])
      expect(out.words[0]!.start).toBeCloseTo(5, 5)
      expect(out.words.at(-1)!.end).toBeCloseTo(8, 5)
    })
  })
})

describe('removedSpans — 말은 있는데 자막 줄이 없는 구간', () => {
  test('트랙이 없으면 없다. 원래 줄 그대로면 없다', () => {
    expect(removedSpans(T, null)).toEqual([])
    expect(removedSpans(T, captionLinesOf(T))).toEqual([])
  })
  test('줄이 빠진 원래 줄만', () => {
    expect(removedSpans(T, [L(0, 2.4, '가')])).toEqual([{ start: 3.4, end: 5 }])
    expect(removedSpans(T, [])).toEqual([{ start: 0, end: 2.4 }, { start: 3.4, end: 5 }])
  })
  test('절반쯤 겹치게 옮긴 줄은 아니다(30% 이상 겹치면 살아 있는 줄), 거의 안 겹치면 뺀 것', () => {
    expect(removedSpans(T, [L(0, 2.4, '가'), L(4.2, 7, '나')])).toEqual([]) // 1.6초 중 0.8초(50%) 겹침
    expect(removedSpans(T, [L(0, 2.4, '가'), L(4.9, 7, '나')])).toEqual([{ start: 3.4, end: 5 }]) // 0.1초(6%) 겹침
  })
})

describe('captionLinesWithEdits — 예전(줄 번호) 편집을 자막 줄로', () => {
  test('편집이 없으면 원래 줄. 글자를 고친 줄은 시각 그대로 글자만, 지운 줄(null·공백뿐)은 빠진다', () => {
    expect(captionLinesWithEdits(T, null)).toEqual(captionLinesOf(T))
    expect(captionLinesWithEdits(T, [{ i: 0, text: '고친   글' }, { i: 1, text: null }])).toEqual([L(0, 2.4, '고친 글')])
    expect(captionLinesWithEdits(T, [{ i: 1, text: '   ' }])).toEqual([L(0, 2.4, '이렇게 되면서 해네도 올라오고,')])
  })
  test('범위 밖 번호·글자가 아닌 text 는 무시하고 같은 번호는 마지막이 이긴다', () => {
    expect(captionLinesWithEdits(T, [{ i: 9, text: 'x' }, { i: 0, text: 5 as never }, { i: 1, text: '처음' }, { i: 1, text: '나중' }])).toEqual([L(0, 2.4, '이렇게 되면서 해네도 올라오고,'), L(3.4, 5, '나중')])
  })
})

describe('normalizeCaptionLines — 서버가 저장하는 모양', () => {
  test('시작순 정렬, 글자 공백 정리, 시각은 소수 둘째 자리, 빈 글자 줄은 빠진다', () => {
    expect(normalizeCaptionLines([L(3.456, 5.001, ' 뒤   줄 '), L(0, 2, '앞'), L(2.1, 3, '   ')])).toEqual([L(0, 2, '앞'), L(3.46, 5, '뒤 줄')])
  })
  test('입력을 바꾸지 않는다', () => {
    const input = [L(3, 4, 'b'), L(0, 1, 'a')]
    normalizeCaptionLines(input)
    expect(input[0]).toEqual(L(3, 4, 'b'))
  })
})
