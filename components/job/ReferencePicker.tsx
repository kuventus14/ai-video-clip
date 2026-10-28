'use client'

import { Check, ExternalLink, Film } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { CaptionReviewDto, JobDto, Recommendation } from '../../src/shared/types.ts'
import { getCaptions, plan } from '../../src/ui/api.ts'
import { isDirty, lineProblems, trackPayload, type Lines } from '../../src/ui/captionTrack.ts'
import { formatDuration, formatViews, sourceFrame } from '../../src/ui/format.ts'
import { BAD_LINK_MESSAGE, checkLink, initialReference } from '../../src/ui/reference.ts'
import { ActionBar } from '../ui/ActionBar.tsx'
import { Button } from '../ui/Button.tsx'
import { Card } from '../ui/Card.tsx'
import { cx } from '../ui/cx.ts'
import { Field, Textarea } from '../ui/Field.tsx'
import { CaptionReview } from './CaptionReview.tsx'
import { PurposeChooser, type PurposeChoice } from './PurposeChooser.tsx'
import { ReferenceInput } from './ReferenceInput.tsx'

function RecommendationCard({ rec, selected, onToggle }: { rec: Recommendation; selected: boolean; onToggle: () => void }) {
  const [broken, setBroken] = useState(false)
  const views = rec.viewCount === null ? formatViews(null) : `조회수 ${formatViews(rec.viewCount)}`
  return (
    <li
      className={cx(
        'group relative flex flex-col overflow-hidden rounded-[18px] transition-[background-color,box-shadow] duration-300 ease-[var(--ease-out)]',
        selected ? 'bg-lift shadow-[0_0_0_2px_var(--accent)]' : 'bg-raised hover:bg-lift',
        'has-[button:focus-visible]:outline-2 has-[button:focus-visible]:outline-offset-2 has-[button:focus-visible]:outline-ring',
      )}
    >
      <div className="relative aspect-video overflow-hidden bg-stage">
        {rec.thumbnail && !broken ? (
          // 유튜브 썸네일은 다른 사이트에서 오므로 이 컴퓨터의 주소를 넘기지 않는다. 못 불러오면(오프라인 등) 자리 표시로 바꾼다.
          <img src={rec.thumbnail} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="size-full object-cover transition-transform duration-[900ms] ease-[var(--ease-expo)] group-hover:scale-[1.05]" />
        ) : (
          <div className="flex size-full items-center justify-center text-shell-ink-2">
            <Film size={24} strokeWidth={1.5} aria-hidden="true" />
          </div>
        )}
        {rec.durationSec ? <span className="absolute bottom-1.5 right-1.5 rounded-chip bg-black/75 px-1.5 py-0.5 text-[12px] font-medium leading-none tabular-nums text-white">{formatDuration(rec.durationSec)}</span> : null}
        {selected ? (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1.5 text-[12px] font-semibold leading-none text-accent-deep">
            <Check size={14} strokeWidth={2} aria-hidden="true" />
            선택함
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <button type="button" aria-pressed={selected} onClick={onToggle} className="line-clamp-2 text-left text-[15px] font-semibold leading-snug tracking-[-0.01em] text-ink outline-none after:absolute after:inset-0 after:content-['']">
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
  // 자막 확인: 인식 결과는 화면이 열릴 때 한 번 불러온다. 못 불러와도(상태가 달라졌거나 파일이 없을 때) 레퍼런스 고르기는 그대로 된다.
  const [review, setReview] = useState<CaptionReviewDto | null>(null)
  const [lines, setLines] = useState<Lines>([])
  useEffect(() => {
    const ac = new AbortController()
    getCaptions(job.id, ac.signal)
      .then((r) => {
        setReview(r)
        setLines(r.lines)
      })
      .catch(() => {})
    return () => ac.abort()
  }, [job.id])
  const captionProblem = review ? lineProblems(lines, review.durationSec).some((p) => p !== null) : false
  // 저장하지 않은 자막 고침이 있으면 새로고침·창 닫기·뒤로 가기 전에 한 번 물어본다(긴 영상은 고칠 줄이 많다)
  const dirty = review ? isDirty(review.lines, lines) : false
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

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
      onChanged(await plan(job.id, { reference, request: request.trim(), purposeChoice: choice, ...(review ? trackPayload(review, lines) : {}) }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {job.summary ? (
        <section aria-label="영상 이해" className="rounded-panel bg-panel px-7 py-7">
          <p className="text-[13px] font-medium text-ink-3">이런 영상으로 이해했어요</p>
          <p className="mt-2 max-w-[44ch] text-[24px] font-bold leading-[1.3] tracking-[-0.025em] text-ink sm:text-[28px]">
            {job.summary.genre} — {job.summary.oneLine}
          </p>
          <p className="mt-4 max-w-[62ch] text-[14px] leading-relaxed text-ink-3">다르게 이해했다면 ‘새 영상’에서 설명을 더 자세히 적어 다시 올려 주세요. 편집에서 바라는 점은 아래 ‘참고 요청’에 적어도 돼요.</p>
        </section>
      ) : null}

      {review ? <CaptionReview review={review} lines={lines} onChange={setLines} videoSrc={job.media.source} disabled={submitting} /> : null}

      <Card title="레퍼런스" description="따라 하고 싶은 영상을 골라 주세요. 하나만 고르면 돼요. 없이도 만들 수 있어요.">
        <div className="flex flex-col gap-6">
          {job.recommendations.length > 0 ? (
            <section aria-labelledby="rec-title">
              <h3 id="rec-title" className="mb-4 text-[16px] font-semibold text-ink">
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
          ) : !hasReference ? (
            <p className="rounded-control bg-raised px-5 py-4 text-[15px] text-ink-2">추천을 불러오지 못했어요. 링크나 파일로 직접 골라 주세요.</p>
          ) : null}

          <section aria-labelledby="direct-title">
            <h3 id="direct-title" className="mb-4 text-[16px] font-semibold text-ink">
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
        <PurposeChooser value={choice} onChange={setChoice} guess={job.purposeGuess} source={sourceFrame(job)} />
      </Card>

      <ActionBar error={error} hint={captionProblem ? '자막이 너무 긴 줄이 있어요' : fileBusy ? '레퍼런스 파일을 올리는 중이에요' : hasReference ? undefined : '레퍼런스를 고르지 않았어요'}>
        {onCancel ? (
          <Button variant="ghost" onClick={() => (!dirty || window.confirm('고친 자막이 저장되지 않았어요. 취소할까요?')) && onCancel()} disabled={submitting}>
            취소
          </Button>
        ) : null}
        <Button variant="primary" disabled={fileBusy || captionProblem} loading={submitting} onClick={onContinue}>
          {hasReference ? '이 레퍼런스로 계속' : '레퍼런스 없이 계속'}
        </Button>
      </ActionBar>
    </div>
  )
}
