'use client'

import type { JobDto } from '../../src/shared/types.ts'
import { LOW_CONFIDENCE, purposeNote } from '../../src/ui/format.ts'
import { cx } from '../ui/cx.ts'
import { Segmented } from '../ui/Segmented.tsx'

export type PurposeChoice = 'auto' | 'post' | 'short'

const shortPurpose = (p: 'post' | 'short') => (p === 'post' ? '게시물 영상용' : '릴스·숏츠용')

/** 용도(자동 인식·게시물 영상용·릴스/숏츠용) 선택과, 자동 인식 결과·이유를 알려 주는 한 줄. 직접 고른 값이 항상 우선이다. */
export function PurposeChooser({ value, onChange, guess, disabled }: { value: PurposeChoice; onChange: (v: PurposeChoice) => void; guess: JobDto['purposeGuess']; disabled?: boolean }) {
  const lowConfidence = guess !== null && guess.confidence < LOW_CONFIDENCE && value === 'auto'
  return (
    <div className="flex flex-col gap-3">
      <Segmented
        legend="용도 선택"
        value={value}
        onChange={onChange}
        disabled={disabled}
        options={[
          { value: 'auto', label: '자동 인식', hint: guess ? `→ ${shortPurpose(guess.purpose)}` : undefined },
          { value: 'post', label: '게시물 영상용', hint: '가로 16:9' },
          { value: 'short', label: '릴스·숏츠용', hint: '세로 9:16' },
        ]}
      />
      <p className={cx('text-[13px]', lowConfidence ? 'text-warn' : 'text-ink-3')} aria-live="polite">
        {purposeNote(value, guess)}
      </p>
    </div>
  )
}
