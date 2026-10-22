'use client'

import { Plus } from 'lucide-react'
import { SCRIPT_TEXT_LIMITS } from '../../src/shared/scriptText.ts'
import type { ScriptDto } from '../../src/shared/types.ts'
import { scriptProblems, type ScriptForm } from '../../src/ui/script.ts'
import { Button } from '../ui/Button.tsx'
import { Card } from '../ui/Card.tsx'
import { Field, Input } from '../ui/Field.tsx'

const count = (s: string, max: number) => `${Array.from(s).length}/${max}자`

/** AI 가 짠 편집 구성을 보여 주고, 화면에 들어가는 문구(제목·훅 질문·소개 줄)를 승인 전에 고치게 한다. */
export function ScriptEditor({ script, form, onChange, disabled }: { script: ScriptDto; form: ScriptForm; onChange: (next: ScriptForm) => void; disabled?: boolean }) {
  const problems = scriptProblems(form, script)
  const facts: { label: string; value: string }[] = [
    { label: '훅', value: script.hookSec > 0 ? `${script.hookSec.toFixed(1)}초 장면을 맨 앞으로` : '쓰지 않아요' },
    { label: '소제목', value: script.sections.length ? script.sections.join(' → ') : '없어요' },
    { label: '질문·반응', value: `질문 ${script.questions}개 · 반응 ${script.reactions}개` },
    { label: '속도', value: script.speed > 1 ? `${script.speed}배속` : '그대로' },
  ]
  const setLine = (i: number, v: string) => onChange({ ...form, openingLines: form.openingLines.map((l, j) => (j === i ? v : l)) })

  return (
    <Card title="편집 구성" description="AI 가 영상과 레퍼런스를 보고 짠 구성이에요. 화면에 들어가는 문구는 여기서 고칠 수 있어요.">
      <div className="flex flex-col gap-6">
        <dl className="grid gap-2 sm:grid-cols-2">
          {facts.map((f) => (
            <div key={f.label} className="min-w-0 rounded-control bg-raised px-4 py-3">
              <dt className="text-[12px] font-medium text-ink-3">{f.label}</dt>
              <dd className="mt-0.5 break-words text-[14px] leading-relaxed text-ink">{f.value}</dd>
            </div>
          ))}
        </dl>

        <Field label="제목" hint={count(form.title, SCRIPT_TEXT_LIMITS.title)} error={problems.title}>
          {(p) => <Input {...p} value={form.title} disabled={disabled} onChange={(e) => onChange({ ...form, title: e.target.value })} />}
        </Field>

        {script.hookQuestion !== null ? (
          <Field label="훅 질문" hint={count(form.hookQuestion, SCRIPT_TEXT_LIMITS.question)} error={problems.hookQuestion}>
            {(p) => <Input {...p} value={form.hookQuestion} disabled={disabled} onChange={(e) => onChange({ ...form, hookQuestion: e.target.value })} />}
          </Field>
        ) : null}

        <div className="flex flex-col gap-4">
          {form.openingLines.map((line, i) => (
            <Field key={i} label={`소개 줄 ${i + 1}`} hint={count(line, SCRIPT_TEXT_LIMITS.opening)} error={problems.openingLines[i]}>
              {(p) => <Input {...p} value={line} disabled={disabled} placeholder="비워 두면 이 줄은 빠져요" onChange={(e) => setLine(i, e.target.value)} />}
            </Field>
          ))}
          {problems.tooMany ? (
            <p role="alert" className="text-[13px] font-medium text-bad">
              {problems.tooMany}
            </p>
          ) : null}
          {form.openingLines.length < SCRIPT_TEXT_LIMITS.maxOpening ? (
            <div>
              <Button size="sm" disabled={disabled} onClick={() => onChange({ ...form, openingLines: [...form.openingLines, ''] })}>
                <Plus size={16} strokeWidth={2} aria-hidden="true" />
                소개 줄 추가
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  )
}
