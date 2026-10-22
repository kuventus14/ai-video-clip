'use client'

import { Play, RotateCcw, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import type { CaptionReviewDto } from '../../src/shared/types.ts'
import { partProblems, setPartText, togglePartDelete, visibleParts, type CaptionDraft } from '../../src/ui/captions.ts'
import { formatDuration } from '../../src/ui/format.ts'
import { Button } from '../ui/Button.tsx'
import { Card } from '../ui/Card.tsx'
import { Input } from '../ui/Field.tsx'
import { Switch } from '../ui/Switch.tsx'

/** 줄이 이만큼 넘게 많으면 처음부터 "의심되는 줄만" 보여 준다(긴 영상) */
const MANY_PARTS = 40

/**
 * 음성 인식이 만든 자막을 줄마다 보여 주고 고치게 한다. 시각을 누르면 그 구간만 재생해서 들어 볼 수 있다.
 * 고친 글자는 편집 구성·컷·최종 자막에 그대로 쓰인다. 고치지 않고 계속해도 된다.
 */
export function CaptionReview({ review, draft, onChange, videoSrc, disabled }: { review: CaptionReviewDto; draft: CaptionDraft; onChange: (next: CaptionDraft) => void; videoSrc?: string; disabled?: boolean }) {
  const suspectCount = review.parts.filter((p) => p.lowWords.length > 0).length
  const [onlySuspect, setOnlySuspect] = useState(review.parts.length > MANY_PARTS && suspectCount > 0)
  const video = useRef<HTMLVideoElement>(null)
  const stopAt = useRef<number | null>(null)

  if (!review.hasSpeech || review.parts.length === 0) return null

  const problems = partProblems(draft)
  const parts = visibleParts(review, onlySuspect)
  const edited = Object.keys(draft).length

  function play(start: number, end: number) {
    const v = video.current
    if (!v) return
    stopAt.current = end
    v.currentTime = start
    void v.play().catch(() => {})
  }

  return (
    <Card
      title="자막 확인"
      description="음성 인식이 틀린 곳을 고쳐 주세요. 시각을 누르면 그 부분을 들어 볼 수 있어요. 고친 글자로 편집 구성과 자막이 만들어져요. 고치지 않고 계속해도 돼요."
      action={edited > 0 ? <span className="rounded-chip bg-accent-soft px-2.5 py-1 text-[12px] font-semibold tabular-nums text-accent-ink">{edited}곳 고침</span> : null}
    >
      <div className="flex flex-col gap-5">
        {videoSrc ? (
          <video
            ref={video}
            src={videoSrc}
            controls
            preload="metadata"
            playsInline
            className="max-h-[240px] w-full rounded-control bg-stage object-contain"
            onTimeUpdate={(e) => {
              if (stopAt.current !== null && e.currentTarget.currentTime >= stopAt.current) {
                e.currentTarget.pause()
                stopAt.current = null
              }
            }}
            onPause={() => {
              stopAt.current = null
            }}
          />
        ) : null}

        {suspectCount > 0 ? (
          <Switch checked={onlySuspect} onChange={setOnlySuspect} label="의심되는 줄만 보기" description={`인식기가 확신하지 못한 단어가 있는 줄 ${suspectCount}개 / 전체 ${review.parts.length}줄`} disabled={disabled} />
        ) : (
          <p className="text-[13px] text-ink-3">인식기가 확신하지 못한 단어는 없었어요. 그래도 들어 보고 틀린 곳이 있으면 고쳐 주세요.</p>
        )}

        <ul className="flex max-h-[520px] flex-col gap-4 overflow-y-auto pr-1">
          {parts.map((p) => {
            const value = draft[p.i]
            const deleted = value === null
            const shown = deleted ? p.text : (value ?? p.text)
            const changed = value !== undefined
            const problem = problems[p.i]
            return (
              <li key={p.i} className="flex flex-wrap items-start gap-x-3 gap-y-1">
                {videoSrc ? (
                  <Button size="sm" variant="ghost" className="order-1 shrink-0 tabular-nums sm:mt-1.5" onClick={() => play(p.start, p.end)} aria-label={`${p.i + 1}번째 줄 ${formatDuration(p.start)}부터 재생`} disabled={disabled}>
                    <Play size={14} strokeWidth={2} aria-hidden="true" />
                    {formatDuration(p.start)}
                  </Button>
                ) : (
                  <span className="order-1 w-12 shrink-0 text-[13px] tabular-nums text-ink-3 sm:mt-3">{formatDuration(p.start)}</span>
                )}
                <div className="order-3 min-w-0 basis-full sm:order-2 sm:flex-1 sm:basis-0">
                  <Input
                    value={shown}
                    disabled={disabled || deleted}
                    aria-label={`자막 ${p.i + 1}번째 줄`}
                    aria-invalid={problem ? true : undefined}
                    className={deleted ? 'line-through opacity-60' : undefined}
                    onChange={(e) => onChange(setPartText(draft, review, p.i, e.target.value))}
                  />
                  {problem ? (
                    <p role="alert" className="mt-1 text-[13px] font-medium text-bad">
                      {problem}
                    </p>
                  ) : deleted ? (
                    <p className="mt-1 text-[13px] text-ink-3">이 줄은 자막에서 빠져요.</p>
                  ) : changed && shown.trim() === '' ? (
                    <p className="mt-1 text-[13px] text-ink-3">비워 두면 이 줄은 자막에서 빠져요.</p>
                  ) : changed ? (
                    <p className="mt-1 break-words text-[13px] text-ink-3">원문: {p.text}</p>
                  ) : p.lowWords.length > 0 ? (
                    <p className="mt-1 break-words text-[13px] text-warn">의심 단어: {p.lowWords.join(', ')}</p>
                  ) : null}
                </div>
                <Button size="sm" variant="ghost" className="order-2 ml-auto shrink-0 sm:order-3 sm:ml-0 sm:mt-1.5" onClick={() => onChange(togglePartDelete(draft, p.i))} disabled={disabled}>
                  {deleted ? <RotateCcw size={14} strokeWidth={2} aria-hidden="true" /> : <Trash2 size={14} strokeWidth={2} aria-hidden="true" />}
                  {deleted ? '되돌리기' : '지우기'}
                </Button>
              </li>
            )
          })}
        </ul>
        {parts.length === 0 ? <p className="text-[14px] text-ink-3">보여 줄 줄이 없어요.</p> : null}
      </div>
    </Card>
  )
}
