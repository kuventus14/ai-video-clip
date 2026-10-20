import type { ReactNode } from 'react'
import { cx } from './cx.ts'

/** 패널. 테두리 1px 하나로만 높이를 말한다. 카드 안에 카드를 넣지 않는다. */
export function Card({ title, description, action, children, className, bodyClassName }: { title?: ReactNode; description?: ReactNode; action?: ReactNode; children?: ReactNode; className?: string; bodyClassName?: string }) {
  const hasHeader = title || description || action
  return (
    <section className={cx('rounded-panel border border-line bg-panel', className)}>
      {hasHeader ? (
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            {title ? <h2 className="text-[17px] font-semibold leading-snug text-ink">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-[13px] text-ink-2">{description}</p> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </header>
      ) : null}
      {children !== undefined && children !== null ? <div className={cx('px-5 py-4', bodyClassName)}>{children}</div> : null}
    </section>
  )
}
