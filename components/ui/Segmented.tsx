'use client'

import { useId, type ReactNode } from 'react'
import { cx } from './cx.ts'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  /** 라벨 아래 작은 글씨 */
  hint?: ReactNode
}

/**
 * 하나만 고르는 세그먼트. 속은 라디오 버튼이라 화살표 키로 옮기고 Tab 으로 묶음 전체를 지나간다.
 * 고른 칸은 색뿐 아니라 굵은 글씨와 테두리로도 드러난다.
 */
export function Segmented<T extends string>({ legend, value, onChange, options, disabled = false, className }: { legend: string; value: T; onChange: (v: T) => void; options: SegmentedOption<T>[]; disabled?: boolean; className?: string }) {
  const name = useId()
  return (
    <fieldset disabled={disabled} className={cx('min-w-0', className)}>
      <legend className="mb-1.5 text-[13px] font-medium text-ink">{legend}</legend>
      <div className={cx('grid gap-1 rounded-control bg-sunken p-1', options.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
        {options.map((o) => (
          <label
            key={o.value}
            className={cx(
              'flex min-h-11 cursor-pointer flex-col items-center justify-center rounded-[6px] border border-transparent px-2 py-1.5 text-center text-[14px] leading-tight text-ink-2 transition-colors duration-150',
              'hover:text-ink has-[:checked]:border-accent has-[:checked]:bg-panel has-[:checked]:font-semibold has-[:checked]:text-ink',
              'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
              disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="sr-only" />
            <span>{o.label}</span>
            {o.hint ? <span className="mt-0.5 text-[12px] font-normal text-ink-3">{o.hint}</span> : null}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
