import { describe, expect, it } from 'vitest'
import type { ScriptDto } from '../src/shared/types.ts'
import { formFrom, overLimit, scriptEditsFrom } from '../src/ui/script.ts'

const ORIGINAL: ScriptDto = { title: '프로님의 롱아이언 꿀팁', hookSec: 3, hookQuestion: '왜 나만 안 맞을까?', openingLines: ['롱아이언 실전편', '꿀팁 공개?'], sections: ['여기서 포인트!', '체크 방법!'], questions: 2, reactions: 1, speed: 1.1 }

describe('formFrom', () => {
  it('대본 값으로 입력칸 초기값을 만든다(훅이 없으면 훅 질문은 빈 문자열)', () => {
    expect(formFrom(ORIGINAL)).toEqual({ title: '프로님의 롱아이언 꿀팁', hookQuestion: '왜 나만 안 맞을까?', openingLines: ['롱아이언 실전편', '꿀팁 공개?'] })
    expect(formFrom({ ...ORIGINAL, hookQuestion: null, hookSec: 0 }).hookQuestion).toBe('')
  })
})

describe('scriptEditsFrom — 바뀐 칸만 담는다', () => {
  it('아무것도 안 바꾸면 빈 객체', () => {
    expect(scriptEditsFrom(ORIGINAL, formFrom(ORIGINAL))).toEqual({})
  })
  it('제목만 바꾸면 제목만(앞뒤 공백은 지운다)', () => {
    expect(scriptEditsFrom(ORIGINAL, { ...formFrom(ORIGINAL), title: '  새 제목  ' })).toEqual({ title: '새 제목' })
  })
  it('훅 질문을 바꾸면 hookQuestion, 훅이 없는 대본은 훅 질문 칸이 무시된다', () => {
    expect(scriptEditsFrom(ORIGINAL, { ...formFrom(ORIGINAL), hookQuestion: '새 질문?' })).toEqual({ hookQuestion: '새 질문?' })
    const noHook = { ...ORIGINAL, hookQuestion: null, hookSec: 0 }
    expect(scriptEditsFrom(noHook, { ...formFrom(noHook), hookQuestion: '써도 무시' })).toEqual({})
  })
  it('소개 줄은 빈 칸을 버리고 순서·개수가 달라졌을 때만 담는다', () => {
    expect(scriptEditsFrom(ORIGINAL, { ...formFrom(ORIGINAL), openingLines: ['롱아이언 실전편', '꿀팁 공개?', '  '] })).toEqual({}) // 빈 칸만 늘어난 것은 변화가 아니다
    expect(scriptEditsFrom(ORIGINAL, { ...formFrom(ORIGINAL), openingLines: ['꿀팁 공개?', '롱아이언 실전편'] })).toEqual({ openingLines: ['꿀팁 공개?', '롱아이언 실전편'] })
    expect(scriptEditsFrom(ORIGINAL, { ...formFrom(ORIGINAL), openingLines: ['', ''] })).toEqual({ openingLines: [] })
  })
})

describe('overLimit — 승인을 막는 문구 문제', () => {
  const ok = formFrom(ORIGINAL)
  it('문제가 없으면 빈 목록', () => {
    expect(overLimit(ok, ORIGINAL)).toEqual([])
  })
  it('19자 제목·23자 훅 질문·23자 소개 줄을 알려 준다', () => {
    expect(overLimit({ ...ok, title: '가'.repeat(19) }, ORIGINAL).join(' ')).toContain('제목')
    expect(overLimit({ ...ok, hookQuestion: '가'.repeat(23) }, ORIGINAL).join(' ')).toContain('훅 질문')
    expect(overLimit({ ...ok, openingLines: ['가'.repeat(23)] }, ORIGINAL).join(' ')).toContain('소개 줄')
  })
  it('소개 줄이 4개면 알려 준다', () => {
    expect(overLimit({ ...ok, openingLines: ['a', 'b', 'c', 'd'] }, ORIGINAL).join(' ')).toContain('소개 줄은 3개')
  })
  it('빈 제목은 막지만, 소개 줄이 빈 칸인 것은 괜찮다(그 줄은 빠진다)', () => {
    expect(overLimit({ ...ok, title: '   ' }, ORIGINAL).join(' ')).toContain('제목')
    expect(overLimit({ ...ok, openingLines: ['', ''] }, ORIGINAL)).toEqual([])
  })
  it('훅이 있는데 훅 질문을 비우면 막는다(훅 질문 없는 훅은 두지 않는다)', () => {
    expect(overLimit({ ...ok, hookQuestion: '' }, ORIGINAL).join(' ')).toContain('훅 질문')
  })
  it('훅이 없는 대본이면 훅 질문 칸이 비어도 괜찮다', () => {
    const noHook = { ...ORIGINAL, hookQuestion: null, hookSec: 0 }
    expect(overLimit(formFrom(noHook), noHook)).toEqual([])
  })
  it('주소가 든 문구는 막는다', () => {
    expect(overLimit({ ...ok, title: 'https://a.co' }, ORIGINAL).join(' ')).toContain('제목')
  })
})
