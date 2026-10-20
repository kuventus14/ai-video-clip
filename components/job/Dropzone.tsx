'use client'

import { CircleAlert, UploadCloud } from 'lucide-react'
import { useState } from 'react'
import { VIDEO_EXTS } from '../../src/shared/media.ts'
import { cx } from '../ui/cx.ts'

const ACCEPT = [...VIDEO_EXTS, 'video/*'].join(',')

/** 영상을 고르거나 끌어다 놓는 영역. 입력은 보이지 않게 두고 라벨 전체가 버튼처럼 눌리며, 키보드 포커스는 영역 테두리로 보인다. */
export function Dropzone({ onFile, error }: { onFile: (file: File) => void; error?: string | null }) {
  const [over, setOver] = useState(false)
  return (
    <div className="flex flex-col gap-2">
      <label
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          const file = e.dataTransfer.files[0]
          if (file) onFile(file)
        }}
        className={cx(
          'flex cursor-pointer flex-col items-center gap-3 rounded-panel border-2 border-dashed px-6 py-12 text-center transition-colors duration-150',
          over ? 'border-accent bg-accent-soft' : 'border-field-line hover:bg-sunken/60',
          'has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ring',
        )}
      >
        <input
          type="file"
          accept={ACCEPT}
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onFile(file)
            e.target.value = '' // 같은 파일을 다시 골라도 change 가 오도록
          }}
        />
        <UploadCloud size={32} strokeWidth={1.5} className={over ? 'text-accent-ink' : 'text-ink-3'} aria-hidden="true" />
        <div>
          <p className="text-[17px] font-semibold text-ink">{over ? '여기에 놓으면 올라가요' : '영상을 여기로 끌어다 놓으세요'}</p>
          <p className="mt-1 text-[15px] text-ink-2">
            또는 <span className="font-semibold text-accent-ink underline underline-offset-2">파일 고르기</span>
          </p>
        </div>
        <p className="text-[13px] text-ink-3">{VIDEO_EXTS.map((e) => e.slice(1)).join(' · ')} · 1초 이상 10분 이하</p>
      </label>
      {error ? (
        <p role="alert" className="flex items-start gap-1.5 text-[13px] font-medium text-bad">
          <CircleAlert size={16} strokeWidth={1.75} className="mt-px shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </div>
  )
}
