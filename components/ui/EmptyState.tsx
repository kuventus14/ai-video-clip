import type { ReactNode } from 'react'
import { cx } from './cx.ts'

/** 비어 있는 곳에서 다음에 무엇을 하면 되는지 알려 준다. 뷰파인더 괄호가 빈 화면을 "찍을 준비가 된 프레임"으로 보이게 한다. */
export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('vf flex flex-col items-center gap-4 px-6 py-14 text-center', className)} data-active="true">
      <span className="vf-c" data-p="tl" aria-hidden="true" />
      <span className="vf-c" data-p="tr" aria-hidden="true" />
      <span className="vf-c" data-p="bl" aria-hidden="true" />
      <span className="vf-c" data-p="br" aria-hidden="true" />
      {icon ? <div className="text-ink-3">{icon}</div> : null}
      <div className="max-w-md">
        <p className="text-[19px] font-semibold tracking-tight text-ink">{title}</p>
        {description ? <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">{description}</p> : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}
