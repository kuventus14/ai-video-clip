import { describe, expect, test } from 'vitest'
import { emptyScript, normalizeScript, SCRIPT_LIMITS, scriptCardLines, toRenderScript, type EditScript } from '../src/core/script.ts'

const ctx = { durationSec: 60, fallbackTitle: '골프 레슨' }
const good = (over: Record<string, unknown> = {}) => ({
  version: 1,
  title: '프로님의 롱아이언 꿀팁',
  hook: { sourceStart: 54, sourceEnd: 57, question: '롱아이언, 왜 나만 안 맞을까?' },
  openingLines: ['롱아이언 실전편', '프로님만 아는 꿀팁 공개?', '백스윙 하나로 달라지는 샷'],
  sections: [{ atSec: 10, label: '여기서 포인트!' }, { atSec: 25, label: '체크 방법!' }, { atSec: 40, label: '적용해보면!' }],
  questions: [{ atSec: 18, text: '아마추어는 백스윙이 짧다?' }],
  reactions: [{ atSec: 56, text: '와.. 롱아이언이 이렇게 뻗는다고?!' }],
  emphasis: ['우선', '차이', '이렇게'],
  speed: 1.1,
  drop: [{ start: 30, end: 33 }],
  ...over,
})
const run = (raw: unknown, c = ctx) => normalizeScript(raw, c)

