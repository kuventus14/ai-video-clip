import { cx } from './cx.ts'

/** 돌아가는 원. 움직임 줄이기 설정에서는 멈춘 호로 보인다. label 은 화면 낭독기용(보이지 않음). */
export function Spinner({ size = 16, label, className }: { size?: number; label?: string; className?: string }) {
  return (
    <span role={label ? 'status' : undefined} className={cx('inline-flex shrink-0 items-center', className)}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" className="animate-spin motion-reduce:animate-none">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  )
}
