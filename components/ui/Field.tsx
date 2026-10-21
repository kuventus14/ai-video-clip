import { CircleAlert } from 'lucide-react'
import { useId, type ComponentProps, type ReactNode } from 'react'
import { cx } from './cx.ts'

interface ControlProps {
  id: string
  'aria-describedby'?: string
  'aria-invalid'?: true
}

/**
 * 라벨·힌트·오류를 컨트롤과 연결한다. children 은 받은 속성(id, aria-describedby, aria-invalid)을 컨트롤에 펼쳐 준다.
 *   <Field label="설명" hint="선택">{(p) => <Textarea {...p} />}</Field>
 */
export function Field({ label, hint, error, optional, children, className }: { label: string; hint?: ReactNode; error?: string | null; optional?: boolean; children: (props: ControlProps) => ReactNode; className?: string }) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined
  return (
    <div className={cx('flex flex-col gap-2', className)}>
      <label htmlFor={id} className="text-[14px] font-semibold text-ink">
        {label}
        {optional ? (
          <>
            <span className="sr-only">, </span>
            <span className="ml-2 text-[13px] font-normal text-ink-3">선택</span>
          </>
        ) : null}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hint ? (
        <p id={hintId} className="text-[13px] text-ink-3">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 text-[13px] font-medium text-bad">
          <CircleAlert size={16} strokeWidth={2} className="mt-px shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </div>
  )
}

const CONTROL =
  'w-full rounded-control border border-field-line bg-raised px-4 text-[15px] text-ink placeholder:text-ink-3 transition-[border-color,background-color] duration-150 ' +
  'hover:border-[#85858f] focus:border-accent focus:bg-surface disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-bad'

export function Input({ className, ...rest }: ComponentProps<'input'>) {
  return <input className={cx(CONTROL, 'h-11', className)} {...rest} />
}

export function Textarea({ className, rows = 3, ...rest }: ComponentProps<'textarea'>) {
  return <textarea rows={rows} className={cx(CONTROL, 'resize-y py-3 leading-relaxed', className)} {...rest} />
}
