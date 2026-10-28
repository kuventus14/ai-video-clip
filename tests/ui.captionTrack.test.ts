import { describe, expect, it } from 'vitest'
import type { CaptionLine, CaptionOriginalLine } from '../src/shared/types.ts'
import { addLineAt, gapsOf, isDirty, lineProblems, mergeWithNext, originalFor, rateWarning, removeLine, sameAsOriginal, setEnd, setStart, setText, splitLine, trackPayload, trackToSend } from '../src/ui/captionTrack.ts'

const L = (start: number, end: number, text: string): CaptionLine => ({ start, end, text })
const LINES = [L(0, 2, '가'), L(3.5, 5, '나'), L(6, 8, '다')]

describe('setText', () => {
  it('그 줄의 글자만 바꾸고 입력은 바꾸지 않는다', () => {
    const out = setText(LINES, 1, '새 글')
    expect(out[1]).toEqual(L(3.5, 5, '새 글'))
    expect([out[0], out[2]]).toEqual([LINES[0], LINES[2]])
    expect(LINES[1]!.text).toBe('나')
  })
})

describe('setStart / setEnd — 이웃 줄과 겹치지 않게 맞춘다 (Review Focus 1)', () => {
  it('시작은 앞 줄 끝 이상, 이 줄 끝-0.2초 이하, 0 이상', () => {
    expect(setStart(LINES, 1, 3.0)[1]!.start).toBe(3.0)
    expect(setStart(LINES, 1, 1.0)[1]!.start).toBe(2) // 앞 줄 끝
    expect(setStart(LINES, 1, 4.95)[1]!.start).toBeCloseTo(4.8, 5) // 끝(5) - 0.2
    expect(setStart(LINES, 0, -3)[0]!.start).toBe(0)
  })
  it('끝은 이 줄 시작+0.2초 이상, 다음 줄 시작(마지막 줄은 영상 끝) 이하', () => {
    expect(setEnd(LINES, 1, 5.5, 20)[1]!.end).toBe(5.5)
    expect(setEnd(LINES, 1, 7, 20)[1]!.end).toBe(6) // 다음 줄 시작
    expect(setEnd(LINES, 1, 3.6, 20)[1]!.end).toBeCloseTo(3.7, 5) // 시작+0.2
    expect(setEnd(LINES, 2, 25, 20)[2]!.end).toBe(20) // 영상 끝
  })
  it('숫자가 아닌 값은 무시한다', () => {
    expect(setStart(LINES, 1, Number.NaN)).toEqual(LINES)
    expect(setEnd(LINES, 1, Number.NaN, 20)).toEqual(LINES)
  })
})

describe('removeLine', () => {
  it('그 줄을 뺀다', () => {
    expect(removeLine(LINES, 1)).toEqual([LINES[0], LINES[2]])
  })
})

describe('addLineAt — 빈 글자 줄을 끼운다(글자를 쓰면 자막이 된다, 비워 두면 저장 때 빠진다)', () => {
  it('빈 구간에 시작순 위치로 넣고 길이는 요청한 만큼(다음 줄 시작·영상 끝에서 자른다)', () => {
    expect(addLineAt(LINES, 10, 3, 20)).toEqual([...LINES, L(10, 13, '')])
    expect(addLineAt(LINES, 5.1, 3, 20)[2]).toEqual(L(5.1, 6, '')) // 다음 줄 시작(6)에서 자름
    expect(addLineAt(LINES, 19, 3, 20).at(-1)).toEqual(L(19, 20, ''))
  })
  it('시각이 이미 있는 줄 안이면 그 줄 끝 뒤로 옮긴다', () => {
    expect(addLineAt(LINES, 1.0, 1, 20)[1]).toEqual(L(2, 3, '')) // 줄 0(0~2) 안 → 2초부터, 줄 1(3.5~) 앞까지 1초
  })
  it('자리가 0.2초도 안 남으면 그대로', () => {
    expect(addLineAt(LINES, 19.9, 3, 20)).toEqual(LINES)
    expect(addLineAt([L(0, 2, '가'), L(2.1, 4, '나')], 2, 1, 20)).toHaveLength(2)
  })
})

describe('splitLine — 커서 위치에서 나눈다(시간은 글자 수 비율)', () => {
  it('글자와 시간을 같은 비율로 나눈다', () => {
    expect(splitLine([L(3.4, 5, '가나다라')], 0, 1)).toEqual([L(3.4, 3.8, '가'), L(3.8, 5, '나다라')])
    expect(splitLine([L(3.4, 5, '가나다라')], 0, 2)).toEqual([L(3.4, 4.2, '가나'), L(4.2, 5, '다라')])
  })
  it('공백은 정리하고, 어느 한쪽이 비거나 0.2초보다 짧아지면 그대로', () => {
    expect(splitLine([L(0, 2, '가 나')], 0, 1)).toEqual([L(0, 1, '가'), L(1, 2, '나')])
    expect(splitLine([L(0, 2, '가나')], 0, 0)).toEqual([L(0, 2, '가나')])
    expect(splitLine([L(0, 2, '가나')], 0, 2)).toEqual([L(0, 2, '가나')])
    expect(splitLine([L(3.4, 3.7, '가나다라')], 0, 2)).toEqual([L(3.4, 3.7, '가나다라')])
  })
})

describe('mergeWithNext', () => {
  it('글자를 공백으로 잇고 시간은 앞 시작~뒤 끝', () => {
    expect(mergeWithNext(LINES, 0)).toEqual([L(0, 5, '가 나'), LINES[2]])
  })
  it('다음 줄이 없으면 그대로', () => {
    expect(mergeWithNext(LINES, 2)).toEqual(LINES)
  })
})

