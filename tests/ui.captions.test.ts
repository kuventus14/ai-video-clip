import { describe, expect, it } from 'vitest'
import type { CaptionReviewDto } from '../src/shared/types.ts'
import { draftFrom, editsFrom, isDirty, partProblems, partWarnings, setPartText, togglePartDelete, visibleParts } from '../src/ui/captions.ts'

const REVIEW: CaptionReviewDto = {
  hasSpeech: true,
  durationSec: 20,
  original: [],
  lines: [],
  custom: false,
  edits: [],
  parts: [
    { i: 0, start: 0, end: 1.8, text: '이렇게 되면서 올라오고,', lowWords: ['이렇게'] },
    { i: 1, start: 3, end: 4, text: '이게 섀도우', lowWords: [] },
    { i: 2, start: 6, end: 7, text: '연습을 해요', lowWords: ['연습을'] },
  ],
}

describe('draftFrom', () => {
  it('저장된 편집으로 시작한다(없는 줄 번호는 버린다)', () => {
    const r = { ...REVIEW, edits: [{ i: 1, text: '이게 스윙' }, { i: 2, text: null }, { i: 9, text: '없는 줄' }] }
    expect(draftFrom(r)).toEqual({ 1: '이게 스윙', 2: null })
  })
  it('저장된 편집이 없으면 빈 초안', () => {
    expect(draftFrom(REVIEW)).toEqual({})
  })
})

describe('setPartText', () => {
  it('원문과 다르면 초안에 들어가고, 공백만 다르면 원문과 같은 것으로 보고 뺀다', () => {
    const d = setPartText({}, REVIEW, 1, '이게 스윙')
    expect(d).toEqual({ 1: '이게 스윙' })
    expect(setPartText(d, REVIEW, 1, '  이게   섀도우 ')).toEqual({})
  })
  it('원본 초안은 바꾸지 않는다', () => {
    const d = {}
    setPartText(d, REVIEW, 0, '새 글')
    expect(d).toEqual({})
  })
  it('입력 중인 글자는 그대로 둔다(끝 공백도) — 지워서 비우면 빈 문자열', () => {
    expect(setPartText({}, REVIEW, 0, '새 글 ')[0]).toBe('새 글 ')
    expect(setPartText({}, REVIEW, 0, '')[0]).toBe('')
  })
})

describe('togglePartDelete', () => {
  it('지움 ↔ 되돌림(되돌리면 원문으로 돌아가 초안에서 빠진다)', () => {
    const del = togglePartDelete({ 1: '고친 글' }, 1)
    expect(del).toEqual({ 1: null })
    expect(togglePartDelete(del, 1)).toEqual({})
  })
})

describe('editsFrom', () => {
  it('줄 번호 오름차순, 지운 줄·비운 줄은 text null, 글자는 공백을 정리한다', () => {
    expect(editsFrom({ 2: null, 0: '  새   글 ', 1: '   ' })).toEqual([{ i: 0, text: '새 글' }, { i: 1, text: null }, { i: 2, text: null }])
  })
  it('초안이 비면 빈 배열', () => {
    expect(editsFrom({})).toEqual([])
  })
})

describe('partProblems', () => {
  it('160자를 넘는 줄만 알려 준다(지운 줄은 문제없다)', () => {
    expect(partProblems({ 0: '가'.repeat(161), 1: '정상', 2: null })).toEqual({ 0: '160자를 넘어요' })
    expect(partProblems({ 0: '가'.repeat(160) })).toEqual({})
  })
})

describe('visibleParts', () => {
  it('의심 단어가 있는 줄만 보기', () => {
    expect(visibleParts(REVIEW, true).map((p) => p.i)).toEqual([0, 2])
    expect(visibleParts(REVIEW, false).map((p) => p.i)).toEqual([0, 1, 2])
  })
})

describe('isDirty — 저장하지 않은 고침이 있나', () => {
  it('처음 상태는 아니다', () => {
    expect(isDirty(REVIEW, draftFrom(REVIEW))).toBe(false)
    const saved = { ...REVIEW, edits: [{ i: 1, text: '이게 스윙' }] }
    expect(isDirty(saved, draftFrom(saved))).toBe(false)
  })
  it('고치면 맞고, 되돌리면(원문으로 다시 쓰면) 아니다', () => {
    const d = setPartText({}, REVIEW, 1, '이게 스윙')
    expect(isDirty(REVIEW, d)).toBe(true)
    expect(isDirty(REVIEW, setPartText(d, REVIEW, 1, '이게 섀도우'))).toBe(false)
  })
  it('저장된 것과 같은 내용(공백만 다름)이면 아니고, 저장된 것을 되돌리면 맞다', () => {
    const saved = { ...REVIEW, edits: [{ i: 1, text: '이게 스윙' }] }
    expect(isDirty(saved, { 1: '  이게   스윙 ' })).toBe(false)
    expect(isDirty(saved, {})).toBe(true)
  })
})

describe('partWarnings — 고친 글자가 줄 시간에 비해 너무 많아 자막이 빨리 지나가는 줄', () => {
  it('초당 12자를 넘는 줄만(1.8초 줄에 22자 넘게) 알려 준다', () => {
    const w = partWarnings(REVIEW, { 0: '가'.repeat(23) })
    expect(Object.keys(w)).toEqual(['0'])
    expect(w[0]).toMatch(/1\.8초/)
    expect(partWarnings(REVIEW, { 0: '가'.repeat(21) })).toEqual({})
  })
  it('지운 줄과 안 고친 줄은 알리지 않고, 공백은 글자로 세지 않는다', () => {
    expect(partWarnings(REVIEW, { 0: null })).toEqual({})
    expect(partWarnings(REVIEW, {})).toEqual({})
    expect(partWarnings(REVIEW, { 0: '가 '.repeat(15) })).toEqual({}) // 공백 뺀 15자
  })
})
