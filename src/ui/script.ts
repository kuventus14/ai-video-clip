import { cleanScriptText, SCRIPT_TEXT_LIMITS } from '../shared/scriptText.ts'
import type { ScriptDto, ScriptEdits } from '../shared/types.ts'

/** 승인 화면에서 고칠 수 있는 문구 입력칸 */
export interface ScriptForm {
  title: string
  hookQuestion: string
  openingLines: string[]
}

// 서버(cleanScriptText)와 같은 정리 방식: 연속 공백은 하나로, 앞뒤 공백은 지운다
const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

export function formFrom(script: ScriptDto): ScriptForm {
  return { title: script.title, hookQuestion: script.hookQuestion ?? '', openingLines: [...script.openingLines] }
}

/** 바뀐 칸만 담아 서버로 보낼 값을 만든다. 하나도 안 바뀌었으면 빈 객체. 훅이 없는 대본은 훅 질문을 보내지 않는다. */
export function scriptEditsFrom(original: ScriptDto, form: ScriptForm): ScriptEdits {
  const edits: ScriptEdits = {}
  const title = norm(form.title)
  if (title !== original.title) edits.title = title
  if (original.hookQuestion !== null) {
    const q = norm(form.hookQuestion)
    if (q !== original.hookQuestion) edits.hookQuestion = q
  }
  const lines = form.openingLines.map(norm).filter(Boolean)
  if (lines.length !== original.openingLines.length || lines.some((l, i) => l !== original.openingLines[i])) edits.openingLines = lines
  return edits
}

export interface ScriptProblems {
  title: string | null
  hookQuestion: string | null
  /** 입력칸 순서대로. 빈 소개 줄은 그 줄이 빠질 뿐이라 문제가 아니다 */
  openingLines: (string | null)[]
  /** 소개 줄이 너무 많을 때 */
  tooMany: string | null
}

/** 칸별 문구 문제(한국어). 입력칸 옆에 오류를 보여 줄 때 쓴다. */
export function scriptProblems(form: ScriptForm, original: ScriptDto): ScriptProblems {
  const why = (value: string, max: number) => {
    const r = cleanScriptText(value, max)
    return 'why' in r ? r.why : null
  }
  const filled = form.openingLines.filter((l) => norm(l)).length
  return {
    title: why(form.title, SCRIPT_TEXT_LIMITS.title),
    hookQuestion: original.hookQuestion !== null ? why(form.hookQuestion, SCRIPT_TEXT_LIMITS.question) : null,
    openingLines: form.openingLines.map((l) => (norm(l) ? why(l, SCRIPT_TEXT_LIMITS.opening) : null)),
    tooMany: filled > SCRIPT_TEXT_LIMITS.maxOpening ? `소개 줄은 ${SCRIPT_TEXT_LIMITS.maxOpening}개까지만 쓸 수 있어요` : null,
  }
}

/** 승인을 막는 문구 문제를 한 줄씩. 없으면 빈 목록. */
export function overLimit(form: ScriptForm, original: ScriptDto): string[] {
  const p = scriptProblems(form, original)
  const out: string[] = []
  if (p.title) out.push(`제목: ${p.title}`)
  if (p.hookQuestion) out.push(`훅 질문: ${p.hookQuestion}`)
  if (p.tooMany) out.push(p.tooMany)
  p.openingLines.forEach((w, i) => w && out.push(`소개 줄 ${i + 1}: ${w}`))
  return out
}
