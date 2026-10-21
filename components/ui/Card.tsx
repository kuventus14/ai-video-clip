import type { ReactNode } from 'react'
import { cx } from './cx.ts'

/** 패널. 테두리 없이 면의 밝기 단계(바탕 → 패널)로만 떠 보인다. 카드 안에 카드를 넣지 않는다. */
export function Card({ title, description, action, children, className, bodyClassName }: { title?: ReactNode; description?: ReactNode; action?: ReactNode; children?: ReactNode; className?: string; bodyClassName?: string }) {
  const hasHeader = title || description || action
  return (
    <section className={cx('rounded-panel bg-panel', className)}>
      {hasHeader ? (
        <header className="flex items-start justify-between gap-4 px-6 pb-1 pt-5">
          <div className="min-w-0">
            {title ? <h2 className="text-[17px] font-semibold leading-snug tracking-tight text-ink">{title}</h2> : null}
            {description ? <p className="mt-1 text-[14px] leading-relaxed text-ink-2">{description}</p> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </header>
      ) : null}
      {children !== undefined && children !== null ? <div className={cx('px-6 py-5', !!hasHeader && 'pt-4', bodyClassName)}>{children}</div> : null}
    </section>
  )
}
