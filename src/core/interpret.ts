import { z } from 'zod'
import { askClaude } from './llm.ts'
import { FEASIBILITY, STYLE_FIELDS, type StyleField, type StyleSpec } from './styleSpec.ts'
import type { Purpose } from './types.ts'
import type { VideoSummary } from './understand.ts'

const Field = z.enum(STYLE_FIELDS)

export const EditPlan = z.object({
  mode: z.enum(['full-reference', 'targeted']),
  take: z.array(Field),
  skip: z.array(Field),
  adjust: z.array(z.object({ field: Field, instruction: z.string() })),
  unsupported: z.array(z.object({ request: z.string(), reason: z.string(), alternative: z.string().optional() })),
})
export type EditPlan = z.infer<typeof EditPlan>

const LABEL: Record<StyleField, string> = {
  pacing: '컷 속도',
  captions: '자막 스타일',
  hookTitle: '시작 제목 카드',
  transitions: '전환 효과',
  music: '음악',
  structure: '영상 구성',
  orientation: '화면 비율',
}

const CAMERA_VFX = /카메라 ?워크|VFX|합성|3D|드론/i

const PROMPT_RULES = [
  '당신은 영상 자동 편집 프로그램의 요청 해석기입니다. 사용자가 레퍼런스 영상에서 무엇을 참고하길 원하는지 JSON 으로 정리하세요.',
  `항목 이름은 ${STYLE_FIELDS.join(', ')} 중에서만 씁니다. (pacing=컷 속도, captions=자막 스타일, hookTitle=시작 제목 카드, transitions=전환 효과, music=음악, structure=영상 구성, orientation=화면 비율)`,
  '- 사용자가 말한 항목은 take, 따라 하지 말라고 한 항목은 skip, "더 빠르게" 같은 조정은 adjust(field, instruction)에 넣습니다. 말하지 않은 항목은 mode 가 targeted 이면 take 에 넣지 않습니다.',
  '- 이번 버전에서 못 하는 것(카메라 워크, 실사 합성 VFX, 하단바·콜아웃 오버레이)을 요청하면 unsupported 에 request·reason(한국어)·alternative(가능한 비슷한 대안)를 적습니다.',
  '- 배경음악·효과음은 사용자가 계획 승인 화면에서 직접 고르므로 unsupported 에 넣지 마세요. 요청에 음악·효과음 얘기가 있으면 adjust(field: "music", instruction)로만 적습니다.',
  '- 출력은 JSON 한 개: {"mode": "targeted", "take": [], "skip": [], "adjust": [], "unsupported": []} (다른 글 금지)',
].join('\n')

export async function interpretRequest(
  i: { spec: StyleSpec; userText?: string; summary: VideoSummary; /** 레퍼런스를 분석했는지 (기본 true) */ hasReference?: boolean },
  deps: { ask?: typeof askClaude } = {},
): Promise<EditPlan> {
  const text = (i.userText ?? '').trim()
  if (!text) {
    return {
      mode: 'full-reference',
      take: STYLE_FIELDS.filter((f) => FEASIBILITY[f] !== 'unsupported'),
      skip: [],
      adjust: [],
      unsupported: [],
    }
  }

  const ask = deps.ask ?? askClaude
  const hasReference = i.hasReference ?? true
  const { feasibility: _omit, ...specForPrompt } = i.spec
  const prompt = [
    PROMPT_RULES,
    '',
    `내 영상: ${i.summary.genre} — ${i.summary.oneLine}`,
    hasReference
      ? `레퍼런스 스타일(측정·분석 결과): ${JSON.stringify(specForPrompt)}`
      : '레퍼런스 없음 — 따라 할 레퍼런스가 없으므로 take·skip 은 비워 두고, 사용자의 요청은 adjust(조정)와 unsupported(지원 불가)로만 정리하세요.',
    `사용자 요청: ${text}`,
  ].join('\n')
  const asked = await ask({ prompt, schema: EditPlan, effort: 'low' })
  // 레퍼런스가 없으면 "레퍼런스에서 참고할 항목" 은 있을 수 없다
  const plan: EditPlan = hasReference ? asked : { ...asked, mode: 'targeted', take: [], skip: [] }

  const camera = text.match(CAMERA_VFX)
  if (camera && !plan.unsupported.some((u) => CAMERA_VFX.test(u.request))) {
    return {
      ...plan,
      unsupported: [
        ...plan.unsupported,
        {
          request: camera[0],
          reason: '카메라 워크·실사 합성 VFX 는 이번 버전에서 지원하지 않아요',
          alternative: '컷 속도·자막·제목 카드·전환으로 비슷한 분위기를 내볼게요',
        },
      ],
    }
  }
  return plan
}

