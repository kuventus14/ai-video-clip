'use client'

import { TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import type { JobDto } from '../../src/shared/types.ts'
import { approve, plan } from '../../src/ui/api.ts'
import { parsePlanCard } from '../../src/ui/plan.ts'
import { ActionBar } from '../ui/ActionBar.tsx'
import { Button } from '../ui/Button.tsx'
import { Card } from '../ui/Card.tsx'
import { Field, Textarea } from '../ui/Field.tsx'
import { Segmented } from '../ui/Segmented.tsx'
import { Switch } from '../ui/Switch.tsx'
import { PurposeChooser, type PurposeChoice } from './PurposeChooser.tsx'

type Quality = JobDto['quality']

/**
 * "이렇게 이해했어요" 승인 화면. AI 가 이해한 편집 계획을 보여 주고, 용도·자막·화질을 정한 뒤 승인하면 제작을 시작한다.
 * 마음에 안 들면 요청을 고치거나(요청 고치기) 레퍼런스를 바꿔(onEditReference) 계획을 다시 만든다.
 */
export function PlanApproval({ job, onChanged, onEditReference }: { job: JobDto; onChanged: (next: JobDto) => void; onEditReference?: () => void }) {
  const card = parsePlanCard(job.planCard ?? [])
  const [choice, setChoice] = useState<PurposeChoice>(job.purposeChoice)
  const [captionsOn, setCaptionsOn] = useState(job.captionsMode !== 'off')
  const [quality, setQuality] = useState<Quality>(job.quality)
  const [editingRequest, setEditingRequest] = useState(false)
  const [request, setRequest] = useState(job.requestText)
  const [busy, setBusy] = useState<'approve' | 'replan' | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 용도를 바꾸면 계획이 달라지므로, 바꾼 채로는 승인할 수 없고 계획을 다시 만들어야 한다
  const purposeChanged = choice !== job.purposeChoice

  async function run(kind: 'approve' | 'replan', call: () => Promise<JobDto>) {
    setBusy(kind)
    setError(null)
    try {
      onChanged(await call())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(null)
    }
  }

  const warnCount = card.items.filter((i) => i.tone === 'warn').length

  return (
    <div className="flex flex-col gap-6">
      <Card title="이렇게 이해했어요" description="맞는지 확인하고 승인하면 만들기 시작해요.">
        <div className="flex flex-col gap-4">
          {card.headline ? <p className="text-[17px] font-semibold leading-snug text-ink">{card.headline}</p> : null}
          {card.items.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {card.items.map((item, i) =>
                item.tone === 'warn' ? (
                  <li key={i} className="flex items-start gap-2 rounded-control bg-warn-soft px-3 py-2 text-[15px] text-warn">
                    <TriangleAlert size={18} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 break-words">{item.text}</span>
                  </li>
                ) : (
                  <li key={i} className="flex items-start gap-2 px-3 py-1 text-[15px] text-ink">
                    <span aria-hidden="true" className="mt-[0.65em] size-1.5 shrink-0 rounded-full bg-ink-3" />
                    <span className="min-w-0 break-words">{item.text}</span>
                  </li>
                ),
              )}
            </ul>
          ) : !card.headline ? (
            <p className="text-[15px] text-ink-2">계획 내용을 불러오지 못했어요. 요청을 고쳐 다시 만들어 보세요.</p>
          ) : null}
          {warnCount > 0 ? <p className="text-[13px] text-ink-3">노란색 줄은 이번 버전에서 반영되지 않는 부분이에요. 나머지는 그대로 만들어요.</p> : null}
        </div>
      </Card>

      <Card title="만들기 설정">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <PurposeChooser value={choice} onChange={setChoice} guess={job.purposeGuess} disabled={busy !== null} />
            {purposeChanged ? (
              <div className="flex flex-wrap items-center gap-3 rounded-control bg-accent-soft px-3 py-2.5">
                <p className="min-w-0 flex-1 text-[13px] text-accent-ink">용도를 바꾸면 계획을 다시 만들어야 해요.</p>
                <Button size="sm" variant="primary" loading={busy === 'replan'} disabled={busy === 'approve'} onClick={() => run('replan', () => plan(job.id, { purposeChoice: choice }))}>
                  이 용도로 계획 다시 만들기
                </Button>
              </div>
            ) : null}
          </div>

          <Switch checked={captionsOn} onChange={setCaptionsOn} label="자막 넣기" description="영상에 이미 자막이 들어 있다면 끄세요. 두 줄로 겹쳐 보일 수 있어요." />

          <details className="group">
            <summary className="cursor-pointer rounded-chip py-1 text-[15px] font-medium text-ink">고급 설정</summary>
            <div className="mt-3 flex flex-col gap-2">
              <Segmented
                legend="화질"
                value={quality}
                onChange={setQuality}
                options={[
                  { value: 'draft', label: '초안', hint: '빨리 확인용' },
                  { value: 'looks', label: '보통', hint: '기본' },
                  { value: 'delivery', label: '최종', hint: '가장 선명' },
                ]}
              />
              <p className="text-[13px] text-ink-3">화질이 높을수록 만드는 데 오래 걸려요. 검수에서 화질 문제가 나오면 자동으로 한 단계 올려 다시 만들어요.</p>
            </div>
          </details>
        </div>
      </Card>

      {editingRequest ? (
        <Card title="요청 고치기" description="레퍼런스에서 참고할 부분이나 바라는 점을 고쳐 쓰면 계획을 다시 만들어요.">
          <div className="flex flex-col gap-3">
            <Field label="요청" optional>
              {(p) => <Textarea {...p} value={request} onChange={(e) => setRequest(e.target.value)} maxLength={4000} placeholder="예: 자막은 크게, 컷은 지금보다 빠르게" />}
            </Field>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" disabled={busy !== null} onClick={() => setEditingRequest(false)}>
                접기
              </Button>
              <Button variant="primary" loading={busy === 'replan'} disabled={busy === 'approve'} onClick={() => run('replan', () => plan(job.id, { request: request.trim() }))}>
                고쳐서 계획 다시 만들기
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      <ActionBar error={error} hint={purposeChanged ? '용도를 바꿨어요. 계획을 다시 만든 뒤 승인할 수 있어요' : undefined}>
        {!editingRequest ? (
          <Button variant="ghost" disabled={busy !== null} onClick={() => setEditingRequest(true)}>
            요청 고치기
          </Button>
        ) : null}
        {onEditReference ? (
          <Button disabled={busy !== null} onClick={onEditReference}>
            레퍼런스 바꾸기
          </Button>
        ) : null}
        <Button variant="primary" loading={busy === 'approve'} disabled={purposeChanged || busy === 'replan'} onClick={() => run('approve', () => approve(job.id, { captions: captionsOn ? 'auto' : 'off', quality }))}>
          승인하고 만들기
        </Button>
      </ActionBar>
    </div>
  )
}
