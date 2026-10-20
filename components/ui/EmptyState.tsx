import type { ReactNode } from 'react'
import { cx } from './cx.ts'

/** 비어 있는 곳에서 다음에 무엇을 하면 되는지 알려 준다. icon 은 lucide 아이콘 요소. */
export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-col items-center gap-3 px-6 py-12 text-center', className)}>
      {icon ? <div className="text-ink-3">{icon}</div> : null}
      <div className="max-w-md">
        <p className="text-[17px] font-semibold text-ink">{title}</p>
        {description ? <p className="mt-1 text-[15px] text-ink-2">{description}</p> : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}
