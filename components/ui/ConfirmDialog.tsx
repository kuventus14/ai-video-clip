'use client'

import { CircleAlert } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { Button } from './Button.tsx'

/**
 * 되돌릴 수 없는 동작을 한 번 더 묻는다. 브라우저 기본 <dialog> 라서 포커스가 안에 갇히고, Esc 로 닫히고,
 * 닫으면 눌렀던 버튼으로 포커스가 돌아간다. 처음 포커스는 취소 버튼에 있다(실수로 Enter 를 눌러도 지워지지 않게).
 */
export function ConfirmDialog({ open, title, description, confirmLabel, busy = false, error, onConfirm, onCancel }: { open: boolean; title: string; description?: ReactNode; confirmLabel: string; busy?: boolean; error?: string | null; onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-title"
      onCancel={(e) => {
        e.preventDefault() // 닫는 일은 부모 상태가 한다
        if (!busy) onCancel()
      }}
      onClick={(e) => {
        if (e.target === ref.current && !busy) onCancel()
      }}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-panel border border-line bg-panel p-0 text-ink shadow-float backdrop:bg-black/50"
    >
      <div className="px-5 pb-2 pt-5">
        <h2 id="confirm-title" className="text-[17px] font-semibold leading-snug">
          {title}
        </h2>
        {description ? <div className="mt-2 text-[15px] text-ink-2">{description}</div> : null}
        {error ? (
          <p role="alert" className="mt-3 flex items-start gap-1.5 text-[13px] font-medium text-bad">
            <CircleAlert size={16} strokeWidth={1.75} className="mt-px shrink-0" aria-hidden="true" />
            {error}
          </p>
        ) : null}
      </div>
      <div className="flex justify-end gap-2 px-5 pb-5 pt-4">
        <Button autoFocus onClick={onCancel} disabled={busy}>
          취소
        </Button>
        <Button variant="danger" onClick={onConfirm} loading={busy}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  )
}
