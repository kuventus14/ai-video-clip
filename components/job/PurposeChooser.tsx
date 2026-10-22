'use client'

import { ScanSearch } from 'lucide-react'
import { useId } from 'react'
import type { JobDto } from '../../src/shared/types.ts'
import { LOW_CONFIDENCE, previewNeedsBlur, purposeNote } from '../../src/ui/format.ts'
import { cx } from '../ui/cx.ts'

export type PurposeChoice = 'auto' | 'post' | 'short'

const shortPurpose = (p: 'post' | 'short') => (p === 'post' ? '게시물 영상용' : '릴스·숏츠용')

/**
 * 영상이 어떻게 담기는지 보여 주는 작은 프레임. 앱은 원본을 자르지 않는다: 비율이 프레임과 다르면 영상을 가운데에 두고
 * 남는 곳(세로 영상 → 가로 프레임은 양옆, 가로 영상 → 세로 프레임은 위아래)을 같은 장면을 흐리게 채운다(실제 동작).
 */
function FrameSample({ shape, source, selected }: { shape: 'landscape' | 'portrait'; source?: { thumb: string; width: number; height: number } | null; selected: boolean }) {
  const frame = shape === 'landscape' ? 'h-[72px] w-[128px]' : 'h-[72px] w-[41px]'
  const blurFill = !!source && previewNeedsBlur(shape, source)
  return (
    <span className={cx('relative block shrink-0 overflow-hidden rounded-[7px] bg-stage ring-2 transition-[box-shadow,transform] duration-500 ease-[var(--ease-expo)]', frame, selected ? 'ring-accent' : 'ring-line-strong')} aria-hidden="true">
      {source ? (
        blurFill ? (
          <>
            <img src={source.thumb} alt="" className="absolute inset-0 size-full scale-150 object-cover opacity-70 blur-md" />
            <img src={source.thumb} alt="" className="absolute inset-0 size-full object-contain" />
          </>
        ) : (
          <img src={source.thumb} alt="" className="absolute inset-0 size-full object-cover" />
        )
      ) : (
        <span className="absolute inset-0 grid place-items-center text-[11px] font-semibold text-ink-3">{shape === 'landscape' ? '16:9' : '9:16'}</span>
      )}
    </span>
  )
}

/** 용도(자동 인식·게시물 영상용·릴스/숏츠용) 선택과, 자동 인식 결과·이유를 알려 주는 한 줄. 직접 고른 값이 항상 우선이다. */
export function PurposeChooser({
  value,
  onChange,
  guess,
  disabled,
  source,
}: {
  value: PurposeChoice
  onChange: (v: PurposeChoice) => void
  guess: JobDto['purposeGuess']
  disabled?: boolean
  /** 올린 영상의 장면과 크기(있으면 프레임에 담긴 모습을 보여 준다) */
  source?: { thumb: string; width: number; height: number } | null
}) {
  const name = useId()
  const lowConfidence = guess !== null && guess.confidence < LOW_CONFIDENCE && value === 'auto'
  const options: { value: PurposeChoice; label: string; hint: string; body: React.ReactNode }[] = [
    {
      value: 'auto',
      label: '자동 인식',
      hint: guess ? `→ ${shortPurpose(guess.purpose)}` : '올리면 정해져요',
      body: <ScanSearch size={30} strokeWidth={1.5} className="text-ink-2" aria-hidden="true" />,
    },
    { value: 'post', label: '게시물 영상용', hint: '가로 16:9', body: <FrameSample shape="landscape" source={source} selected={value === 'post'} /> },
    { value: 'short', label: '릴스·숏츠용', hint: '세로 9:16', body: <FrameSample shape="portrait" source={source} selected={value === 'short'} /> },
  ]
  return (
    <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-3">
      <legend className="mb-2 text-[14px] font-semibold text-ink">용도 선택</legend>
      <div className="grid grid-cols-3 gap-2.5">
        {options.map((o) => (
          <label
            key={o.value}
            className={cx(
              'flex min-h-[148px] cursor-pointer flex-col items-center justify-between gap-3 rounded-[16px] bg-raised px-2 pb-3.5 pt-4 text-center transition-[background-color,box-shadow] duration-200',
              'hover:bg-lift has-[:checked]:bg-lift has-[:checked]:shadow-[inset_0_0_0_2px_var(--accent)]',
              'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
              disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="sr-only" />
            <span className="flex h-[72px] items-center justify-center">{o.body}</span>
            <span className="flex flex-col gap-0.5">
              <span className={cx('text-[14px] leading-tight', value === o.value ? 'font-semibold text-ink' : 'font-medium text-ink-2')}>{o.label}</span>
              <span className="text-[12px] text-ink-3">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>
      <p className={cx('text-[13px] leading-relaxed', lowConfidence ? 'text-warn' : 'text-ink-3')} aria-live="polite">
        {purposeNote(value, guess)}
      </p>
    </fieldset>
  )
}