describe('gapsOf — 자막이 없는 구간', () => {
  it('앞·사이·뒤에서 1초 이상 비어 있는 곳(정확히 1초 포함)', () => {
    expect(gapsOf(LINES, 20)).toEqual([{ start: 2, end: 3.5 }, { start: 5, end: 6 }, { start: 8, end: 20 }])
    expect(gapsOf([L(2.5, 4, '가')], 10)).toEqual([{ start: 0, end: 2.5 }, { start: 4, end: 10 }])
  })
  it('줄이 하나도 없으면 영상 전체. 더 짧은 틈은 안 보인다', () => {
    expect(gapsOf([], 20)).toEqual([{ start: 0, end: 20 }])
    expect(gapsOf([L(0, 2, '가'), L(2.5, 20, '나')], 20)).toEqual([])
  })
})

describe('trackToSend / isDirty / sameAsOriginal', () => {
  it('빈 글자 줄을 빼고 글자를 정리하고 시각을 소수 둘째 자리로, 시작순으로 보낸다', () => {
    expect(trackToSend([L(6.004, 8, ' 뒤   줄 '), L(0, 2, '앞'), L(3, 4, '   ')])).toEqual([L(0, 2, '앞'), L(6, 8, '뒤 줄')])
  })
  it('서버의 현재 줄과 같으면 dirty 아님. 글자·시각이 바뀌면 dirty. 빈 줄만 늘어난 건 아님', () => {
    expect(isDirty(LINES, LINES)).toBe(false)
    expect(isDirty(LINES, setText(LINES, 0, '다름'))).toBe(true)
    expect(isDirty(LINES, setEnd(LINES, 0, 2.5, 20))).toBe(true)
    expect(isDirty(LINES, addLineAt(LINES, 10, 3, 20))).toBe(false)
  })
  it('인식한 줄 그대로면 sameAsOriginal(의심 단어 칸은 보지 않는다)', () => {
    const original: CaptionOriginalLine[] = LINES.map((l) => ({ ...l, lowWords: [] }))
    expect(sameAsOriginal(original, LINES)).toBe(true)
    expect(sameAsOriginal(original, setText(LINES, 1, '다름'))).toBe(false)
    expect(sameAsOriginal(original, removeLine(LINES, 1))).toBe(false)
  })
})

describe('lineProblems / rateWarning / originalFor', () => {
  it('빈 글자 줄은 문제가 아니다(저장 때 빠진다). 160자 초과·겹침은 문제', () => {
    expect(lineProblems([L(0, 2, ''), L(3, 4, '가')], 20)).toEqual([null, null])
    expect(lineProblems([L(0, 2, '가'.repeat(161))], 20)[0]).toBe('160자를 넘어요')
    expect(lineProblems([L(0, 3, '가'), L(2, 4, '나')], 20)).toEqual([null, '앞 줄과 겹쳐요'])
  })
  it('초당 12자를 넘으면 경고(공백은 글자로 세지 않는다), 아니면 null', () => {
    expect(rateWarning(L(0, 2, '가'.repeat(25)))).toMatch(/2\.0초.*25자/)
    expect(rateWarning(L(0, 2, '가'.repeat(24)))).toBeNull()
    expect(rateWarning(L(0, 2, ''))).toBeNull()
  })
  it('originalFor: 가장 많이 겹치는 원래 줄(30% 이상)을 찾는다', () => {
    const original: CaptionOriginalLine[] = [{ ...L(0, 2, '가'), lowWords: ['가'] }, { ...L(3.5, 5, '나'), lowWords: [] }]
    expect(originalFor(original, L(0.1, 1.9, '고침'))).toBe(original[0])
    expect(originalFor(original, L(10, 12, '새 줄'))).toBeNull()
    expect(originalFor(original, L(1.9, 5, '넓힌'))).toBe(original[1]) // 줄 1 과 1.5초, 줄 0 과 0.1초
  })
})

describe('trackPayload — 계획 요청에 자막을 어떻게 실을까 (생략 / null / 줄 목록)', () => {
  const ORIG: CaptionOriginalLine[] = [{ ...L(0, 2, '가'), lowWords: [] }, { ...L(3.5, 5, '나'), lowWords: ['나'] }]
  const base = (custom: boolean) => ({ lines: ORIG.map(({ start, end, text }) => L(start, end, text)), original: ORIG, custom })

  it('고치지 않았으면 아무것도 싣지 않는다 (저장된 것도 그대로)', () => {
    expect(trackPayload(base(false), base(false).lines)).toEqual({})
    expect(trackPayload(base(true), base(true).lines)).toEqual({})
  })
  it('고쳤으면 보낼 모양(빈 줄 제외·시작순)의 줄 목록을 싣는다', () => {
    const edited = [L(0, 2, '가 고침'), L(3.5, 5, '나'), L(6, 7, '   ')]
    expect(trackPayload(base(false), edited)).toEqual({ captionTrack: [L(0, 2, '가 고침'), L(3.5, 5, '나')] })
  })
  it('인식한 그대로로 되돌렸고 저장된 고침이 있으면 null 로 비운다', () => {
    const saved = { lines: [L(0, 2, '가 고침'), L(3.5, 5, '나')], original: ORIG, custom: true }
    expect(trackPayload(saved, ORIG.map(({ start, end, text }) => L(start, end, text)))).toEqual({ captionTrack: null })
  })
  it('저장된 고침이 없는데 고쳤다가 되돌렸으면 아무것도 싣지 않는다', () => {
    expect(trackPayload(base(false), base(false).lines.map((x) => ({ ...x })))).toEqual({})
  })
  it('줄을 전부 지웠으면 빈 배열(자막 전부 없음)을 싣는다', () => {
    expect(trackPayload(base(false), [])).toEqual({ captionTrack: [] })
  })
})
