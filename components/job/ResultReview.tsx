'use client'

import { Captions, Download, Film, Pencil } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import type { JobDto } from '../../src/shared/types.ts'
import { confirm, otherVersion, plan } from '../../src/ui/api.ts'
import { atDate, formatDuration, formatKoreanDate, purposeLabel, shownPurpose } from '../../src/ui/format.ts'
import { downloadName, mergeRequest, oppositePurpose, verdictOf } from '../../src/ui/report.ts'
import { Badge } from '../ui/Badge.tsx'
import { Button, buttonClass } from '../ui/Button.tsx'
import { Card } from '../ui/Card.tsx'
import { cx } from '../ui/cx.ts'
import { Field, Textarea } from '../ui/Field.tsx'
import { ReportPanel } from './ReportPanel.tsx'
import { SoundAdjust } from './SoundAdjust.tsx'

const SEVERITY_DOT = { high: 'bg-bad', medium: 'bg-warn', info: 'bg-info' } as const
const SEVERITY_WORD = { high: '중요', medium: '확인', info: '참고' } as const

/**
 * 결과 플레이어 무대. 영상의 장면이 뒤에서 은은하게 번지는 조명(앰비언트)이 되고, 영상은 원래 비율 그대로 가운데에 선다.
 * 영상 아래 타임라인에는 지금 재생 위치(재생헤드)와, 검수가 시간을 짚은 항목의 마커가 있다 — 마커를 누르면 그 시각으로 이동한다.
 */
