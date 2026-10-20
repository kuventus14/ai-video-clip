import { describe, expect, test } from 'vitest'
import { deriveAppliedStyle, EditPlan, interpretRequest, planCardLines } from '../src/core/interpret.ts'
import type { askClaude } from '../src/core/llm.ts'
import { FEASIBILITY, StyleSpec } from '../src/core/styleSpec.ts'
import type { VideoSummary } from '../src/core/understand.ts'

const spec = (over: Partial<StyleSpec> = {}): StyleSpec => ({
  orientation: 'portrait',
  durationSec: 40,
  pacing: { shotCount: 9, avgShotLengthSec: 4.4, cutsPerMinute: 12 },
  hook: { endSec: 3, description: '질문 훅' },
  captions: { present: true, position: 'middle', size: 'large', color: '#FFE600', highlightColor: '#FF3366', maxCharsPerLine: 12 },
  hookTitle: { present: true, text: '꿀팁 공개' },
  transitions: { dominant: 'punch-zoom' },
  music: { present: true, energy: 'high', mood: '경쾌' },
  structure: ['훅', '설명', '마무리'],
  feasibility: { ...FEASIBILITY },
  ...over,
})

const summary: VideoSummary = {
  topic: '롱아이언',
  genre: '골프 레슨',
  oneLine: '롱아이언 팁',
  language: 'ko',
  hasPeople: true,
  hookTitle: '롱아이언 이것만 기억',
  searchQueries: ['a', 'b', 'c'],
  source: 'user',
}

function fakeAsk(reply: unknown) {
  const calls: { prompt: string }[] = []
  const ask = (async (o: { prompt: string }) => {
    calls.push(o)
    return reply
  }) as unknown as typeof askClaude
  return { calls, ask }
}

const plan = (over: Partial<EditPlan> = {}): EditPlan => ({ mode: 'full-reference', take: ['pacing', 'captions', 'hookTitle', 'transitions', 'orientation'], skip: [], adjust: [], unsupported: [], ...over })

describe('interpretRequest', () => {
  test('요청이 비면 LLM 을 부르지 않고 지원되는 항목 전부를 따른다', async () => {
    const f = fakeAsk(null)
    const p = await interpretRequest({ spec: spec(), userText: '   ', summary }, { ask: f.ask })
    expect(f.calls).toHaveLength(0)
    expect(p.mode).toBe('full-reference')
    expect(p.take).toEqual(expect.arrayContaining(['pacing', 'captions', 'hookTitle', 'transitions']))
    expect(p.take).not.toContain('music')
    expect(p.take).not.toContain('structure')
    expect(p.skip).toEqual([])
    expect(EditPlan.safeParse(p).success).toBe(true)
  })

  test('요청이 있으면 LLM 해석을 그대로 쓴다', async () => {
    const llm = plan({ mode: 'targeted', take: ['captions'], skip: ['pacing'] })
    const f = fakeAsk(llm)
    const p = await interpretRequest({ spec: spec(), userText: '자막 스타일만 따라 하고 컷은 그대로', summary }, { ask: f.ask })
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0]!.prompt).toContain('자막 스타일만 따라 하고 컷은 그대로')
    expect(p).toEqual(llm)
  })

  test('(I6) 레퍼런스가 없으면 그렇다고 프롬프트에 밝히고 레퍼런스 스타일은 보내지 않으며, 결과의 take·skip 을 비운다', async () => {
    const f = fakeAsk(plan({ mode: 'full-reference', take: ['pacing', 'captions'], skip: ['music'], adjust: [{ field: 'pacing', instruction: '컷을 더 빠르게' }] }))
    const p = await interpretRequest({ spec: spec(), userText: '컷을 더 빠르게', summary, hasReference: false }, { ask: f.ask })
    expect(f.calls[0]!.prompt).toContain('레퍼런스 없음')
    expect(f.calls[0]!.prompt).not.toContain('레퍼런스 스타일(측정')
    expect(p.mode).toBe('targeted')
    expect(p.take).toEqual([])
    expect(p.skip).toEqual([])
    expect(p.adjust).toEqual([{ field: 'pacing', instruction: '컷을 더 빠르게' }])
  })

  test('카메라 워크 요청은 LLM 이 빠뜨려도 지원 불가에 반드시 올린다', async () => {
    const f = fakeAsk(plan({ mode: 'targeted', take: ['captions'] }))
    const p = await interpretRequest({ spec: spec(), userText: '카메라 워크도 따라 해줘', summary }, { ask: f.ask })
    expect(p.unsupported).toHaveLength(1)
    expect(p.unsupported[0]!.request).toContain('카메라 워크')
    expect(p.unsupported[0]!.reason).toMatch(/지원/)
  })

  test('LLM 이 이미 지원 불가로 적었으면 중복해서 더하지 않는다', async () => {
    const f = fakeAsk(plan({ unsupported: [{ request: 'VFX 합성', reason: '지원하지 않아요' }] }))
    const p = await interpretRequest({ spec: spec(), userText: 'VFX 합성도 해줘', summary }, { ask: f.ask })
    expect(p.unsupported).toHaveLength(1)
  })
})

