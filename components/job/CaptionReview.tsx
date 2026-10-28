'use client'

import { Merge, Play, Plus, RotateCcw, Scissors, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { CaptionLine, CaptionReviewDto } from '../../src/shared/types.ts'
import { addLineAt, gapsOf, lineProblems, mergeWithNext, originalFor, rateWarning, removeLine, setEnd, setStart, setText, splitLine, type Lines } from '../../src/ui/captionTrack.ts'
import { formatDuration } from '../../src/ui/format.ts'
import { Button } from '../ui/Button.tsx'
import { Card } from '../ui/Card.tsx'
import { Input } from '../ui/Field.tsx'
import { Switch } from '../ui/Switch.tsx'

/** 줄이 이만큼 넘게 많으면 처음부터 "의심되는 줄만" 보여 준다(긴 영상) */
const MANY_LINES = 40
/** 빈 구간·"현재 위치에 추가"로 넣는 새 줄의 기본 길이(초) */
const NEW_LINE_SEC = 3

const sec1 = (n: number) => n.toFixed(1)

/** 시작·끝 시각 칸: 타이핑하는 동안은 그대로 두고, 칸을 벗어나거나 Enter 를 칠 때 값을 확정한다(이웃 줄과 겹치지 않게 맞춰진다) */
function TimeField({ value, label, onCommit, disabled }: { value: number; label: string; onCommit: (t: number) => void; disabled?: boolean }) {
  const [text, setTextState] = useState(sec1(value))
  useEffect(() => setTextState(sec1(value)), [value])
  return (
    <input
      type="number"
      inputMode="decimal"
      step="0.1"
      min="0"
      aria-label={label}
      value={text}
      disabled={disabled}
      onChange={(e) => setTextState(e.target.value)}
      onBlur={() => {
        const n = Number(text)
        if (text.trim() !== '' && Number.isFinite(n)) onCommit(n)
        // 값이 그대로면(겹쳐서 맞춰진 경우 포함) 위의 effect 가 안 돌므로 여기서 칸을 다시 맞춘다. 값이 바뀌면 effect 가 새 값으로 덮는다.
        setTextState(sec1(value))
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
      className="h-9 w-[72px] rounded-control border border-field-line bg-raised px-2 text-center text-[14px] tabular-nums text-ink focus:border-accent focus:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
    />
  )
}

type Row = { kind: 'line'; i: number; line: CaptionLine } | { kind: 'gap'; start: number; end: number }

/**
 * 자막 편집기: 영상의 **모든 자막**을 시간순 한 목록으로 보여 주고 고치게 한다. 인식한 줄의 글자뿐 아니라 시작·끝 시각, 줄 나누기·합치기·지우기,
 * 인식이 놓친 구간("자막이 없는 구간")에 새 줄 추가까지. 시각을 누르면 그 구간을 재생해서 들어 볼 수 있다. 고치지 않고 계속해도 된다.
 */
export function CaptionReview({ review, lines, onChange, videoSrc, disabled }: { review: CaptionReviewDto; lines: Lines; onChange: (next: Lines) => void; videoSrc?: string; disabled?: boolean }) {
  const original = review.original
  const suspectCount = original.filter((o) => o.lowWords.length > 0).length
  const [onlySuspect, setOnlySuspect] = useState(lines.length > MANY_LINES && suspectCount > 0)
  const [notice, setNotice] = useState<string | null>(null)
  const [pendingFocus, setPendingFocus] = useState<number | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  const stopAt = useRef<number | null>(null)
  const inputs = useRef<Record<number, HTMLInputElement | null>>({})

  // 줄을 새로 넣으면 그 줄의 글자 칸으로 커서를 옮긴다
  useEffect(() => {
    if (pendingFocus === null) return
    inputs.current[pendingFocus]?.focus()
    setPendingFocus(null)
  }, [pendingFocus, lines])

  if (!review.hasSpeech && lines.length === 0) return null

  const problems = lineProblems(lines, review.durationSec)
  const gaps = gapsOf(lines, review.durationSec)

  const rows: Row[] = [...lines.map((line, i): Row => ({ kind: 'line', i, line })), ...gaps.map((g): Row => ({ kind: 'gap', ...g }))].sort((a, b) => (a.kind === 'line' ? a.line.start : a.start) - (b.kind === 'line' ? b.line.start : b.start))
  const isSuspect = (line: CaptionLine) => {
    const o = originalFor(original, line)
    const untouched = !!o && o.text === line.text && Math.abs(o.start - line.start) < 0.05 && Math.abs(o.end - line.end) < 0.05
    return !untouched || (o?.lowWords.length ?? 0) > 0 // 고친·새 줄은 늘 보인다
  }
  const shown = onlySuspect ? rows.filter((r) => r.kind === 'line' && isSuspect(r.line)) : rows

  function play(start: number, end: number) {
    const v = video.current
    if (!v) return
    stopAt.current = end
    v.currentTime = start
    void v.play().catch(() => {})
  }

  function add(startSec: number) {
    const next = addLineAt(lines, startSec, NEW_LINE_SEC, review.durationSec)
    if (next === lines) {
      setNotice('그 자리에는 줄을 넣을 수 없어요(이미 자막이 있거나 0.2초도 안 남았어요). 빈 구간에서 추가해 주세요.')
      return
    }
    setNotice(null)
    setOnlySuspect(false) // 새 줄이 보이게
    onChange(next)
    setPendingFocus(next.findIndex((x, k) => x !== lines[k]))
  }

  // 시각은 이웃 줄과 겹치지 않게 맞춰진다 — 입력한 값과 달라졌으면 알려 준다
  function commitTime(i: number, which: 'start' | 'end', t: number) {
    const next = which === 'start' ? setStart(lines, i, t) : setEnd(lines, i, t, review.durationSec)
    const got = next[i]?.[which] ?? t
    setNotice(Math.abs(got - t) > 0.05 ? `이웃한 줄과 겹치지 않게(또는 0.2초 이상 남게) ${sec1(got)}초로 맞췄어요.` : null)
    onChange(next)
  }

  function split(i: number) {
    const caret = inputs.current[i]?.selectionStart ?? Math.floor(lines[i]!.text.length / 2)
    const next = splitLine(lines, i, caret)
    if (next === lines) setNotice('이 줄은 나눌 수 없어요. 나누고 싶은 글자 사이에 커서를 두세요(줄이 너무 짧으면 나눌 수 없어요).')
    else {
      setNotice(null)
      onChange(next)
    }
  }

  const changed = JSON.stringify(lines.map((l) => [l.start, l.end, l.text])) !== JSON.stringify(original.map((l) => [l.start, l.end, l.text]))

  return (
    <Card
      title="자막 편집"
      description="영상의 모든 자막을 고칠 수 있어요. 글자·시작과 끝 시각을 고치고, 줄을 나누거나 합치거나 지우고, 인식이 놓친 구간에는 새 줄을 넣어요. 시각을 누르면 그 부분을 들어 볼 수 있어요. 고치지 않고 계속해도 돼요."
      action={changed ? <span className="rounded-chip bg-accent-soft px-2.5 py-1 text-[12px] font-semibold text-accent-ink">고침 있음</span> : null}
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

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={disabled} onClick={() => add(video.current?.currentTime ?? lines.at(-1)?.end ?? 0)}>
            <Plus size={14} strokeWidth={2} aria-hidden="true" />
            {videoSrc ? '영상 현재 위치에 줄 추가' : '줄 추가'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled || !changed}
            onClick={() => {
              if (window.confirm('인식한 자막으로 되돌릴까요? 고친 내용이 모두 사라져요.')) {
                setNotice(null)
                onChange(original.map(({ start, end, text }) => ({ start, end, text })))
              }
            }}
          >
            <RotateCcw size={14} strokeWidth={2} aria-hidden="true" />
            원래대로
          </Button>
          <span className="text-[13px] text-ink-3">
            {lines.length}줄{gaps.length > 0 ? ` · 자막 없는 구간 ${gaps.length}곳` : ''}
          </span>
        </div>
        {notice ? (
          <p role="status" className="text-[13px] text-warn">
            {notice}
          </p>
        ) : null}

        {suspectCount > 0 || lines.length > MANY_LINES ? (
          <Switch checked={onlySuspect} onChange={setOnlySuspect} label="고치기 좋은 줄만 보기" description={`인식기가 확신하지 못한 단어가 있는 줄 ${suspectCount}개와 고치거나 새로 넣은 줄만 보여요(자막 없는 구간은 숨겨요).`} disabled={disabled} />
        ) : null}

        <ul className="flex max-h-[560px] flex-col gap-4 overflow-y-auto pr-1">
          {shown.map((row) => {
            if (row.kind === 'gap') {
              return (
                <li key={`gap-${row.start}`} className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-dashed border-line-strong px-4 py-3">
                  <p className="text-[14px] text-ink-2">
                    자막이 없는 구간 <span className="tabular-nums text-ink">{sec1(row.start)}~{sec1(row.end)}초</span>
                  </p>
                  <Button size="sm" disabled={disabled} onClick={() => add(row.start)}>
                    <Plus size={14} strokeWidth={2} aria-hidden="true" />이 구간에 자막 추가
                  </Button>
                </li>
              )
            }
            const { i, line } = row
            const problem = problems[i]
            const warn = !problem ? rateWarning(line) : null
            const o = originalFor(original, line)
            const edited = !!o && o.text !== line.text
            const n = i + 1
            return (
              <li key={`line-${i}`} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {videoSrc ? (
                    <Button size="sm" variant="ghost" className="tabular-nums" onClick={() => play(line.start, line.end)} aria-label={`${n}번째 줄 ${formatDuration(line.start)}부터 재생`} disabled={disabled}>
                      <Play size={14} strokeWidth={2} aria-hidden="true" />
                      {formatDuration(line.start)}
                    </Button>
                  ) : null}
                  <TimeField value={line.start} label={`${n}번째 줄 시작 시각(초)`} onCommit={(t) => commitTime(i, 'start', t)} disabled={disabled} />
                  <span className="text-ink-3" aria-hidden="true">
                    ~
                  </span>
                  <TimeField value={line.end} label={`${n}번째 줄 끝 시각(초)`} onCommit={(t) => commitTime(i, 'end', t)} disabled={disabled} />
                  <span className="text-[13px] text-ink-3">초</span>
                  <span className="ml-auto flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => split(i)} aria-label={`${n}번째 줄 나누기`} disabled={disabled}>
                      <Scissors size={14} strokeWidth={2} aria-hidden="true" />
                      나누기
                    </Button>
                    {i < lines.length - 1 ? (
                      <Button size="sm" variant="ghost" onClick={() => onChange(mergeWithNext(lines, i))} aria-label={`${n}번째 줄을 다음 줄과 합치기`} disabled={disabled}>
                        <Merge size={14} strokeWidth={2} aria-hidden="true" />
                        합치기
                      </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" onClick={() => onChange(removeLine(lines, i))} aria-label={`${n}번째 줄 지우기`} disabled={disabled}>
                      <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
                      지우기
                    </Button>
                  </span>
                </div>
                <Input
                  ref={(el) => {
                    inputs.current[i] = el
                  }}
                  value={line.text}
                  disabled={disabled}
                  placeholder="자막 글자를 써 주세요(비워 두면 이 줄은 빠져요)"
                  aria-label={`자막 ${n}번째 줄`}
                  aria-invalid={problem ? true : undefined}
                  onChange={(e) => onChange(setText(lines, i, e.target.value))}
                />
                {problem ? (
                  <p role="alert" className="text-[13px] font-medium text-bad">
                    {problem}
                  </p>
                ) : (
                  <>
                    {edited ? <p className="break-words text-[13px] text-ink-3">원문: {o!.text}</p> : null}
                    {!edited && o && o.lowWords.length > 0 && o.text === line.text ? <p className="break-words text-[13px] text-warn">의심 단어: {o.lowWords.join(', ')}</p> : null}
                    {!o && line.text.trim() ? <p className="text-[13px] text-ink-3">새로 넣은 줄이에요.</p> : null}
                    {warn ? <p className="text-[13px] text-warn">{warn}</p> : null}
                  </>
                )}
              </li>
            )
          })}
        </ul>
        {shown.length === 0 ? <p className="text-[14px] text-ink-3">보여 줄 줄이 없어요.</p> : null}
      </div>
    </Card>
  )
}