function Player({ job }: { job: JobDto }) {
  const video = useRef<HTMLVideoElement>(null)
  const [now, setNow] = useState(0)
  const info = job.resultInfo
  const landscape = info ? info.width >= info.height : shownPurpose(job) === 'post'
  const duration = info?.durationSec ?? 0
  const markers = duration > 0 ? (job.report?.findings ?? []).filter((f) => f.atSec !== undefined && f.id !== 'caption-suggestion') : []

  if (!job.media.result) {
    return (
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-panel bg-stage text-ink-3">
        <Film size={32} strokeWidth={1.5} aria-hidden="true" />
        <p className="text-[15px]">결과 영상 파일을 찾을 수 없어요</p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-panel bg-stage">
      <div className="relative flex items-center justify-center overflow-hidden py-6 sm:py-8">
        {job.media.thumb ? <img src={job.media.thumb} alt="" aria-hidden="true" className="pointer-events-none absolute inset-0 size-full scale-125 object-cover opacity-45 blur-[60px] saturate-150" /> : null}
        <video
          ref={video}
          src={job.media.result}
          poster={job.media.thumb}
          controls
          preload="metadata"
          aria-label="완성된 영상"
          onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
          style={info ? { aspectRatio: `${info.width} / ${info.height}` } : undefined}
          className={cx('relative z-[1] rounded-[12px] bg-stage shadow-[0_20px_60px_rgb(0_0_0/0.6)]', landscape ? 'max-h-[70vh] w-[min(100%,calc(100%-3rem))]' : 'h-[min(70vh,640px)] max-w-[calc(100%-3rem)]')}
        />
      </div>

      {duration > 0 ? (
        <div className="px-6 pb-5 pt-1">
          <div className="relative h-10">
            <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-lift" />
            <div className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-accent" style={{ width: `${Math.min(100, (now / duration) * 100)}%` }} />
            <span aria-hidden="true" className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_12px_2px_rgb(255_178_36/0.55)]" style={{ left: `${Math.min(100, (now / duration) * 100)}%` }} />
            {markers.map((f, i) => (
              <button
                key={`${f.id}-${i}`}
                type="button"
                onClick={() => {
                  if (video.current) {
                    video.current.currentTime = f.atSec ?? 0
                    void video.current.play().catch(() => {})
                  }
                }}
                className="group absolute top-1/2 z-[1] grid size-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full outline-offset-2"
                style={{ left: `${Math.min(100, ((f.atSec ?? 0) / duration) * 100)}%` }}
                aria-label={`${formatDuration(f.atSec ?? 0)} ${SEVERITY_WORD[f.severity]}: ${f.message} (눌러서 그 시각으로 이동)`}
              >
                <span className={cx('size-3 rounded-full ring-2 ring-stage transition-transform duration-200 group-hover:scale-150', SEVERITY_DOT[f.severity])} />
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between text-[12px] text-ink-3 tnum">
            <span>{formatDuration(now)}</span>
            {markers.length > 0 ? <span>검수가 짚은 {markers.length}곳 — 점을 눌러 확인</span> : null}
            <span>{formatDuration(duration)}</span>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** 확정: 클래퍼보드가 "딱" 하고 닫힌다 */
function Clapper() {
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden="true" className="shrink-0 overflow-visible">
      <rect x="6" y="18" width="32" height="20" rx="3.5" fill="var(--lift)" stroke="var(--ok)" strokeWidth="2" />
      <path d="M12 26h20M12 32h12" stroke="var(--ok)" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
      <g style={{ transformOrigin: '6px 18px', animation: 'clap-stick 1.2s var(--ease-expo) both' }}>
        <rect x="6" y="8" width="32" height="8" rx="2.5" fill="var(--ok-soft)" stroke="var(--ok)" strokeWidth="2" />
        <path d="M13 8l-4 8M22 8l-4 8M31 8l-4 8" stroke="var(--ok)" strokeWidth="2" />
      </g>
      <circle cx="22" cy="24" r="24" fill="var(--ok)" opacity="0" style={{ animation: 'clap-flash 1.2s ease-out both' }} />
    </svg>
  )
}

/** 다음에 올릴 곳 — 이 버전에서는 자리만 있고 눌러지지 않는다 */
function UploadSlot() {
  const targets = ['유튜브에 올리기', '유튜브 쇼츠에 올리기', '인스타그램 릴스에 올리기', '네이버 클립에 올리기']
  return (
    <Card title="올리기" description="업로드는 다음 단계에서 붙어요. 지금은 ‘영상 내려받기’로 파일을 받아 직접 올려 주세요.">
      <div className="flex flex-wrap gap-2">
        {targets.map((t) => (
          <Button key={t} size="sm" disabled>
            {t}
          </Button>
        ))}
      </div>
    </Card>
  )
}

/**
 * 결과 확인 화면(awaiting_confirm)과 확정한 뒤의 모습(confirmed). 영상이 먼저이고 검수 리포트가 이어진다.
 * 확정하면 기록에 저장되고, 수정 요청은 이전 요청에 덧붙여 계획을 다시 만들고, 다른 버전은 반대 용도로 새 작업을 만든다.
 */
export function ResultReview({ job, onChanged, onEditCaptions }: { job: JobDto; onChanged: (next: JobDto) => void; onEditCaptions?: () => void }) {
  const router = useRouter()
  const confirmed = job.status === 'confirmed'
  const verdict = verdictOf(job.report)
  const purpose = shownPurpose(job)
  const other = purpose ? oppositePurpose(purpose) : null

  const [busy, setBusy] = useState<'confirm' | 'revise' | 'other' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [revising, setRevising] = useState(false)
  const [revision, setRevision] = useState('')

  async function run(kind: 'confirm' | 'revise' | 'other', call: () => Promise<JobDto>, then: (r: JobDto) => void) {
    setBusy(kind)
    setError(null)
    try {
      then(await call())
      setBusy(null) // 확정처럼 같은 화면에 남는 동작은 버튼을 다시 쓸 수 있어야 한다
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {confirmed ? (
        <p role="status" className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-panel bg-ok-soft px-6 py-4 text-[15px] text-ok">
          <Clapper />
          <span className="text-[19px] font-bold tracking-[-0.02em]">저장됐어요</span>
          <span className="text-ok/80">{job.confirmedAt ? `${atDate(formatKoreanDate(job.confirmedAt))} 확정했어요. ` : ''}기록에서 언제든 다시 볼 수 있어요.</span>
          <Link href="/" className="font-semibold underline underline-offset-4">
            기록으로 가기
          </Link>
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Player job={job} />
          {confirmed || !job.soundAdjust ? null : <SoundAdjust job={job} onChanged={onChanged} />}
        </div>

        <aside className="flex flex-col gap-4">
          <div className="rounded-panel bg-panel p-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={verdict.tone}>{verdict.text}</Badge>
              {purpose ? <Badge>{purposeLabel(purpose)}</Badge> : null}
            </div>
            {job.resultInfo ? (
              <p className="mt-4 text-[32px] font-bold leading-none tracking-[-0.03em] text-ink tnum">
                {formatDuration(job.resultInfo.durationSec)}
                <span className="ml-2 text-[14px] font-medium tracking-normal text-ink-3">
                  {job.resultInfo.width}×{job.resultInfo.height}
                </span>
              </p>
            ) : null}
            <p className="mt-3 text-[13px] leading-relaxed text-ink-3">{confirmed ? '확정한 영상이에요.' : '영상을 보고 아래 검수 리포트도 확인한 뒤 확정해 주세요.'}</p>
          </div>

          <div className="flex flex-col gap-3 rounded-panel bg-panel p-5">
            {confirmed ? null : (
              <Button variant="primary" loading={busy === 'confirm'} disabled={busy !== null && busy !== 'confirm'} onClick={() => run('confirm', () => confirm(job.id), onChanged)}>
                확정하기
              </Button>
            )}
            {confirmed || revising ? null : (
              <Button disabled={busy !== null} onClick={() => setRevising(true)} icon={<Pencil size={16} strokeWidth={1.75} aria-hidden="true" />}>
                수정 요청
              </Button>
            )}
            {confirmed || !onEditCaptions ? null : (
              <Button disabled={busy !== null} onClick={onEditCaptions} icon={<Captions size={16} strokeWidth={1.75} aria-hidden="true" />}>
                자막 고치기
              </Button>
            )}
            {other ? (
              <Button disabled={busy !== null && busy !== 'other'} loading={busy === 'other'} onClick={() => run('other', () => otherVersion(job.id), (child) => router.push(`/jobs/${child.id}`))}>
                다른 버전도 만들기 — {purposeLabel(other)}
              </Button>
            ) : null}
            {job.media.result ? (
              <a href={job.media.result} download={downloadName(job)} className={buttonClass('ghost')}>
                <Download size={16} strokeWidth={1.75} aria-hidden="true" />
                영상 내려받기
              </a>
            ) : null}
            {error ? (
              <p role="alert" className="text-[13px] font-medium text-bad">
                {error}
              </p>
            ) : null}
          </div>
        </aside>
      </div>

      {revising && !confirmed ? (
        <Card title="수정 요청" description="고치고 싶은 점을 적어 주세요. 이전 요청에 덧붙여 계획을 다시 만들고, 승인하면 다시 만들어요.">
          <div className="flex flex-col gap-4">
            {job.requestText ? <p className="rounded-control bg-raised px-4 py-3 text-[13px] text-ink-2">이전 요청: {job.requestText}</p> : null}
            <Field label="고치고 싶은 점">
              {(p) => <Textarea {...p} value={revision} onChange={(e) => setRevision(e.target.value)} maxLength={3000} placeholder="예: 자막을 더 크게, 첫 컷은 조금 더 짧게" />}
            </Field>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" disabled={busy !== null} onClick={() => setRevising(false)}>
                접기
              </Button>
              <Button variant="primary" disabled={!revision.trim()} loading={busy === 'revise'} onClick={() => run('revise', () => plan(job.id, { request: mergeRequest(job.requestText, revision) }), onChanged)}>
                계획 다시 만들기
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {confirmed ? <UploadSlot /> : null}

      <ReportPanel report={job.report} />
    </div>
  )
}