describe('normalizeScript — 편집 대본을 정리한다(던지지 않는다)', () => {
  test('정상 대본은 그대로 통과하고 notes 가 비어 있다', () => {
    const { script, notes } = run(good())
    expect(notes).toEqual([])
    expect(script.title).toBe('프로님의 롱아이언 꿀팁')
    expect(script.hook).toEqual({ sourceStart: 54, sourceEnd: 57, question: '롱아이언, 왜 나만 안 맞을까?' })
    expect(script.sections.map((s) => s.label)).toEqual(['여기서 포인트!', '체크 방법!', '적용해보면!'])
    expect(script.speed).toBe(1.1)
    expect(script.drop).toEqual([{ start: 30, end: 33 }])
  })

  test('제목이 비면 fallbackTitle', () => {
    expect(run(good({ title: '   ' })).script.title).toBe('골프 레슨')
  })
  test('제목이 18자를 넘으면 fallbackTitle 로 대체되고 notes 에 이유가 남는다(잘라 붙이지 않는다)', () => {
    const { script, notes } = run(good({ title: '가'.repeat(19) }))
    expect(script.title).toBe('골프 레슨')
    expect(notes.join(' ')).toContain('제목')
  })
  test('fallbackTitle 자체가 길면 18자 안에서 어절 단위로 줄인다', () => {
    const { script } = run(good({ title: '' }), { durationSec: 60, fallbackTitle: '롱아이언 체중 이동과 백스윙 탑 위치 점검하는 방법' })
    expect(Array.from(script.title).length).toBeLessThanOrEqual(SCRIPT_LIMITS.title)
    expect(script.title.length).toBeGreaterThan(0)
    expect('롱아이언 체중 이동과 백스윙 탑 위치 점검하는 방법').toContain(script.title)
  })

  test('시간이 영상 밖(−1, 999)인 소제목·질문·리액션은 그 항목만 빠진다', () => {
    const { script } = run(good({ sections: [{ atSec: -1, label: 'a' }, { atSec: 999, label: 'b' }, { atSec: 20, label: '정상' }], questions: [{ atSec: 61, text: '밖' }], reactions: [{ atSec: -3, text: '밖' }] }))
    expect(script.sections.map((s) => s.label)).toEqual(['정상'])
    expect(script.questions).toEqual([])
    expect(script.reactions).toEqual([])
  })

  test('훅이 5초면 4초로 줄고, 1초(1.5초 미만)면 훅과 질문이 함께 빠진다', () => {
    expect(run(good({ hook: { sourceStart: 50, sourceEnd: 55, question: '질문?' } })).script.hook).toEqual({ sourceStart: 50, sourceEnd: 54, question: '질문?' })
    const short = run(good({ hook: { sourceStart: 50, sourceEnd: 51, question: '질문?' } }))
    expect(short.script.hook).toBeUndefined()
    expect(short.notes.join(' ')).toContain('훅')
  })
  test('훅이 영상 밖이면 훅이 빠지고, 영상 끝을 넘으면 끝으로 줄여 1.5초 이상일 때만 남는다', () => {
    expect(run(good({ hook: { sourceStart: 70, sourceEnd: 73, question: '질문?' } })).script.hook).toBeUndefined()
    expect(run(good({ hook: { sourceStart: 58, sourceEnd: 63, question: '질문?' } })).script.hook).toEqual({ sourceStart: 58, sourceEnd: 60, question: '질문?' })
    expect(run(good({ hook: { sourceStart: 59, sourceEnd: 63, question: '질문?' } })).script.hook).toBeUndefined()
    expect(run(good({ hook: { sourceStart: -2, sourceEnd: 1, question: '질문?' } })).script.hook).toBeUndefined()
  })
  test('훅 질문이 상한(22자)을 넘으면 질문 없는 훅은 두지 않는다(훅과 질문은 함께)', () => {
    expect(run(good({ hook: { sourceStart: 50, sourceEnd: 53, question: '가'.repeat(23) } })).script.hook).toBeUndefined()
  })

  test('2초 안에 붙은 질문 두 개 중 뒤의 것이 빠진다', () => {
    const { script } = run(good({ questions: [{ atSec: 10, text: '앞' }, { atSec: 11.5, text: '뒤' }, { atSec: 20, text: '다음' }] }))
    expect(script.questions.map((q) => q.text)).toEqual(['앞', '다음'])
  })
  test('소제목 7개를 주면 시각 순으로 5개만', () => {
    const sections = Array.from({ length: 7 }, (_, i) => ({ atSec: 50 - i * 6, label: `소제목${i}` })) // 시각이 역순으로 들어옴
    const { script } = run(good({ sections }))
    expect(script.sections).toHaveLength(SCRIPT_LIMITS.maxSections)
    expect(script.sections.map((s) => s.atSec)).toEqual([...script.sections.map((s) => s.atSec)].sort((a, b) => a - b))
    expect(script.sections[0]!.atSec).toBe(14)
  })
  test('개수 상한: 질문 3, 리액션 2, 소개 줄 3, 강조 단어 30', () => {
    const q = Array.from({ length: 6 }, (_, i) => ({ atSec: 3 + i * 5, text: `질문${i}` }))
    const r = Array.from({ length: 4 }, (_, i) => ({ atSec: 5 + i * 10, text: `리액션${i}` }))
    const e = Array.from({ length: 50 }, (_, i) => `단어${i}`)
    const { script } = run(good({ questions: q, reactions: r, openingLines: ['a', 'b', 'c', 'd', 'e'], emphasis: e }))
    expect(script.questions).toHaveLength(3)
    expect(script.reactions).toHaveLength(2)
    expect(script.openingLines).toHaveLength(3)
    expect(script.emphasis).toHaveLength(30)
  })

  test('문구가 상한을 넘거나 비거나 URL·이모지뿐이면 그 항목만 빠진다', () => {
    const { script, notes } = run(good({
      sections: [{ atSec: 5, label: '가'.repeat(11) }, { atSec: 12, label: '정상' }, { atSec: 20, label: '' }],
      questions: [{ atSec: 5, text: 'https://example.com 보세요' }, { atSec: 20, text: '🔥🔥' }, { atSec: 30, text: '정상 질문?' }],
      openingLines: ['   ', '정상 소개', 'www.site.kr'],
    }))
    expect(script.sections.map((s) => s.label)).toEqual(['정상'])
    expect(script.questions.map((q) => q.text)).toEqual(['정상 질문?'])
    expect(script.openingLines).toEqual(['정상 소개'])
    expect(notes.length).toBeGreaterThan(0)
  })

  test('drop 이 겹치면 합치고, 합이 25% 를 넘으면 25% 에서 멈춘다', () => {
    expect(run(good({ drop: [{ start: 10, end: 14 }, { start: 12, end: 16 }, { start: 30, end: 31 }] })).script.drop).toEqual([{ start: 10, end: 16 }, { start: 30, end: 31 }])
    const big = run(good({ drop: [{ start: 0, end: 10 }, { start: 20, end: 40 }] })).script.drop // 60초의 25% = 15초
    expect(big.reduce((s, d) => s + d.end - d.start, 0)).toBeCloseTo(15, 5)
    expect(big[0]).toEqual({ start: 0, end: 10 })
  })
  test('drop 의 영상 밖 구간은 줄이거나 버린다', () => {
    expect(run(good({ drop: [{ start: -5, end: 3 }, { start: 58, end: 90 }, { start: 70, end: 80 }] })).script.drop).toEqual([{ start: 0, end: 3 }, { start: 58, end: 60 }])
  })

  test('speed 는 1~1.25 로 자른다', () => {
    expect(run(good({ speed: 1.6 })).script.speed).toBe(1.25)
    expect(run(good({ speed: 0.5 })).script.speed).toBe(1)
    expect(run(good({ speed: 'fast' })).script.speed).toBe(1)
  })

  test('엉터리 입력(숫자 자리에 문자열, 배열 자리에 객체, null, 문자열 통째)이어도 던지지 않고 제목만 있는 대본이 된다', () => {
    for (const raw of [null, undefined, 'oops', 42, [], { title: 7, hook: 'x', sections: { a: 1 }, questions: 'q', drop: 3, speed: {}, emphasis: 9 }]) {
      const { script } = run(raw)
      expect(script.version).toBe(1)
      expect(script.title).toBe('골프 레슨')
      expect(script.hook).toBeUndefined()
      expect(script.sections).toEqual([])
      expect(script.speed).toBe(1)
    }
  })

  test('10초 이하 영상이면 훅·소개 줄·소제목·질문·리액션·drop 이 모두 비고 제목만 남는다', () => {
    const { script, notes } = run(good(), { durationSec: 10, fallbackTitle: '짧은 영상' })
    expect(script.title).toBe('프로님의 롱아이언 꿀팁')
    expect(script.hook).toBeUndefined()
    expect(script.openingLines).toEqual([])
    expect(script.sections).toEqual([])
    expect(script.questions).toEqual([])
    expect(script.reactions).toEqual([])
    expect(script.drop).toEqual([])
    expect(notes.join(' ')).toContain('짧')
  })
})

