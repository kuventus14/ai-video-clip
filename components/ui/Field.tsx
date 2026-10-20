import { CircleAlert } from 'lucide-react'
import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
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
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-ink">
        {label}
        {optional ? <span className="ml-1.5 font-normal text-ink-3">선택</span> : null}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hint ? (
        <p id={hintId} className="text-[13px] text-ink-3">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 text-[13px] font-medium text-bad">
          <CircleAlert size={16} strokeWidth={1.75} className="mt-px shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </div>
  )
}

const CONTROL =
  'w-full rounded-control border border-field-line bg-panel px-3 text-[15px] text-ink placeholder:text-ink-3 transition-colors duration-150 ' +
  'hover:border-ink-3 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-bad'

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(CONTROL, 'h-10', className)} {...rest} />
}

export function Textarea({ className, rows = 3, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={rows} className={cx(CONTROL, 'resize-y py-2 leading-relaxed', className)} {...rest} />
}