describe('planCardLines', () => {
  test('지원하지 않는 항목(음악)은 정직하게 알린다', () => {
    const lines = planCardLines(plan(), spec()).join('\n')
    expect(lines).toContain('이렇게 이해했어요')
    expect(lines).toMatch(/음악.*지원하지 않아요/)
  })

  test('근사만 가능한 항목은 그렇다고 표시한다', () => {
    const lines = planCardLines(plan(), spec()).join('\n')
    expect(lines).toMatch(/자막 스타일.*비슷하게/)
  })

  test('참고할 항목 없이 조정만 있으면 "지정한 항목 없음" 대신 요청을 반영한다고 말한다', () => {
    const lines = planCardLines(plan({ mode: 'targeted', take: [], adjust: [{ field: 'pacing', instruction: '컷을 더 빠르게' }] }), spec())
    expect(lines[0]).toContain('이렇게 이해했어요')
    expect(lines[0]).toContain('요청하신 대로')
    expect(lines.join('\n')).not.toContain('지정한 항목 없음')
    expect(lines.join('\n')).toContain('컷을 더 빠르게')
  })

  test('(I6) 해석하지 못해 반영되지 않는 조정은 카드에 "반영하지 못했어요"로 표시한다', () => {
    const lines = planCardLines(
      plan({
        mode: 'targeted',
        take: [],
        adjust: [
          { field: 'pacing', instruction: '리듬감 있게' },
          { field: 'pacing', instruction: '컷을 더 빠르게' },
          { field: 'hookTitle', instruction: '제목을 더 크게' },
        ],
      }),
      spec(),
    ).join('\n')
    expect(lines).toMatch(/"리듬감 있게".*반영하지 못했어요/)
    expect(lines).toMatch(/"제목을 더 크게".*반영하지 못했어요/)
    expect(lines).toContain('컷을 더 빠르게')
    expect(lines).not.toMatch(/"컷을 더 빠르게".*반영하지 못했어요/)
  })

  test('(I6) 전환 효과 줄은 실제 적용되는 전환(레퍼런스의 주된 전환)을 말한다', () => {
    const lines = planCardLines(plan(), spec({ transitions: { dominant: 'hard-cut' } })).join('\n')
    expect(lines).toMatch(/전환 효과: 깔끔한 하드컷/)
  })

  test('제외·지원 불가 요청도 보여 준다', () => {
    const lines = planCardLines(
      plan({ mode: 'targeted', take: ['captions'], skip: ['pacing'], unsupported: [{ request: '카메라 워크', reason: '지원하지 않아요', alternative: '컷으로 비슷한 분위기를 내요' }] }),
      spec(),
    ).join('\n')
    expect(lines).toMatch(/컷 속도.*따라 하지 않아요/)
    expect(lines).toContain('카메라 워크')
    expect(lines).toContain('컷으로 비슷한 분위기를 내요')
  })
})

