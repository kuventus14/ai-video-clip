import { z } from 'zod'
import { cleanScriptText, SCRIPT_TEXT_LIMITS } from '../shared/scriptText.ts'
import type { ScriptEdits } from '../shared/types.ts'
import type { RenderScript } from './compose.ts'
import { srcToOut } from './timeline.ts'
import type { Span } from './types.ts'

/** 편집 대본의 상한. 문구는 글자(코드포인트) 수, 시간은 초. */
export const SCRIPT_LIMITS = {
  ...SCRIPT_TEXT_LIMITS,
  emphasisWord: 12,
  maxSections: 5,
  maxQuestions: 3,
  maxReactions: 2,
  maxEmphasis: 30,
  hookMinSec: 1.5,
  hookMaxSec: 4,
  speedMin: 1,
  speedMax: 1.25,
  dropMaxFraction: 0.25,
  shortVideoSec: 10,
  /** 릴스·숏츠 결과 영상의 최대 길이. 원본이 이보다 길면 핵심만 남겨 줄이고, 짧으면 길이를 그대로 둔다 */
  shortMaxSec: 60,
  /** 같은 종류의 오버레이 사이 최소 간격 */
  minGapSec: 2,
} as const

const Labeled = z.object({ atSec: z.number().finite(), label: z.string() })
const Texted = z.object({ atSec: z.number().finite(), text: z.string() })

/** AI 편집 감독이 내는 편집 대본. 시간은 모두 **원본 영상 기준** 초. */
export const EditScriptSchema = z.object({
  version: z.literal(1),
  /** 화면 위에 계속 고정되는 흰 박스 제목 */
  title: z.string(),
  /** 맨 앞에 먼저 보여 줄 인상적인 장면(원본 구간)과 그 위에 띄울 큰 질문 */
  hook: z.object({ sourceStart: z.number().finite(), sourceEnd: z.number().finite(), question: z.string() }).optional(),
  /** 훅 직후 3초 안팎 보여 주는 소개 줄(최대 3) */
  openingLines: z.array(z.string()),
  /** 노란 소제목: atSec 부터 다음 소제목까지 위에 머문다 */
  sections: z.array(Labeled),
  /** 중간 훅 질문(핑크, 2.5초) */
  questions: z.array(Texted),
  /** 리액션 자막(노란 박스, 2.5초) */
  reactions: z.array(Texted),
  /** 대사 자막에서 노란색으로 강조할 단어 */
  emphasis: z.array(z.string()),
  /** 전체 속도(1~1.25) */
  speed: z.number(),
  /** 빼도 되는 약한 구간 */
  drop: z.array(z.object({ start: z.number(), end: z.number() })),
})
export type EditScript = z.infer<typeof EditScriptSchema>

export const emptyScript = (title: string): EditScript => ({ version: 1, title, openingLines: [], sections: [], questions: [], reactions: [], emphasis: [], speed: 1, drop: [] })

const len = (s: string) => Array.from(s).length
const cleanText = cleanScriptText

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const round3 = (n: number) => Math.round(n * 1000) / 1000

/** 어절 단위로 max 글자 안에 들어가게 줄인다(제목 대체용). 첫 어절이 너무 길면 앞 max 글자. */
function fitWords(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (len(t) <= max) return t
  let out = ''
  for (const w of t.split(' ')) {
    const next = out ? `${out} ${w}` : w
    if (len(next) > max) break
    out = next
  }
  return out || Array.from(t).slice(0, max).join('')
}

/** 시각 순으로 정렬하고, 앞 항목과 minGapSec 안이면 뒤의 것을 뺀 뒤 max 개로 자른다. */
function spaced<T extends { atSec: number }>(items: T[], max: number, notes: string[], what: string): T[] {
  const sorted = [...items].sort((a, b) => a.atSec - b.atSec)
  const out: T[] = []
  for (const it of sorted) {
    if (out.length && it.atSec - out.at(-1)!.atSec < SCRIPT_LIMITS.minGapSec) {
      notes.push(`${what}이(가) 앞 항목과 ${SCRIPT_LIMITS.minGapSec}초 안이라 뺐어요`)
      continue
    }
    out.push(it)
  }
  if (out.length > max) notes.push(`${what}은(는) ${max}개까지만 써요`)
  return out.slice(0, max)
}

function timedList(raw: unknown, key: 'label' | 'text', max: number, textMax: number, durationSec: number, what: string, notes: string[]): { atSec: number; label?: string; text?: string }[] {
  if (!Array.isArray(raw)) return []
  const items: { atSec: number; label?: string; text?: string }[] = []
  for (const r of raw) {
    if (!isObj(r)) continue
    const at = num(r.atSec)
    if (at === null || at < 0 || at > durationSec) {
      notes.push(`${what}의 시각이 영상 밖이라 뺐어요`)
      continue
    }
    const c = cleanText(r[key], textMax)
    if ('why' in c) {
      notes.push(`${what} 문구를 뺐어요(${c.why})`)
      continue
    }
    items.push({ atSec: round3(at), [key]: c.ok })
  }
  return spaced(items, max, notes, what)
}

