'use client'

import { Check, ExternalLink, Film } from 'lucide-react'
import { useRef, useState } from 'react'
import type { JobDto, Recommendation } from '../../src/shared/types.ts'
import { plan } from '../../src/ui/api.ts'
import { formatDuration, formatViews } from '../../src/ui/format.ts'
import { BAD_LINK_MESSAGE, checkLink, initialReference } from '../../src/ui/reference.ts'
import { ActionBar } from '../ui/ActionBar.tsx'
import { Button } from '../ui/Button.tsx'
import { Card } from '../ui/Card.tsx'
import { cx } from '../ui/cx.ts'
import { Field, Textarea } from '../ui/Field.tsx'
import { PurposeChooser, type PurposeChoice } from './PurposeChooser.tsx'
import { ReferenceInput } from './ReferenceInput.tsx'

function RecommendationCard({ rec, selected, onToggle }: { rec: Recommendation; selected: boolean; onToggle: () => void }) {
  const [broken, setBroken] = useState(false)
  const views = rec.viewCount === null ? formatViews(null) : `조회수 ${formatViews(rec.viewCount)}`
  return (
    <li
      className={cx(
        'relative flex flex-col overflow-hidden rounded-panel border bg-panel transition-colors duration-150',
        selected ? 'border-accent ring-2 ring-accent' : 'border-line hover:bg-sunken/60',
        'has-[button:focus-visible]:outline-2 has-[button:focus-visible]:outline-offset-2 has-[button:focus-visible]:outline-ring',
      )}
    >
      <div className="relative aspect-video overflow-hidden bg-shell">
        {rec.thumbnail && !broken ? (
          // 유튜브 썸네일은 다른 사이트에서 오므로 이 컴퓨터의 주소를 넘기지 않는다. 못 불러오면(오프라인 등) 자리 표시로 바꾼다.
          <img src={rec.thumbnail} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-shell-ink-2">
            <Film size={24} strokeWidth={1.5} aria-hidden="true" />
          </div>
        )}
        {rec.durationSec ? <span className="absolute bottom-1.5 right-1.5 rounded-chip bg-black/75 px-1.5 py-0.5 text-[12px] font-medium leading-none tabular-nums text-white">{formatDuration(rec.durationSec)}</span> : null}
        {selected ? (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-chip bg-accent px-2 py-1 text-[12px] font-medium leading-none text-white">
            <Check size={14} strokeWidth={2} aria-hidden="true" />
            선택함
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <button type="button" aria-pressed={selected} onClick={onToggle} className="line-clamp-2 text-left text-[15px] font-medium leading-snug text-ink outline-none after:absolute after:inset-0 after:content-['']">
          {rec.title}
        </button>
        <p className="text-[13px] text-ink-2">
          {rec.channel ? `${rec.channel} · ` : ''}
          <span className="tabular-nums">{views}</span>
        </p>
        <a href={rec.url} target="_blank" rel="noopener noreferrer" className="relative z-10 mt-auto inline-flex w-fit items-center gap-1 rounded-chip py-1 text-[13px] font-medium text-accent-ink underline-offset-2 hover:underline">
          유튜브에서 보기
          <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
          <span className="sr-only">(새 탭)</span>
        </a>
      </div>
    </li>
  )
}

/**
 * 레퍼런스를 고르고(추천 카드 · 링크 · 파일), 무엇을 참고할지 자연어로 말하고, 용도를 정해 계획을 요청한다.
 * 아무것도 안 골라도 "레퍼런스 없이 계속" 할 수 있다. onCancel 이 있으면 이미 계획이 있는 작업에서 열린 것이라 취소할 수 있다.
 */
export function ReferencePicker({ job, onChanged, onCancel }: { job: JobDto; onChanged: (next: JobDto) => void; onCancel?: () => void }) {
  const initial = initialReference(job.referenceSource, job.hasUploadedReference, job.recommendations)
  const [recId, setRecId] = useState<string | null>(initial.recId)
  const [link, setLink] = useState(initial.link)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(initial.fileName)
  const [fileBusy, setFileBusy] = useState(false)
  const [request, setRequest] = useState(job.requestText)
  const [choice, setChoice] = useState<PurposeChoice>(job.purposeChoice)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const linkInput = useRef<HTMLInputElement>(null)

  const picked = job.recommendations.find((r) => r.id === recId)
  const checked = checkLink(link)
  const hasReference = !!fileName || !!picked || checked.kind !== 'empty'

  async function onContinue() {
    if (!fileName && !picked && checked.kind === 'bad') {
      setLinkError(BAD_LINK_MESSAGE)
      linkInput.current?.focus()
      linkInput.current?.scrollIntoView({ block: 'center' })
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const reference = fileName ? 'uploaded' : (picked?.url ?? (checked.kind === 'ok' ? checked.url : null))
      onChanged(await plan(job.id, { reference, request: request.trim(), purposeChoice: choice }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {job.summary ? (
        <Card>
          <p className="text-[13px] text-ink-3">이런 영상으로 이해했어요</p>
          <p className="mt-1 text-[17px] font-semibold leading-snug text-ink">
            {job.summary.genre} — {job.summary.oneLine}
          </p>
          <p className="mt-2 text-[13px] text-ink-3">다르게 이해했다면 ‘새 영상’에서 설명을 더 자세히 적어 다시 올려 주세요. 편집에서 바라는 점은 아래 ‘참고 요청’에 적어도 돼요.</p>
        </Card>
      ) : null}

      <Card title="레퍼런스" description="따라 하고 싶은 영상을 골라 주세요. 하나만 고르면 돼요. 없이도 만들 수 있어요.">
        <div className="flex flex-col gap-6">
          {job.recommendations.length > 0 ? (
            <section aria-labelledby="rec-title">
              <h3 id="rec-title" className="mb-3 text-[15px] font-semibold text-ink">
                추천 영상 <span className="text-[13px] font-normal tabular-nums text-ink-3">{job.recommendations.length}</span>
              </h3>
              <ul className="grid grid-cols-2 gap-3 xl:grid-cols-3">
                {job.recommendations.map((rec) => (
                  <RecommendationCard
                    key={rec.id}
                    rec={rec}
                    selected={rec.id === recId}
                    onToggle={() => {
                      const next = rec.id === recId ? null : rec.id
                      setRecId(next)
                      if (next) {
                        setLink('')
                        setLinkError(null)
                        setFileName(null)
                      }
                    }}
                  />
                ))}
              </ul>
            </section>
          ) : (
            <p className="rounded-control bg-sunken px-4 py-3 text-[15px] text-ink-2">추천을 불러오지 못했어요. 링크나 파일로 직접 골라 주세요.</p>
          )}

          <section aria-labelledby="direct-title">
            <h3 id="direct-title" className="mb-3 text-[15px] font-semibold text-ink">
              직접 넣기
            </h3>
            <ReferenceInput
              jobId={job.id}
              link={link}
              onLinkChange={(v) => {
                setLink(v)
                setLinkError(null)
                if (v.trim()) setRecId(null)
              }}
              linkError={linkError}
              linkRef={linkInput}
              fileName={fileName}
              onFileChange={(name) => {
                setFileName(name)
                if (name) {
                  setRecId(null)
                  setLink('')
                  setLinkError(null)
                }
              }}
              onBusyChange={setFileBusy}
            />
          </section>
        </div>
      </Card>

      <Card title="참고 요청" description="레퍼런스에서 어떤 부분을 참고했으면 하나요? 비우면 AI가 알아서 해요.">
        <Field label="요청" optional>
          {(p) => <Textarea {...p} value={request} onChange={(e) => setRequest(e.target.value)} maxLength={4000} placeholder="예: 첫 3초 제목 카드와 자막 스타일은 따라 하고, 컷 속도는 지금처럼 해 주세요." />}
        </Field>
      </Card>

      <Card title="용도" description="직접 고른 값이 항상 우선이에요.">
        <PurposeChooser value={choice} onChange={setChoice} guess={job.purposeGuess} />
      </Card>

      <ActionBar error={error} hint={fileBusy ? '레퍼런스 파일을 올리는 중이에요' : hasReference ? undefined : '레퍼런스를 고르지 않았어요'}>
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel} disabled={submitting}>
            취소
          </Button>
        ) : null}
        <Button variant="primary" disabled={fileBusy} loading={submitting} onClick={onContinue}>
          {hasReference ? '이 레퍼런스로 계속' : '레퍼런스 없이 계속'}
        </Button>
      </ActionBar>
    </div>
  )
}
