'use client'

import { CircleCheck, FileVideo, Paperclip, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { UNSUPPORTED_FORMAT_MESSAGE, VIDEO_EXTS, videoExtOf } from '../../src/shared/media.ts'
import type { JobDto } from '../../src/shared/types.ts'
import { ApiError, createJob, removeJob, start, uploadReferenceFile, uploadVideo } from '../../src/ui/api.ts'
import { formatBytes, formatDuration, purposeLabel } from '../../src/ui/format.ts'
import { useJob } from '../../src/ui/useJob.ts'
import { Button } from '../ui/Button.tsx'
import { Card } from '../ui/Card.tsx'
import { cx } from '../ui/cx.ts'
import { Field, Input, Textarea } from '../ui/Field.tsx'
import { Segmented } from '../ui/Segmented.tsx'
import { Spinner } from '../ui/Spinner.tsx'
import { Steps } from '../ui/Steps.tsx'
import { Dropzone } from './Dropzone.tsx'

type Choice = 'auto' | 'post' | 'short'

/** 자동 인식 확신이 이보다 낮으면 직접 골라 보라고 권한다 */
const LOW_CONFIDENCE = 0.65
/** 영상 확인(워커)이 이 시간 넘게 시작되지 않으면 처리 프로그램이 꺼져 있을 수 있다고 알려 준다 */
const WORKER_HINT_MS = 15_000

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function UploadForm() {
  const router = useRouter()

  // 영상
  const [file, setFile] = useState<{ name: string; size: number } | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploaded, setUploaded] = useState(false)
  const [fraction, setFraction] = useState(0)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const ctrlRef = useRef<AbortController | null>(null)
  const jobIdRef = useRef<string | null>(null)

  // 입력
  const [description, setDescription] = useState('')
  const [choice, setChoice] = useState<Choice>('auto')
  const [link, setLink] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [refFile, setRefFile] = useState<{ name: string } | null>(null)
  const [refFraction, setRefFraction] = useState<number | null>(null)
  const [refError, setRefError] = useState<string | null>(null)
  const refInput = useRef<HTMLInputElement>(null)
  const linkInput = useRef<HTMLInputElement>(null)

  // 시작
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const { job } = useJob(uploaded ? jobId : null)
  const ready = job?.status === 'ready'
  const probeFailed = job?.status === 'failed'
  const checking = uploaded && !ready && !probeFailed
  const waitingForWorker = checking && (job?.status === 'queued_probe' || job === null)

  // 영상 확인이 시작되지 않는 채로 오래 기다리면 안내한다
  const [workerHint, setWorkerHint] = useState(false)
  useEffect(() => {
    if (!waitingForWorker) {
      setWorkerHint(false)
      return
    }
    const t = setTimeout(() => setWorkerHint(true), WORKER_HINT_MS)
    return () => clearTimeout(t)
  }, [waitingForWorker])

  // 업로드 중에 페이지를 떠나면(다른 메뉴·닫기·새로고침) 올리다 만 작업을 지운다 — 목록에 "올리는 중" 이 남지 않게
  useEffect(() => {
    const abandon = () => {
      if (!ctrlRef.current || !jobIdRef.current) return
      ctrlRef.current.abort()
      void fetch(`/api/jobs/${jobIdRef.current}`, { method: 'DELETE', keepalive: true }).catch(() => {})
    }
    const stopBrowserOpeningDroppedFiles = (e: DragEvent) => e.preventDefault()
    window.addEventListener('pagehide', abandon)
    window.addEventListener('dragover', stopBrowserOpeningDroppedFiles)
    window.addEventListener('drop', stopBrowserOpeningDroppedFiles)
    return () => {
      window.removeEventListener('pagehide', abandon)
      window.removeEventListener('dragover', stopBrowserOpeningDroppedFiles)
      window.removeEventListener('drop', stopBrowserOpeningDroppedFiles)
      ctrlRef.current?.abort() // 앱 안에서 다른 화면으로 가는 경우
    }
  }, [])

  function resetVideo() {
    ctrlRef.current = null
    jobIdRef.current = null
    setFile(null)
    setJobId(null)
    setUploading(false)
    setUploaded(false)
    setFraction(0)
    setRefFile(null)
    setRefFraction(null)
    setRefError(null)
    setSubmitError(null)
  }

  async function pickFile(picked: File) {
    if (uploading) return
    if (!videoExtOf(picked.name)) {
      setUploadError(`${UNSUPPORTED_FORMAT_MESSAGE}. 다른 파일을 골라 주세요.`)
      return
    }
    resetVideo()
    setUploadError(null)
    setFile({ name: picked.name, size: picked.size })
    setUploading(true)
    const ctrl = new AbortController()
    ctrlRef.current = ctrl
    let created: JobDto | null = null
    try {
      created = await createJob()
      jobIdRef.current = created.id
      setJobId(created.id)
      await uploadVideo(created.id, picked, setFraction, ctrl.signal)
      if (ctrlRef.current !== ctrl) return
      ctrlRef.current = null
      setUploading(false)
      setUploaded(true)
    } catch (e) {
      if (created) void removeJob(created.id).catch(() => {})
      if (ctrlRef.current !== ctrl) return
      resetVideo()
      if (!isAbort(e)) setUploadError(`${messageOf(e)} 다시 올려 주세요.`)
    }
  }

  /** 올리는 중이면 중단하고, 이미 올렸으면 그 작업을 지운다. 어느 쪽이든 처음 상태로 돌아간다. */
  function discardVideo() {
    const id = jobIdRef.current
    if (ctrlRef.current) {
      ctrlRef.current.abort() // pickFile 의 catch 가 작업을 지우고 처음 상태로 돌린다
      return
    }
    if (id) void removeJob(id).catch(() => {})
    resetVideo()
    setUploadError(null)
  }

  async function attachReference(picked: File) {
    if (!jobId) return
    if (!videoExtOf(picked.name)) {
      setRefError(`${UNSUPPORTED_FORMAT_MESSAGE}.`)
      return
    }
    setRefError(null)
    setRefFraction(0)
    try {
      await uploadReferenceFile(jobId, picked, setRefFraction)
      setRefFile({ name: picked.name })
      setLink('')
      setLinkError(null)
    } catch (e) {
      setRefError(messageOf(e))
    } finally {
      setRefFraction(null)
    }
  }

  async function onStart() {
    if (!jobId || !ready) return
    const trimmed = link.trim()
    if (!refFile && trimmed && !/^https?:\/\/\S+$/i.test(trimmed)) {
      setLinkError('http:// 또는 https:// 로 시작하는 링크를 넣어 주세요.')
      linkInput.current?.focus() // 고정된 시작 막대에 가려지지 않게 입력칸으로 데려간다
      linkInput.current?.scrollIntoView({ block: 'center' })
      return
    }
    setLinkError(null)
    setSubmitting(true)
    setSubmitError(null)
    try {
      await start(jobId, { description: description.trim(), purposeChoice: choice, reference: refFile ? 'uploaded' : trimmed || null })
      router.push(`/jobs/${jobId}`)
    } catch (e) {
      setSubmitError(e instanceof ApiError ? e.message : messageOf(e))
      setSubmitting(false)
    }
  }

  const guess = job?.purposeGuess ?? null
  const rulerState = probeFailed ? 'failed' : uploading || checking ? 'busy' : 'waiting'
  const blocker = !file ? '영상을 먼저 올려 주세요' : uploading ? '영상을 올리는 중이에요' : checking ? '영상을 확인하는 중이에요' : probeFailed ? '영상을 확인하지 못했어요' : refFraction !== null ? '레퍼런스 파일을 올리는 중이에요' : null

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6">
      <div>
        <h1 className="text-[22px] font-semibold leading-tight">새 영상</h1>
        <p className="mt-1 text-[15px] text-ink-2">영상을 올리고 설명과 용도를 정하면 분석을 시작해요. 레퍼런스는 지금 넣거나, 분석이 끝난 뒤 추천 목록에서 골라도 돼요.</p>
      </div>

      <Steps current={0} state={rulerState} />

      <Card title="영상">
        {!file ? (
          <Dropzone onFile={pickFile} error={uploadError} />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <FileVideo size={20} strokeWidth={1.75} className="shrink-0 text-ink-3" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium text-ink">{file.name}</p>
                <p className="text-[13px] text-ink-3 tabular-nums">{formatBytes(file.size)}</p>
              </div>
              {uploading ? (
                <Button size="sm" onClick={discardVideo} icon={<X size={16} strokeWidth={1.75} aria-hidden="true" />}>
                  취소
                </Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={discardVideo}>
                  다른 영상 고르기
                </Button>
              )}
            </div>

            {uploading ? (
              <div className="flex flex-col gap-1.5">
                <div role="progressbar" aria-label="영상 올리는 중" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)} className="h-2 overflow-hidden rounded-full bg-sunken">
                  <div className="h-full rounded-full bg-accent transition-[width] duration-150" style={{ width: `${Math.max(2, Math.round(fraction * 100))}%` }} />
                </div>
                <p className="text-[13px] text-ink-2 tabular-nums">
                  올리는 중 · {Math.round(fraction * 100)}% ({formatBytes(file.size * fraction)} / {formatBytes(file.size)})
                </p>
              </div>
            ) : null}

            {checking ? (
              <div className="flex flex-col gap-1">
                <p className="flex items-center gap-2 text-[15px] text-ink-2">
                  <Spinner size={16} />
                  올렸어요. 영상을 확인하는 중이에요…
                </p>
                {workerHint ? <p className="text-[13px] text-warn">확인이 시작되지 않아요. 처리 프로그램이 꺼져 있을 수 있어요. 앱을 다시 실행해 주세요.</p> : null}
              </div>
            ) : null}

            {probeFailed ? (
              <p role="alert" className="rounded-control bg-bad-soft px-3 py-2 text-[15px] text-bad">
                {job?.error ?? '영상을 확인하지 못했어요.'} 다른 영상을 골라 주세요.
              </p>
            ) : null}

            {ready && job ? (
              <div className="flex flex-col gap-2">
                <video src={job.media.source} poster={job.media.thumb} controls preload="metadata" className="max-h-[340px] w-full rounded-control bg-shell object-contain" />
                <p className="flex items-center gap-1.5 text-[13px] text-ink-2 tabular-nums">
                  <CircleCheck size={16} strokeWidth={1.75} className="text-ok" aria-hidden="true" />
                  {job.sourceInfo ? `${formatDuration(job.sourceInfo.durationSec)} · ${job.sourceInfo.width}×${job.sourceInfo.height}` : '확인했어요'}
                </p>
              </div>
            ) : null}
          </div>
        )}
      </Card>

      <Card title="영상 설명" description="내용을 알려 주면 전문 용어를 더 정확히 받아 적어요.">
        <Field label="설명" optional>
          {(p) => <Textarea {...p} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} placeholder="예: 골프 레슨 영상입니다. 롱아이언 체중 이동이 핵심이에요." />}
        </Field>
      </Card>

      <Card title="용도" description="어디에 올릴 영상인지에 따라 화면 비율과 편집이 달라져요. 직접 고른 값이 항상 우선이에요.">
        <div className="flex flex-col gap-3">
          <Segmented
            legend="용도 선택"
            value={choice}
            onChange={setChoice}
            options={[
              { value: 'auto', label: '자동 인식', hint: guess ? `→ ${shortPurpose(guess.purpose)}` : undefined },
              { value: 'post', label: '게시물 영상용', hint: '가로 16:9' },
              { value: 'short', label: '릴스·숏츠용', hint: '세로 9:16' },
            ]}
          />
          <p className={cx('text-[13px]', guess && guess.confidence < LOW_CONFIDENCE && choice === 'auto' ? 'text-warn' : 'text-ink-3')} aria-live="polite">
            {purposeNote(choice, guess)}
          </p>
        </div>
      </Card>

      <Card title="레퍼런스가 있다면" description="따라 하고 싶은 영상의 링크나 파일이에요. 없으면 비워 두세요. 분석이 끝난 뒤 추천 목록에서 골라도 돼요.">
        <div className="flex flex-col gap-4">
          <Field label="링크" optional error={linkError} hint="유튜브·인스타그램 등 공개된 영상의 주소">
            {(p) => <Input {...p} ref={linkInput} type="url" inputMode="url" value={link} onChange={(e) => setLink(e.target.value)} disabled={!!refFile} placeholder="https://" />}
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink">
              또는 영상 파일 <span className="font-normal text-ink-3">선택</span>
            </span>
            {refFile ? (
              <div className="flex items-center gap-2 rounded-control border border-line px-3 py-2 text-[15px]">
                <Paperclip size={16} strokeWidth={1.75} className="shrink-0 text-ink-3" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{refFile.name}</span>
                <Button size="icon" variant="ghost" aria-label="첨부한 레퍼런스 파일 빼기" onClick={() => setRefFile(null)}>
                  <X size={16} strokeWidth={1.75} aria-hidden="true" />
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Button size="sm" disabled={!jobId || refFraction !== null} onClick={() => refInput.current?.click()} icon={<Paperclip size={16} strokeWidth={1.75} aria-hidden="true" />}>
                  파일 첨부
                </Button>
                {refFraction !== null ? <span className="text-[13px] text-ink-2 tabular-nums">올리는 중 · {Math.round(refFraction * 100)}%</span> : null}
                {!jobId ? <span className="text-[13px] text-ink-3">영상을 올린 뒤에 첨부할 수 있어요</span> : null}
              </div>
            )}
            <input
              ref={refInput}
              type="file"
              accept={[...VIDEO_EXTS, 'video/*'].join(',')}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void attachReference(f)
                e.target.value = ''
              }}
            />
            {refError ? (
              <p role="alert" className="text-[13px] font-medium text-bad">
                {refError}
              </p>
            ) : null}
          </div>
        </div>
      </Card>

      <div className="sticky bottom-3 flex flex-col gap-2 rounded-panel border border-line bg-panel px-4 py-3 shadow-float">
        {submitError ? (
          <p role="alert" className="text-[13px] font-medium text-bad">
            {submitError}
          </p>
        ) : null}
        <div className="flex items-center justify-end gap-4">
          {blocker ? <p className="text-[13px] text-ink-3">{blocker}</p> : null}
          <Button variant="primary" disabled={!ready || refFraction !== null} loading={submitting} onClick={onStart}>
            분석 시작
          </Button>
        </div>
      </div>
    </div>
  )
}

const shortPurpose = (p: 'post' | 'short') => (p === 'post' ? '게시물 영상용' : '릴스·숏츠용')

/** 용도 선택 아래 한 줄: 자동 인식 결과와 이유, 확신이 낮을 때의 권유 */
function purposeNote(choice: Choice, guess: JobDto['purposeGuess']): string {
  if (!guess) return choice === 'auto' ? '영상을 올리면 가로·세로 비율과 길이를 보고 자동으로 정해요.' : '직접 고른 값으로 만들어요.'
  const reason = guess.reasons[0] ? ` — ${guess.reasons[0]}` : ''
  if (choice === 'auto') {
    const low = guess.confidence < LOW_CONFIDENCE ? ' 확신이 낮아요. 직접 골라 보세요.' : ''
    return `자동 인식: ${purposeLabel(guess.purpose)}${reason}.${low}`
  }
  return guess.purpose === choice ? `직접 고른 값이에요. 자동 인식도 같았어요${reason}.` : `직접 고른 값으로 만들어요. (자동 인식은 ${purposeLabel(guess.purpose)} 였어요.)`
}

