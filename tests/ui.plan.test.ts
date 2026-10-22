import { describe, expect, it } from 'vitest'
import { parsePlanCard, planItemKind } from '../src/ui/plan.ts'

describe('parsePlanCard', () => {
  it('첫 줄의 "이렇게 이해했어요:" 는 머리말로, • 줄은 항목으로 나눈다', () => {
    const r = parsePlanCard(['이렇게 이해했어요: 레퍼런스의 편집 스타일을 최대한 따라 해요.', '• 자막: 아래쪽에 큰 글씨로 넣어요', '• 컷 속도: 따라 하지 않아요'])
    expect(r.headline).toBe('레퍼런스의 편집 스타일을 최대한 따라 해요.')
    expect(r.items).toEqual([
      { text: '자막: 아래쪽에 큰 글씨로 넣어요', tone: 'normal' },
      { text: '컷 속도: 따라 하지 않아요', tone: 'normal' },
    ])
  })

  it('반영하지 못했거나 지원하지 않거나 비슷하게만 되는 줄은 주의로 표시한다', () => {
    const r = parsePlanCard([
      '이렇게 이해했어요: 요청하신 대로 편집해요.',
      '• 전환 효과: "줌 인" 는 이번 버전에서 반영하지 못했어요',
      '• 배경 음악: 이번 버전에서는 지원하지 않아요',
      '• 색감: 레퍼런스와 비슷하게 (비슷하게만 가능해요)',
      '• 요청하신 "카메라 흔들림": 카메라 워크·실사 합성 VFX 는 이번 버전에서 지원하지 않아요',
      '• 자막: 아래쪽에 넣어요',
    ])
    expect(r.items.map((i) => i.tone)).toEqual(['warn', 'warn', 'warn', 'warn', 'normal'])
  })

  it('머리말이 없거나 • 가 없는 줄도 잃지 않는다', () => {
    expect(parsePlanCard(['그냥 한 줄']).headline).toBeNull()
    expect(parsePlanCard(['그냥 한 줄']).items).toEqual([{ text: '그냥 한 줄', tone: 'normal' }])
    expect(parsePlanCard([])).toEqual({ headline: null, items: [] })
  })

  it('빈 줄은 버리고 앞뒤 공백을 다듬는다', () => {
    const r = parsePlanCard(['  이렇게 이해했어요:   긴 문장이에요  ', '', '•   공백이 많아요  '])
    expect(r.headline).toBe('긴 문장이에요')
    expect(r.items).toEqual([{ text: '공백이 많아요', tone: 'normal' }])
  })
})

describe('planItemKind — 계획 항목 앞의 아이콘 종류', () => {
  it('항목 맨 앞 말(자막·제목 카드·컷·화면…)로 고른다', () => {
    expect(planItemKind('자막: 아래쪽에 큰 글씨로 넣어요')).toBe('captions')
    expect(planItemKind('자막 스타일: 하단 큰 글씨')).toBe('captions')
    expect(planItemKind('제목 카드: 처음 3초에 띄워요')).toBe('title')
    expect(planItemKind('컷 속도: 더 빠르게')).toBe('cuts')
    expect(planItemKind('컷: 군더더기를 정리해요')).toBe('cuts')
    expect(planItemKind('화면 구도: 세로 9:16')).toBe('frame')
    expect(planItemKind('화면 구성: 블러 배경')).toBe('frame')
    expect(planItemKind('음악: 이번 버전에서는 지원하지 않아요')).toBe('music')
    expect(planItemKind('전환 효과: 줌 인')).toBe('transition')
  })
  it('모르는 항목은 other', () => {
    expect(planItemKind('요청하신 "카메라 흔들림": 지원하지 않아요')).toBe('other')
    expect(planItemKind('')).toBe('other')
  })
})

describe('planItemKind — 편집 감독 줄', () => {
  it.each([
    ['후킹: 원본 14.2초부터 …', 'title'],
    ['소제목: 여기서 포인트! → 체크 방법!', 'title'],
    ['소개 줄: 롱아이언 실전편 / …', 'title'],
    ['중간 질문 2개, 리액션 1개를 넣어요', 'title'],
    ['속도: 1.1배로 올려 템포를 살려요', 'cuts'],
    ['빼는 구간: 2곳(약 5초)', 'cuts'],
    ['영상 구성: 레퍼런스의 구성을 따라 AI 가 편집 대본을 새로 짜요', 'title'],
    ['편집 구성을 AI가 짜지 못해서 기본 방식(컷+자막)으로 만들어요', 'other'],
  ] as const)('%s → %s', (text, kind) => {
    expect(planItemKind(text)).toBe(kind)
  })
  it('AI 가 못 짰다는 줄은 주의(노란 줄)로 표시된다', () => {
    const r = parsePlanCard(['이렇게 이해했어요: 기본 스타일로 편집해요.', '• 편집 구성을 AI가 짜지 못해서 기본 방식(컷+자막)으로 만들어요'])
    expect(r.items[0]!.tone).toBe('warn')
  })
})