const POSITION_KO = { top: '상단', middle: '중앙', bottom: '하단' } as const
const SIZE_KO = { small: '작은', medium: '보통', large: '큰' } as const
const TRANSITION_KO = {
  'hard-cut': '깔끔한 하드컷',
  'punch-zoom': '컷마다 살짝 확대되는 전환',
  crossfade: '크로스페이드 대신 하드컷으로 비슷하게',
  other: '하드컷',
} as const

function detail(f: StyleField, spec: StyleSpec): string {
  switch (f) {
    case 'pacing':
      return `분당 ${Math.round(spec.pacing.cutsPerMinute)}컷 정도의 빠르기에 맞춰요`
    case 'captions':
      return `${POSITION_KO[spec.captions.position]} ${SIZE_KO[spec.captions.size]} 글씨, ${legibleColor(spec.captions.color, '#FFFFFF')} 색으로 넣어요`
    case 'hookTitle':
      return spec.hookTitle.present ? '영상 첫머리에 제목 카드를 넣어요' : '레퍼런스에 제목 카드가 없어서 넣지 않아요'
    case 'transitions':
      return TRANSITION_KO[spec.transitions.dominant]
    case 'orientation':
      return '선택한 용도(가로/세로)에 맞춰요'
    case 'structure':
      return '레퍼런스의 구성(훅 → 흐름 → 결과)을 참고해 AI 가 편집 대본을 새로 짜요'
    case 'music':
      return spec.music.present
        ? '레퍼런스에 음악이 있는 것 같아요. 같은 곡은 쓸 수 없고, 아래 "배경음악"에서 곡을 직접 골라 넣을 수 있어요'
        : '레퍼런스에 음악이 없어 보여요. 필요하면 아래 "배경음악"에서 곡을 골라 넣을 수 있어요'
    default:
      return ''
  }
}

/** 렌더 전에 사용자에게 보여 주는 "이렇게 이해했어요" 카드의 줄들. */
export function planCardLines(plan: EditPlan, spec: StyleSpec): string[] {
  const lines: string[] = []
  lines.push(
    plan.mode === 'full-reference'
      ? '이렇게 이해했어요: 레퍼런스의 편집 스타일을 최대한 따라 해요.'
      : plan.take.length
        ? `이렇게 이해했어요: 레퍼런스에서 ${plan.take.map((f) => LABEL[f]).join(', ')}을(를) 참고해요.`
        : '이렇게 이해했어요: 요청하신 대로 편집해요.',
  )
  for (const f of plan.take) {
    if (FEASIBILITY[f] === 'unsupported') continue
    lines.push(`• ${LABEL[f]}: ${detail(f, spec)}${FEASIBILITY[f] === 'approximate' ? ' (비슷하게만 가능해요)' : ''}`)
  }
  for (const f of plan.skip) lines.push(`• ${LABEL[f]}: 따라 하지 않아요`)
  for (const a of plan.adjust) {
    lines.push(
      isAdjustApplied(a)
        ? `• ${LABEL[a.field]}: ${a.instruction}`
        : a.field === 'music'
          ? `• ${LABEL[a.field]}: "${a.instruction}" 는 요청란으로는 반영하지 못해요 — 배경음악·효과음은 아래에서 직접 골라 주세요`
          : `• ${LABEL[a.field]}: "${a.instruction}" 는 이번 버전에서 반영하지 못했어요`,
    )
  }
  for (const f of STYLE_FIELDS) if (FEASIBILITY[f] === 'unsupported') lines.push(`• ${LABEL[f]}: 이번 버전에서는 지원하지 않아요`)
  for (const u of plan.unsupported) lines.push(`• 요청하신 "${u.request}": ${u.reason}${u.alternative ? ` — ${u.alternative}` : ''}`)
  return lines
}

export interface AppliedStyle {
  captions: { position: 'top' | 'middle' | 'bottom'; sizePx: number; color: string; highlightColor?: string; maxChars: number }
  hookTitle?: { text: string; durationSec: number }
  transition: 'hard-cut' | 'punch-zoom'
  padSec: number
}

const SIZE_PX: Record<Purpose, Record<'small' | 'medium' | 'large', number>> = {
  short: { small: 52, medium: 64, large: 80 },
  post: { small: 40, medium: 48, large: 60 },
}
const DEFAULT_MAX_CHARS: Record<Purpose, number> = { short: 14, post: 22 }
const HEX = /^#[0-9a-f]{6}$/i