/** 대본 정리에 필요한 정보. maxOutputSec 는 결과 길이 상한(릴스·숏츠면 60초) */
export interface ScriptContext {
  durationSec: number
  fallbackTitle: string
  maxOutputSec?: number
}

/**
 * 빼는 구간에 쓸 수 있는 최대 길이(초). 보통은 전체의 25%.
 * 결과 길이 상한이 있고 원본이 그보다 길면 핵심만 남기도록 상한까지 줄일 만큼 허용한다(그래도 상한의 절반은 남긴다).
 * 상한이 있고 원본이 그 안이면 0 — 길이를 그대로 두고 편집만 한다.
 */
export function dropBudgetSec(durationSec: number, maxOutputSec?: number): number {
  const usual = durationSec * SCRIPT_LIMITS.dropMaxFraction
  if (maxOutputSec === undefined) return usual
  if (durationSec <= maxOutputSec) return 0
  return Math.max(usual, durationSec - maxOutputSec / 2)
}

function normalizeDrop(raw: unknown, durationSec: number, notes: string[], maxOutputSec?: number): Span[] {
  if (!Array.isArray(raw)) return []
  const spans: Span[] = []
  for (const r of raw) {
    if (!isObj(r)) continue
    const s = num(r.start)
    const e = num(r.end)
    if (s === null || e === null) continue
    const a = Math.max(0, s)
    const b = Math.min(durationSec, e)
    if (b - a > 0.05) spans.push({ start: round3(a), end: round3(b) })
  }
  spans.sort((x, y) => x.start - y.start)
  const merged: Span[] = []
  for (const sp of spans) {
    const last = merged.at(-1)
    if (last && sp.start <= last.end) last.end = Math.max(last.end, sp.end)
    else merged.push({ ...sp })
  }
  let budget = dropBudgetSec(durationSec, maxOutputSec)
  if (merged.length && budget <= 0.05) {
    notes.push(`영상이 ${maxOutputSec}초 이하라 길이를 그대로 두고 빼는 구간은 쓰지 않아요`)
    return []
  }
  const out: Span[] = []
  for (const sp of merged) {
    if (budget <= 0.05) {
      notes.push('빼도 되는 구간이 한도를 넘어서 뒤쪽은 뺐어요')
      break
    }
    const length = sp.end - sp.start
    if (length > budget) {
      out.push({ start: sp.start, end: round3(sp.start + budget) })
      notes.push('빼도 되는 구간이 한도를 넘어서 줄였어요')
      budget = 0
    } else {
      out.push(sp)
      budget -= length
    }
  }
  return out
}

/**
 * AI 가 낸 대본(무엇이든)을 쓸 수 있는 편집 대본으로 정리한다. **던지지 않는다**: 못 쓰는 항목만 빼고 이유를 notes(한국어)에 남긴다.
 * 10초 이하 영상은 제목만 남긴다(훅·소제목을 억지로 만들면 영상이 더 나빠진다).
 */
export function normalizeScript(raw: unknown, ctx: ScriptContext): { script: EditScript; notes: string[] } {
  const notes: string[] = []
  const d = ctx.durationSec
  const o = isObj(raw) ? raw : {}
  if (!isObj(raw)) notes.push('AI 대본을 읽을 수 없어서 제목만 있는 대본으로 시작해요')

  // 제목: 비었거나 상한을 넘으면 장르(fallbackTitle)로 대체
  const t = cleanText(o.title, SCRIPT_LIMITS.title)
  if ('why' in t && isObj(raw)) notes.push(`제목을 쓰지 않았어요(${t.why}) — 영상 장르로 대신했어요`)
  const title = 'ok' in t ? t.ok : fitWords(ctx.fallbackTitle, SCRIPT_LIMITS.title)

  const script = emptyScript(title)
  const sp = num(o.speed)
  script.speed = sp === null ? 1 : Math.round(Math.min(SCRIPT_LIMITS.speedMax, Math.max(SCRIPT_LIMITS.speedMin, sp)) * 100) / 100

  if (Array.isArray(o.emphasis)) {
    const seen = new Set<string>()
    for (const w of o.emphasis) {
      const c = cleanText(w, SCRIPT_LIMITS.emphasisWord)
      if ('ok' in c && !seen.has(c.ok)) {
        seen.add(c.ok)
        script.emphasis.push(c.ok)
      }
    }
    script.emphasis = script.emphasis.slice(0, SCRIPT_LIMITS.maxEmphasis)
  }

  if (d <= SCRIPT_LIMITS.shortVideoSec) {
    notes.push('영상이 짧아서(10초 이하) 훅·소제목·질문 없이 제목만 넣어요')
    return { script, notes }
  }

  // 훅: 구간은 1.5~4초(길면 4초로 줄임), 질문이 없거나 못 쓰면 훅 자체를 두지 않는다
  if (isObj(o.hook)) {
    const s = num(o.hook.sourceStart)
    const e = num(o.hook.sourceEnd)
    const q = cleanText(o.hook.question, SCRIPT_LIMITS.question)
    if (s === null || e === null || s < 0 || s >= d) notes.push('훅 장면이 영상 밖이라 훅을 뺐어요')
    else if ('why' in q) notes.push(`훅 질문을 쓸 수 없어서(${q.why}) 훅을 뺐어요`)
    else {
      const end = Math.min(e, d, s + SCRIPT_LIMITS.hookMaxSec)
      if (end - s < SCRIPT_LIMITS.hookMinSec) notes.push('훅 장면이 1.5초보다 짧아서 훅을 뺐어요')
      else script.hook = { sourceStart: round3(s), sourceEnd: round3(end), question: q.ok }
    }
  }

  if (Array.isArray(o.openingLines)) {
    for (const l of o.openingLines) {
      const c = cleanText(l, SCRIPT_LIMITS.opening)
      if ('ok' in c) script.openingLines.push(c.ok)
      else notes.push(`소개 줄을 뺐어요(${c.why})`)
    }
    script.openingLines = script.openingLines.slice(0, SCRIPT_LIMITS.maxOpening)
  }

  script.sections = timedList(o.sections, 'label', SCRIPT_LIMITS.maxSections, SCRIPT_LIMITS.section, d, '소제목', notes) as EditScript['sections']
  script.questions = timedList(o.questions, 'text', SCRIPT_LIMITS.maxQuestions, SCRIPT_LIMITS.question, d, '중간 질문', notes) as EditScript['questions']
  script.reactions = timedList(o.reactions, 'text', SCRIPT_LIMITS.maxReactions, SCRIPT_LIMITS.reaction, d, '리액션', notes) as EditScript['reactions']
  script.drop = normalizeDrop(o.drop, d, notes, ctx.maxOutputSec)
  return { script, notes }
}