describe('emptyScript', () => {
  test('제목만 있고 훅·소제목이 없으며 속도 1', () => {
    const s: EditScript = emptyScript('제목')
    expect(s).toEqual({ version: 1, title: '제목', openingLines: [], sections: [], questions: [], reactions: [], emphasis: [], speed: 1, drop: [] })
  })
})

describe('toRenderScript — 원본 시각의 대본을 출력 시각으로', () => {
  const sc: EditScript = { ...emptyScript('제목'), hook: { sourceStart: 54, sourceEnd: 57, question: '질문?' }, openingLines: ['하나', '둘', '셋'], speed: 1.1,
    sections: [{ atSec: 10, label: 'A' }, { atSec: 25, label: 'B' }], questions: [{ atSec: 12, text: 'Q' }], reactions: [{ atSec: 56, text: 'R' }], emphasis: ['스윙'] }
  const kept = [{ start: 0, end: 60 }]
  test('시각이 훅 길이(3초)만큼 밀리고, 소제목 끝은 다음 소제목 시작·마지막은 총 길이', () => {
    const r = toRenderScript(sc, kept, 3, 63)
    expect(r.sections).toEqual([{ start: 13, end: 28, label: 'A' }, { start: 28, end: 63, label: 'B' }])
    expect(r.questions).toEqual([{ start: 15, text: 'Q' }])
    expect(r.reactions).toEqual([{ start: 59, text: 'R' }])
    expect(r.hook).toEqual({ sec: 3, question: '질문?' })
    expect(r.hookSec).toBe(3)
    expect(r.title).toBe('제목')
    expect(r.emphasis).toEqual(['스윙'])
  })
  test('소개 줄 색은 노랑·하늘·흰 순', () => {
    expect(toRenderScript(sc, kept, 3, 63).openingLines).toEqual([{ text: '하나', color: 'yellow' }, { text: '둘', color: 'cyan' }, { text: '셋', color: 'white' }])
  })
  test('훅이 없으면 hook 도 없고 hookSec 0', () => {
    const r = toRenderScript({ ...sc, hook: undefined }, kept, 0, 60)
    expect(r.hook).toBeUndefined()
    expect(r.hookSec).toBe(0)
  })
  test('잘려 나간 자리의 소제목은 다음 남은 구간 시작에 붙고, 영상 밖이면 뺀다', () => {
    const r = toRenderScript({ ...sc, sections: [{ atSec: 15, label: '잘림' }, { atSec: 70, label: '밖' }] }, [{ start: 0, end: 10 }, { start: 20, end: 30 }], 0, 20)
    expect(r.sections).toEqual([{ start: 10, end: 20, label: '잘림' }])
  })
})

describe('scriptCardLines — 계획 카드에 보여 줄 편집 구성', () => {
  const sc: EditScript = { ...emptyScript('프로님의 롱아이언 꿀팁'), hook: { sourceStart: 14.2, sourceEnd: 16.7, question: '스윙, 끝까지 이렇게 가면?' }, openingLines: ['a'],
    sections: [{ atSec: 0, label: '여기서 포인트!' }, { atSec: 8, label: '체크 방법!' }], questions: [{ atSec: 1, text: 'q' }, { atSec: 5, text: 'q2' }], reactions: [{ atSec: 16, text: 'r' }], speed: 1.1, drop: [{ start: 3, end: 5 }, { start: 9, end: 12 }] }
  test('후킹·제목·소제목 흐름·질문/리액션 개수·속도·빼는 구간 줄이 나온다', () => {
    const lines = scriptCardLines(sc).join('\n')
    expect(lines).toMatch(/• 후킹: .*14\.2.*2\.5초.*스윙, 끝까지 이렇게 가면\?/)
    expect(lines).toContain('• 제목: "프로님의 롱아이언 꿀팁"')
    expect(lines).toContain('• 소제목: 여기서 포인트! → 체크 방법!')
    expect(lines).toMatch(/• 중간 질문 2개.*리액션 1개/)
    expect(lines).toMatch(/• 속도: 1\.1배/)
    expect(lines).toMatch(/• 빼는 구간: 2곳.*5초/)
  })
  test('훅·소제목이 없으면 그 줄이 없고, 속도 1·drop 없음이면 속도·빼는 구간 줄도 없다', () => {
    const lines = scriptCardLines(emptyScript('제목')).join('\n')
    expect(lines).not.toContain('후킹')
    expect(lines).not.toContain('소제목')
    expect(lines).not.toContain('속도')
    expect(lines).not.toContain('빼는 구간')
    expect(lines).toContain('• 제목: "제목"')
  })
})