describe('deriveAppliedStyle', () => {
  test('컷이 빠른 레퍼런스(분당 24컷)는 여백 0.12초', () => {
    expect(deriveAppliedStyle(plan(), spec({ pacing: { shotCount: 9, avgShotLengthSec: 2.5, cutsPerMinute: 24 } }), summary, 'short').padSec).toBe(0.12)
  })
  test('컷이 느린 레퍼런스(분당 6컷)는 여백 0.3초', () => {
    expect(deriveAppliedStyle(plan(), spec({ pacing: { shotCount: 3, avgShotLengthSec: 10, cutsPerMinute: 6 } }), summary, 'short').padSec).toBe(0.3)
  })
  test('중간(분당 12컷)은 0.2초', () => {
    expect(deriveAppliedStyle(plan(), spec(), summary, 'short').padSec).toBe(0.2)
  })

  describe('(I6) 전환 효과는 컷 속도가 아니라 레퍼런스의 주된 전환을 따른다', () => {
    const withTransition = (dominant: StyleSpec['transitions']['dominant'], cpm = 12) => spec({ transitions: { dominant }, pacing: { shotCount: 9, avgShotLengthSec: 4, cutsPerMinute: cpm } })
    test('펀치 줌 레퍼런스는 컷이 느려도(분당 6컷) 펀치 줌', () => {
      expect(deriveAppliedStyle(plan(), withTransition('punch-zoom', 6), summary, 'short').transition).toBe('punch-zoom')
    })
    test('하드컷 레퍼런스는 컷이 빨라도(분당 30컷) 하드컷', () => {
      expect(deriveAppliedStyle(plan(), withTransition('hard-cut', 30), summary, 'short').transition).toBe('hard-cut')
    })
    test('크로스페이드·기타는 하드컷으로 근사한다', () => {
      expect(deriveAppliedStyle(plan(), withTransition('crossfade'), summary, 'short').transition).toBe('hard-cut')
      expect(deriveAppliedStyle(plan(), withTransition('other'), summary, 'short').transition).toBe('hard-cut')
    })
    test('전환을 따르지 않기로 했으면 컷이 빨라도 하드컷', () => {
      const p = plan({ take: ['pacing', 'captions'], skip: ['transitions'] })
      expect(deriveAppliedStyle(p, withTransition('punch-zoom', 30), summary, 'short').transition).toBe('hard-cut')
    })
  })

  test('pacing 을 안 따르면 기본 여백(0.25초)', () => {
    const s = deriveAppliedStyle(plan({ take: ['captions'], skip: ['pacing'] }), spec(), summary, 'short')
    expect(s.padSec).toBe(0.25)
    expect(s.transition).toBe('hard-cut')
  })

  test('자막을 따르면 레퍼런스의 위치·색·크기·글자 수를 쓴다 (short large = 80px)', () => {
    const s = deriveAppliedStyle(plan(), spec(), summary, 'short')
    expect(s.captions).toEqual({ position: 'middle', sizePx: 80, color: '#FFE600', highlightColor: '#FF3366', maxChars: 12 })
  })
  test.each([
    ['short', 'small', 52],
    ['short', 'medium', 64],
    ['short', 'large', 80],
    ['post', 'small', 40],
    ['post', 'medium', 48],
    ['post', 'large', 60],
  ] as const)('%s 용도 %s 자막은 %ipx', (purpose, size, px) => {
    const s = deriveAppliedStyle(plan(), spec({ captions: { ...spec().captions, size } }), summary, purpose)
    expect(s.captions.sizePx).toBe(px)
  })

  test('자막을 따르지 않으면 용도별 기본 스타일', () => {
    const p = plan({ take: ['pacing'], skip: ['captions'] })
    expect(deriveAppliedStyle(p, spec(), summary, 'short').captions).toEqual({ position: 'bottom', sizePx: 64, color: '#FFFFFF', maxChars: 14 })
    expect(deriveAppliedStyle(p, spec(), summary, 'post').captions).toEqual({ position: 'bottom', sizePx: 48, color: '#FFFFFF', maxChars: 22 })
  })

  test('색은 #RRGGBB 형식만 통과시킨다 (HTML 에 들어가는 값)', () => {
    const bad = spec({ captions: { ...spec().captions, color: 'red; background:url(x)', highlightColor: 'pink' } })
    const s = deriveAppliedStyle(plan(), bad, summary, 'short')
    expect(s.captions.color).toBe('#FFFFFF')
    expect(s.captions.highlightColor).toBeUndefined()
  })

  describe('조정(adjust) 반영', () => {
    const adj = (field: 'pacing' | 'captions', instruction: string) => plan({ adjust: [{ field, instruction }] })

    test('"더 빠르게" 는 컷 여백만 줄인다 (0.2 → 0.12) — 전환 효과는 그대로', () => {
      const s = deriveAppliedStyle(adj('pacing', '컷을 더 빠르게'), spec({ transitions: { dominant: 'hard-cut' } }), summary, 'short')
      expect(s.padSec).toBe(0.12)
      expect(s.transition).toBe('hard-cut')
    })
    test('pacing 을 안 따라도 조정은 기본값(0.25)에 적용된다 (0.15)', () => {
      const s = deriveAppliedStyle(plan({ take: ['captions'], adjust: [{ field: 'pacing', instruction: '더 빠르게' }] }), spec(), summary, 'short')
      expect(s.padSec).toBe(0.15)
    })
    test('"더 느긋하게" 는 여백을 늘린다 (0.2 → 0.3)', () => {
      const s = deriveAppliedStyle(adj('pacing', '컷을 더 느긋하게'), spec({ transitions: { dominant: 'hard-cut' } }), summary, 'short')
      expect(s.padSec).toBe(0.3)
      expect(s.transition).toBe('hard-cut')
    })
    test('여백은 0.08~0.5초 안에서만 움직인다', () => {
      const fast = deriveAppliedStyle(adj('pacing', '더 빠르게'), spec({ pacing: { shotCount: 20, avgShotLengthSec: 1, cutsPerMinute: 40 } }), summary, 'short')
      expect(fast.padSec).toBeGreaterThanOrEqual(0.08)
      const slow = deriveAppliedStyle(adj('pacing', '더 느긋하게'), spec({ pacing: { shotCount: 2, avgShotLengthSec: 20, cutsPerMinute: 3 } }), summary, 'short')
      expect(slow.padSec).toBeLessThanOrEqual(0.5)
    })
    test('"자막 더 크게" 는 한 단계 키우고 "작게" 는 한 단계 줄인다', () => {
      const medium = spec({ captions: { ...spec().captions, size: 'medium' } })
      expect(deriveAppliedStyle(adj('captions', '자막을 더 크게'), medium, summary, 'short').captions.sizePx).toBe(80)
      expect(deriveAppliedStyle(adj('captions', '자막을 더 작게'), medium, summary, 'short').captions.sizePx).toBe(52)
      const large = spec({ captions: { ...spec().captions, size: 'large' } })
      expect(deriveAppliedStyle(adj('captions', '더 크게'), large, summary, 'short').captions.sizePx).toBe(80)
    })
    test('해석할 수 없는 조정 문구는 무시한다', () => {
      const s = deriveAppliedStyle(adj('pacing', '약간 다르게'), spec(), summary, 'short')
      expect(s.padSec).toBe(0.2)
    })
  })

  test('제목 카드는 따르기로 했고 레퍼런스에 있을 때만, 요약의 hookTitle 로 2.5초', () => {
    expect(deriveAppliedStyle(plan(), spec(), summary, 'short').hookTitle).toEqual({ text: '롱아이언 이것만 기억', durationSec: 2.5 })
    expect(deriveAppliedStyle(plan({ take: ['pacing'], skip: ['hookTitle'] }), spec(), summary, 'short').hookTitle).toBeUndefined()
    expect(deriveAppliedStyle(plan(), spec({ hookTitle: { present: false } }), summary, 'short').hookTitle).toBeUndefined()
  })
})