/** 자막 글자는 검은 테두리를 두르므로, 이보다 어두운 색(상대 휘도)은 테두리에 묻혀 읽을 수 없다. 빨강(0.21)·분홍은 통과한다. */
const MIN_CAPTION_LUMINANCE = 0.15

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((k) => {
    const c = parseInt(hex.slice(k, k + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** 너무 어두운 자막 색이면 fallback 으로 바꾼다(레퍼런스의 어두운 글자색을 그대로 따르면 영상 위에서 안 보인다). */
export const legibleColor = (hex: string, fallback: string): string => (luminance(hex) < MIN_CAPTION_LUMINANCE ? fallback : hex)

const FASTER = /빠르|빨리|짧게|타이트|촘촘|faster|tight/i
const SLOWER = /느리|느긋|여유|길게|천천|slow/i
const BIGGER = /크게|키워|bigger|larger/i
const SMALLER = /작게|줄여|smaller/i
const SIZES = ['small', 'medium', 'large'] as const
const round2 = (n: number) => Math.round(n * 100) / 100

/** 조정 문구가 한쪽 방향을 분명히 가리킬 때만 +1 / -1, 아니면 0 */
function direction(text: string, up: RegExp, down: RegExp): 1 | -1 | 0 {
  const u = up.test(text)
  const d = down.test(text)
  return u && !d ? 1 : d && !u ? -1 : 0
}

/** 이 조정 문구가 실제 편집 스타일에 반영되는가 (카드가 반영되지 않는 것을 반영된 듯 말하지 않게) */
export function isAdjustApplied(a: { field: StyleField; instruction: string }): boolean {
  if (a.field === 'pacing') return direction(a.instruction, FASTER, SLOWER) !== 0
  if (a.field === 'captions') return direction(a.instruction, BIGGER, SMALLER) !== 0
  return false
}

export function deriveAppliedStyle(plan: EditPlan, spec: StyleSpec, summary: VideoSummary, purpose: Purpose): AppliedStyle {
  const takes = (f: StyleField) => plan.take.includes(f) && !plan.skip.includes(f)
  const adjustText = (f: StyleField) => plan.adjust.filter((a) => a.field === f).map((a) => a.instruction).join(' ')

  const sizeIdx = SIZES.indexOf(takes('captions') ? spec.captions.size : 'medium')
  const bump = direction(adjustText('captions'), BIGGER, SMALLER)
  const sizeKey = SIZES[Math.min(SIZES.length - 1, Math.max(0, sizeIdx + bump))]!

  let captions: AppliedStyle['captions'] = { position: 'bottom', sizePx: SIZE_PX[purpose][sizeKey], color: '#FFFFFF', maxChars: DEFAULT_MAX_CHARS[purpose] }
  if (takes('captions')) {
    const c = spec.captions
    captions = {
      position: c.position,
      sizePx: SIZE_PX[purpose][sizeKey],
      color: HEX.test(c.color) ? legibleColor(c.color, '#FFFFFF') : '#FFFFFF',
      ...(c.highlightColor && HEX.test(c.highlightColor) ? { highlightColor: legibleColor(c.highlightColor, '#FFD400') } : {}),
      maxChars: Math.min(30, Math.max(6, c.maxCharsPerLine)),
    }
  }

  let padSec = 0.25
  if (takes('pacing')) {
    const cpm = spec.pacing.cutsPerMinute
    padSec = cpm >= 20 ? 0.12 : cpm <= 8 ? 0.3 : 0.2
  }
  const pace = direction(adjustText('pacing'), FASTER, SLOWER)
  if (pace === 1) padSec = round2(Math.max(0.08, padSec * 0.6))
  else if (pace === -1) padSec = round2(Math.min(0.5, padSec * 1.5))

  // 전환 효과는 컷 속도가 아니라 레퍼런스의 주된 전환을 따른다 (크로스페이드·기타는 하드컷으로 근사)
  const transition: AppliedStyle['transition'] = takes('transitions') && spec.transitions.dominant === 'punch-zoom' ? 'punch-zoom' : 'hard-cut'

  const hookTitle = takes('hookTitle') && spec.hookTitle.present ? { text: summary.hookTitle, durationSec: 2.5 } : undefined
  return { captions, ...(hookTitle ? { hookTitle } : {}), transition, padSec }
}
