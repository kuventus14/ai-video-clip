import { describe, expect, it } from 'vitest'
import type { ReportDto } from '../src/shared/types.ts'
import { correctionReasonLabel, downloadName, groupFindings, mergeRequest, oppositePurpose, verdictOf } from '../src/ui/report.ts'

const report = (over: Partial<ReportDto> = {}): ReportDto => ({ passed: true, attempts: 1, reframe: 'none', purpose: 'short', findings: [], appliedCorrections: [], suggestions: [], unchecked: [], ...over })
const finding = (id: string, severity: 'high' | 'medium' | 'info', atSec?: number) => ({ id, severity, message: `${id} 메시지`, ...(atSec === undefined ? {} : { atSec }) })

describe('correctionReasonLabel', () => {
  it('엔진의 코드를 한국어로, 모르는 값은 그대로', () => {
    expect(correctionReasonLabel('typo')).toBe('오탈자')
    expect(correctionReasonLabel('term')).toBe('전문 용어')
    expect(correctionReasonLabel('spacing')).toBe('띄어쓰기')
    expect(correctionReasonLabel('"롱 아이런" 오타를 고쳤어요')).toBe('"롱 아이런" 오타를 고쳤어요')
  })
})

describe('groupFindings', () => {
  it('심각도별로 묶고 시간 순으로 정렬하며 시간이 없는 것은 뒤에 둔다', () => {
    const g = groupFindings([finding('a', 'medium', 20), finding('b', 'high', 5), finding('c', 'medium', 3), finding('d', 'medium'), finding('e', 'info', 1)])
    expect(g.high.map((f) => f.id)).toEqual(['b'])
    expect(g.medium.map((f) => f.id)).toEqual(['c', 'a', 'd'])
    expect(g.info.map((f) => f.id)).toEqual(['e'])
  })
  it('자막 제안(caption-suggestion)은 제안 목록에 따로 나오므로 여기서는 뺀다', () => {
    const g = groupFindings([finding('caption-suggestion', 'info', 3), finding('quality-upscale', 'info')])
    expect(g.info.map((f) => f.id)).toEqual(['quality-upscale'])
  })
})

describe('verdictOf — 낙관하지 않는다', () => {
  it('리포트를 못 읽었으면 통과라고 하지 않는다', () => {
    expect(verdictOf(null)).toEqual({ tone: 'warn', text: '검수 리포트를 읽지 못했어요' })
  })
  it('통과하고 중요·확인 항목이 없으면 통과', () => {
    expect(verdictOf(report({ findings: [finding('x', 'info')] }))).toEqual({ tone: 'ok', text: '검수 통과' })
  })
  it('통과 표시여도 확인 항목이 있으면 건수를 말한다', () => {
    expect(verdictOf(report({ findings: [finding('x', 'medium', 1), finding('y', 'high', 2), finding('z', 'info')] }))).toEqual({ tone: 'warn', text: '확인할 것 2건' })
  })
  it('통과하지 못했는데 항목이 없으면 그냥 확인 필요', () => {
    expect(verdictOf(report({ passed: false }))).toEqual({ tone: 'warn', text: '확인 필요' })
  })
})

describe('downloadName / mergeRequest / oppositePurpose', () => {
  it('내려받을 파일 이름: 원본 이름에서 확장자를 떼고 _편집본.mp4, 이름이 없으면 제목', () => {
    expect(downloadName({ sourceName: '롱아이언_릴스.mov', title: '제목' })).toBe('롱아이언_릴스_편집본.mp4')
    expect(downloadName({ sourceName: null, title: '골프 레슨 / 체중' })).toBe('골프 레슨 - 체중_편집본.mp4')
    expect(downloadName({ sourceName: null, title: '' })).toBe('편집본.mp4')
    expect(downloadName({ sourceName: '롱아이언_릴스_편집본.mp4', title: '' })).toBe('롱아이언_릴스_편집본.mp4')
  })
  it('수정 요청은 이전 요청에 덧붙인다', () => {
    expect(mergeRequest('자막은 크게', '컷은 더 빠르게')).toBe('자막은 크게\n컷은 더 빠르게')
    expect(mergeRequest('', '  컷은 더 빠르게  ')).toBe('컷은 더 빠르게')
    expect(mergeRequest('자막은 크게', '   ')).toBe('자막은 크게')
  })
  it('반대 용도', () => {
    expect(oppositePurpose('short')).toBe('post')
    expect(oppositePurpose('post')).toBe('short')
  })
})
