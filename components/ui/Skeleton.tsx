import { cx } from './cx.ts'

/** 불러오는 동안 자리를 잡아 두는 막대·상자. 내용이 들어올 크기로 className 을 준다. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx('rounded-chip bg-sunken [animation:skeleton-pulse_1.6s_ease-in-out_infinite]', className)} />
}