const OPENING_COLORS = ['yellow', 'cyan', 'white'] as const

/** 원본 시각 기준 대본을 출력 시각 기준 그림 대본으로 바꾼다. 잘려 나간 자리는 다음 남은 구간 시작에 붙이고, 영상 밖이면 뺀다. */
export function toRenderScript(sc: EditScript, kept: Span[], hookSec: number, totalSec: number): RenderScript {
  const at = (t: number) => srcToOut(t, kept, hookSec)
  const secs = sc.sections.flatMap((s) => {
    const start = at(s.atSec)
    return start === null ? [] : [{ start, label: s.label }]
  })
  return {
    title: sc.title,
    ...(sc.hook && hookSec > 0 ? { hook: { sec: hookSec, question: sc.hook.question } } : {}),
    openingLines: sc.openingLines.slice(0, 3).map((text, k) => ({ text, color: OPENING_COLORS[k]! })),
    sections: secs.map((s, k) => ({ start: s.start, end: secs[k + 1]?.start ?? totalSec, label: s.label })),
    questions: sc.questions.flatMap((q) => {
      const start = at(q.atSec)
      return start === null ? [] : [{ start, text: q.text }]
    }),
    reactions: sc.reactions.flatMap((r) => {
      const start = at(r.atSec)
      return start === null ? [] : [{ start, text: r.text }]
    }),
    emphasis: sc.emphasis,
    hookSec,
  }
}

/** 계획 카드(승인 화면)에 보여 줄 편집 구성 줄들. */
export function scriptCardLines(sc: EditScript): string[] {
  const lines: string[] = []
  if (sc.hook) {
    const len = sc.hook.sourceEnd - sc.hook.sourceStart
    lines.push(`• 후킹: 원본 ${sc.hook.sourceStart.toFixed(1)}초부터 ${len.toFixed(1)}초 장면을 맨 앞에 두고 "${sc.hook.question}" 질문을 띄워요`)
  }
  lines.push(`• 제목: "${sc.title}"을(를) 화면 위에 고정해요`)
  if (sc.openingLines.length) lines.push(`• 소개 줄: ${sc.openingLines.join(' / ')}`)
  if (sc.sections.length) lines.push(`• 소제목: ${sc.sections.map((s) => s.label).join(' → ')}`)
  if (sc.questions.length || sc.reactions.length) lines.push(`• 중간 질문 ${sc.questions.length}개, 리액션 ${sc.reactions.length}개를 넣어요`)
  if (sc.speed > 1.001) lines.push(`• 속도: ${sc.speed}배로 올려 템포를 살려요`)
  if (sc.drop.length) lines.push(`• 빼는 구간: ${sc.drop.length}곳(약 ${Math.round(sc.drop.reduce((a, d) => a + d.end - d.start, 0))}초)`)
  return lines
}

/** 사용자가 승인 화면에서 고친 문구(제목·훅 질문·소개 줄)를 대본에 덮어쓴다. 상한을 넘는 값은 정리 규칙에 따라 빠진다. */
export function applyScriptEdits(script: EditScript, edits: ScriptEdits | null | undefined, ctx: ScriptContext): EditScript {
  if (!edits || (edits.title === undefined && edits.hookQuestion === undefined && edits.openingLines === undefined)) return script
  return normalizeScript(
    {
      ...script,
      title: edits.title ?? script.title,
      hook: script.hook ? { ...script.hook, question: edits.hookQuestion ?? script.hook.question } : undefined,
      openingLines: edits.openingLines ?? script.openingLines,
    },
    ctx,
  ).script
}
