'use client'

import { CircleAlert, ArrowUp } from 'lucide-react'
import { useState } from 'react'
import { VIDEO_EXTS } from '../../src/shared/media.ts'
import { cx } from '../ui/cx.ts'

const ACCEPT = [...VIDEO_EXTS, 'video/*'].join(',')

/**
 * 영상을 고르거나 끌어다 놓는 무대. 입력은 보이지 않게 두고 라벨 전체가 버튼처럼 눌린다.
 * 영상을 끌어오면 뷰파인더 괄호가 안쪽으로 조여들며 호박색이 되고, 키보드 포커스는 무대 테두리로 보인다.
 */
export function Dropzone({ onFile, error }: { onFile: (file: File) => void; error?: string | null }) {
  const [over, setOver] = useState(false)
  return (
    <div className="flex flex-col gap-3">
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
        data-active={over ? 'true' : 'false'}
        className={cx(
          'vf group flex min-h-[340px] cursor-pointer flex-col items-center justify-center gap-5 rounded-panel bg-stage px-6 py-14 text-center transition-colors duration-300 sm:min-h-[420px]',
          over ? 'bg-[#0c0a04]' : 'hover:bg-[#0c0c0e]',
          'has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-4 has-[input:focus-visible]:outline-ring',
        )}
      >
        <span className="vf-c" data-p="tl" aria-hidden="true" />
        <span className="vf-c" data-p="tr" aria-hidden="true" />
        <span className="vf-c" data-p="bl" aria-hidden="true" />
        <span className="vf-c" data-p="br" aria-hidden="true" />
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
        <span className={cx('grid size-16 place-items-center rounded-full transition-colors duration-300', over ? 'bg-accent text-accent-deep' : 'bg-lift text-ink')} style={{ animation: 'dz-float 2.4s var(--ease-in-out) infinite alternate' }} aria-hidden="true">
          <ArrowUp size={28} strokeWidth={2} />
        </span>
        <div>
          <p className="text-[24px] font-bold leading-snug tracking-[-0.025em] text-ink sm:text-[28px]">{over ? '놓으면 올라가요' : '영상을 여기로 끌어다 놓으세요'}</p>
          <p className="mt-2 text-[16px] text-ink-2">
            또는 <span className="font-semibold text-accent-ink underline decoration-accent/50 underline-offset-4 transition-colors group-hover:decoration-accent">파일 고르기</span>
          </p>
        </div>
        <p className="text-[13px] text-ink-3">{VIDEO_EXTS.map((e) => e.slice(1)).join(' · ')} · 1초 이상 10분 이하</p>
      </label>
      {error ? (
        <p role="alert" className="flex items-start gap-1.5 text-[13px] font-medium text-bad">
          <CircleAlert size={16} strokeWidth={2} className="mt-px shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </div>
  )
}
