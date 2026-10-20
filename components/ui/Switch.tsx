'use client'

import { useId, type ReactNode } from 'react'
import { cx } from './cx.ts'

/** 켜고 끄는 스위치. 색만으로 말하지 않도록 옆에 "켬/끔" 글자가 함께 보인다. */
export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: ReactNode; disabled?: boolean }) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p id={`${id}-label`} className="text-[15px] font-medium text-ink">
          {label}
        </p>
        {description ? (
          <p id={`${id}-desc`} className="mt-0.5 text-[13px] text-ink-3">
            {description}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-desc` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="flex h-10 shrink-0 items-center gap-2 rounded-control px-1 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className={cx('w-6 text-right text-[13px] font-medium', checked ? 'text-accent-ink' : 'text-ink-3')}>{checked ? '켬' : '끔'}</span>
        <span className={cx('relative h-6 w-10 rounded-full transition-colors duration-150', checked ? 'bg-accent' : 'bg-field-line')}>
          <span className={cx('absolute left-0.5 top-0.5 size-5 rounded-full bg-white transition-transform duration-150', checked && 'translate-x-4')} />
        </span>
      </button>
    </div>
  )
}
