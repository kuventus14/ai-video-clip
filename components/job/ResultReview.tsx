'use client'

import { CircleCheck, Download, Film, Pencil } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { JobDto } from '../../src/shared/types.ts'
import { confirm, otherVersion, plan } from '../../src/ui/api.ts'
import { atDate, formatDuration, formatKoreanDate, purposeLabel, shownPurpose } from '../../src/ui/format.ts'
import { downloadName, mergeRequest, oppositePurpose, verdictOf } from '../../src/ui/report.ts'
import { Badge } from '../ui/Badge.tsx'
import { Button, buttonClass } from '../ui/Button.tsx'
import { Card } from '../ui/Card.tsx'
import { Field, Textarea } from '../ui/Field.tsx'
import { ReportPanel } from './ReportPanel.tsx'

function Player({ job }: { job: JobDto }) {
  const landscape = job.resultInfo ? job.resultInfo.width >= job.resultInfo.height : shownPurpose(job) === 'post'
  return (
    <div className="flex items-center justify-center overflow-hidden rounded-panel bg-shell">
      {job.media.result ? (
        <video
          src={job.media.result}
          poster={job.media.thumb}
          controls
          preload="metadata"
          aria-label="완성된 영상"
          style={job.resultInfo ? { aspectRatio: `${job.resultInfo.width} / ${job.resultInfo.height}` } : undefined}
          className={landscape ? 'max-h-[70vh] w-full' : 'h-[min(70vh,640px)] max-w-full'}
        />
      ) : (
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 text-shell-ink-2">
          <Film size={32} strokeWidth={1.5} aria-hidden="true" />
          <p className="text-[15px]">결과 영상 파일을 찾을 수 없어요</p>
        </div>
      )}
    </div>
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
export function ResultReview({ job, onChanged }: { job: JobDto; onChanged: (next: JobDto) => void }) {
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
        <p role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-panel border border-line bg-ok-soft px-4 py-3 text-[15px] text-ok">
          <span className="inline-flex items-center gap-2 font-semibold">
            <CircleCheck size={20} strokeWidth={1.75} aria-hidden="true" />
            저장됐어요
          </span>
          <span>{job.confirmedAt ? `${atDate(formatKoreanDate(job.confirmedAt))} 확정했어요. ` : ''}기록에서 언제든 다시 볼 수 있어요.</span>
          <Link href="/" className="font-semibold underline underline-offset-2">
            기록으로 가기
          </Link>
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Player job={job} />

        <aside className="flex flex-col gap-4">
          <Card>
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={verdict.tone}>{verdict.text}</Badge>
                {purpose ? <Badge>{purposeLabel(purpose)}</Badge> : null}
              </div>
              {job.resultInfo ? (
                <p className="text-[15px] tabular-nums text-ink-2">
                  {formatDuration(job.resultInfo.durationSec)} · {job.resultInfo.width}×{job.resultInfo.height}
                </p>
              ) : null}
              <p className="text-[13px] text-ink-3">{confirmed ? '확정한 영상이에요.' : '영상을 보고 아래 검수 리포트도 확인한 뒤 확정해 주세요.'}</p>
            </div>
          </Card>

          <Card>
            <div className="flex flex-col gap-3">
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
          </Card>
        </aside>
      </div>

      {revising && !confirmed ? (
        <Card title="수정 요청" description="고치고 싶은 점을 적어 주세요. 이전 요청에 덧붙여 계획을 다시 만들고, 승인하면 다시 만들어요.">
          <div className="flex flex-col gap-3">
            {job.requestText ? <p className="rounded-control bg-sunken px-3 py-2 text-[13px] text-ink-2">이전 요청: {job.requestText}</p> : null}
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
