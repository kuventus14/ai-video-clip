'use client'

import { CircleAlert, CircleCheck, FileVideo, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { UNSUPPORTED_FORMAT_MESSAGE, videoExtOf } from '../../src/shared/media.ts'
import type { JobDto } from '../../src/shared/types.ts'
import { ApiError, createJob, removeJob, start, uploadVideo } from '../../src/ui/api.ts'
import { formatBytes, formatDuration } from '../../src/ui/format.ts'
import { BAD_LINK_MESSAGE, checkLink } from '../../src/ui/reference.ts'
import { useJob } from '../../src/ui/useJob.ts'
import { ActionBar } from '../ui/ActionBar.tsx'
import { Button } from '../ui/Button.tsx'
import { Card } from '../ui/Card.tsx'
import { cx } from '../ui/cx.ts'
import { Field, Textarea } from '../ui/Field.tsx'
import { Spinner } from '../ui/Spinner.tsx'
import { Steps } from '../ui/Steps.tsx'
import { Dropzone } from './Dropzone.tsx'
import { StageGraphic } from './StageGraphic.tsx'
import { PurposeChooser, type PurposeChoice } from './PurposeChooser.tsx'
import { ReferenceInput } from './ReferenceInput.tsx'

/** 영상 확인(워커)이 이 시간 넘게 시작되지 않으면 처리 프로그램이 꺼져 있을 수 있다고 알려 준다 */
const WORKER_HINT_MS = 15_000

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * 새 영상을 올리고 설명·용도·레퍼런스를 정해 분석을 시작하는 폼.
 * resume 을 주면 이미 올려 둔(ready) 작업에서 이어서 시작한다 — 작업 화면에 들어 있는 형태라 제목·눈금자는 부모가 보여 주고,
 * 시작하면 onStarted 로 알리고(주소는 그대로), "다른 영상" 은 그 작업을 지우고 새 영상 화면으로 보낸다.
 */
export function UploadForm({ resume, onStarted }: { resume?: JobDto; onStarted?: (job: JobDto) => void } = {}) {
  const router = useRouter()

  // 영상
  const [file, setFile] = useState<{ name: string; size: number } | null>(resume ? { name: resume.sourceName ?? '올린 영상', size: 0 } : null)
  const [jobId, setJobId] = useState<string | null>(resume?.id ?? null)
  const [uploading, setUploading] = useState(false)
  const [uploaded, setUploaded] = useState(!!resume)
  const [fraction, setFraction] = useState(0)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const ctrlRef = useRef<AbortController | null>(null)
  const jobIdRef = useRef<string | null>(resume?.id ?? null)

  // 입력
  const [description, setDescription] = useState(resume?.description ?? '')
  const [choice, setChoice] = useState<PurposeChoice>(resume?.purposeChoice ?? 'auto')
  const [link, setLink] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [refFileName, setRefFileName] = useState<string | null>(null)
  const [refBusy, setRefBusy] = useState(false)
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
    setRefFileName(null)
    setRefBusy(false)
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
    if (resume) router.push('/new') // 작업 화면 안에서는 올릴 곳이 없으니 새 영상 화면으로
  }

  async function onStart() {
    if (!jobId || !ready) return
    const checked = checkLink(link)
    if (!refFileName && checked.kind === 'bad') {
      setLinkError(BAD_LINK_MESSAGE)
      linkInput.current?.focus() // 고정된 시작 막대에 가려지지 않게 입력칸으로 데려간다
      linkInput.current?.scrollIntoView({ block: 'center' })
      return
    }
    setLinkError(null)
    setSubmitting(true)
    setSubmitError(null)
    try {
      const next = await start(jobId, { description: description.trim(), purposeChoice: choice, reference: refFileName ? 'uploaded' : checked.kind === 'ok' ? checked.url : null })
      if (onStarted) onStarted(next)
      else router.push(`/jobs/${jobId}`)
    } catch (e) {
      setSubmitError(e instanceof ApiError ? e.message : messageOf(e))
      setSubmitting(false)
    }
  }

  const guess = job?.purposeGuess ?? null
  const rulerState = probeFailed ? 'failed' : uploading || checking ? 'busy' : 'waiting'
  const blocker = !file ? '영상을 먼저 올려 주세요' : uploading ? '영상을 올리는 중이에요' : checking ? '영상을 확인하는 중이에요' : probeFailed ? '영상을 확인하지 못했어요' : refBusy ? '레퍼런스 파일을 올리는 중이에요' : null

  const source = job?.media.thumb && job.sourceInfo ? { thumb: job.media.thumb, width: job.sourceInfo.width, height: job.sourceInfo.height } : null
  const percent = Math.round(fraction * 100)

  return (
    <div className="flex w-full flex-col gap-8">
      {resume ? null : (
        <>
          <div>
            <h1 className="wipe text-[34px] font-bold leading-[1.15] tracking-[-0.035em] sm:text-[44px]">새 영상</h1>
            <p className="enter mt-3 max-w-[54ch] text-[16px] leading-relaxed text-ink-2" style={{ ['--i' as string]: 2 }}>
              영상을 올리고 설명과 용도를 정하면 분석을 시작해요. 레퍼런스는 지금 넣거나, 분석이 끝난 뒤 추천 목록에서 골라도 돼요.
            </p>
          </div>
          <div className="enter" style={{ ['--i' as string]: 3 }}>
            <Steps current={0} state={rulerState} />
          </div>
        </>
      )}

      <div className="enter grid items-start gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]" style={{ ['--i' as string]: 4 }}>
        <section aria-label="영상" className="min-w-0 lg:sticky lg:top-6">
          {!file ? (
            <Dropzone onFile={pickFile} error={uploadError} />
          ) : (
            <div className="overflow-hidden rounded-panel bg-panel">
              {/* 무대: 올리는 중=진행 숫자, 확인 중=스캔, 확인 끝=영상 플레이어, 못 읽음=멈춤 */}
              <div className="vf relative flex aspect-video items-center justify-center overflow-hidden bg-stage" data-active={uploading || checking ? 'true' : undefined}>
                {ready && job ? (
                  <video src={job.media.source} poster={job.media.thumb} controls preload="metadata" className="relative z-[1] size-full object-contain" />
                ) : checking ? (
                  <StageGraphic visual="probe" thumb={job?.media.thumb} className="!rounded-none" />
                ) : probeFailed ? (
                  <p className="flex items-center gap-3 px-8 text-center text-[19px] font-semibold text-bad">
                    <CircleAlert size={26} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
                    영상을 읽지 못했어요
                  </p>
                ) : (
                  <div className="text-center" aria-hidden="true">
                    <p className="text-[64px] font-bold leading-none tracking-[-0.04em] text-accent tnum sm:text-[88px]">
                      {percent}
                      <span className="ml-1 text-[28px] font-semibold text-ink-2">%</span>
                    </p>
                    <p className="mt-3 text-[14px] text-ink-2 tnum">
                      {formatBytes(file.size * fraction)} / {formatBytes(file.size)}
                    </p>
                  </div>
                )}
                {ready ? null : (
                  <>
                    <span className="vf-c" data-p="tl" />
                    <span className="vf-c" data-p="tr" />
                    <span className="vf-c" data-p="bl" />
                    <span className="vf-c" data-p="br" />
                  </>
                )}
              </div>

              <div className="flex flex-col gap-4 p-5">
                <div className="flex items-center gap-3">
                  <FileVideo size={22} strokeWidth={1.5} className="shrink-0 text-ink-3" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[16px] font-semibold text-ink">{file.name}</p>
                    <p className="text-[13px] text-ink-3 tnum">
                      {file.size > 0 ? formatBytes(file.size) : null}
                      {ready && job?.sourceInfo ? `${file.size > 0 ? ' · ' : ''}${formatDuration(job.sourceInfo.durationSec)} · ${job.sourceInfo.width}×${job.sourceInfo.height}` : null}
                    </p>
                  </div>
                  {uploading ? (
                    <Button size="sm" onClick={discardVideo} icon={<X size={16} strokeWidth={2} aria-hidden="true" />}>
                      취소
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={discardVideo}>
                      다른 영상 고르기
                    </Button>
                  )}
                </div>

                {uploading ? (
                  <div className="flex flex-col gap-2">
                    <div role="progressbar" aria-label="영상 올리는 중" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1.5 overflow-hidden rounded-full bg-lift">
                      <div className="h-full rounded-full bg-accent transition-[width] duration-150" style={{ width: `${Math.max(2, percent)}%` }} />
                    </div>
                    <p className="text-[13px] text-ink-2 tnum">
                      올리는 중 · {percent}% ({formatBytes(file.size * fraction)} / {formatBytes(file.size)})
                    </p>
                  </div>
                ) : null}

                {checking ? (
                  <div className="flex flex-col gap-1.5">
                    <p className="flex items-center gap-2 text-[15px] text-ink-2">
                      <Spinner size={16} className="text-accent" />
                      올렸어요. 영상을 확인하는 중이에요…
                    </p>
                    {workerHint ? <p className="text-[13px] text-warn">확인이 시작되지 않아요. 처리 프로그램이 꺼져 있을 수 있어요. 앱을 다시 실행해 주세요.</p> : null}
                  </div>
                ) : null}

                {probeFailed ? (
                  <p role="alert" className="rounded-control bg-bad-soft px-4 py-3 text-[15px] text-bad">
                    {job?.error ?? '영상을 확인하지 못했어요.'} 다른 영상을 골라 주세요.
                  </p>
                ) : null}

                {ready ? (
                  <p className="flex items-center gap-1.5 text-[13px] text-ink-2">
                    <CircleCheck size={16} strokeWidth={2} className="text-ok" aria-hidden="true" />
                    영상을 확인했어요
                  </p>
                ) : null}
              </div>
            </div>
          )}
        </section>

        <div className="flex min-w-0 flex-col gap-6">
          <Card title="영상 설명" description="내용을 알려 주면 전문 용어를 더 정확히 받아 적어요.">
            <Field label="설명" optional>
              {(p) => <Textarea {...p} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} placeholder="예: 골프 레슨 영상입니다. 롱아이언 체중 이동이 핵심이에요." />}
            </Field>
          </Card>

          <Card title="용도" description="어디에 올릴 영상인지에 따라 화면 비율과 편집이 달라져요. 직접 고른 값이 항상 우선이에요.">
            <PurposeChooser value={choice} onChange={setChoice} guess={guess} source={source} />
          </Card>

          <Card title="레퍼런스가 있다면" description="따라 하고 싶은 영상의 링크나 파일이에요. 없으면 비워 두세요. 분석이 끝난 뒤 추천 목록에서 골라도 돼요.">
            <ReferenceInput
              jobId={jobId}
              link={link}
              onLinkChange={(v) => {
                setLink(v)
                setLinkError(null)
              }}
              linkError={linkError}
              linkRef={linkInput}
              fileName={refFileName}
              onFileChange={(name) => {
                setRefFileName(name)
                if (name) {
                  setLink('')
                  setLinkError(null)
                }
              }}
              onBusyChange={setRefBusy}
            />
          </Card>
        </div>
      </div>

      <ActionBar error={submitError} hint={blocker}>
        <Button variant="primary" disabled={!ready || refBusy} loading={submitting} onClick={onStart}>
          분석 시작
        </Button>
      </ActionBar>
    </div>
  )
}
