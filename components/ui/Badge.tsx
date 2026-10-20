import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { cx } from './cx.ts'

export type BadgeTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'bad' | 'info'

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-sunken text-ink-2',
  accent: 'bg-accent-soft text-accent-ink',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
  info: 'bg-info-soft text-info',
}

// 상태 색은 색만으로 말하지 않는다 — 통과·주의·오류·참고는 아이콘이 함께 붙는다.
const DEFAULT_ICON: Partial<Record<BadgeTone, typeof Info>> = { ok: CircleCheck, warn: TriangleAlert, bad: CircleAlert, info: Info }

export function Badge({ tone = 'neutral', icon, children, className }: { tone?: BadgeTone; icon?: ReactNode | false; children: ReactNode; className?: string }) {
  const Default = DEFAULT_ICON[tone]
  const glyph = icon === false ? null : (icon ?? (Default ? <Default size={14} strokeWidth={1.75} aria-hidden="true" /> : null))
  return (
    <span className={cx('inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-chip px-2 text-[12px] font-medium leading-none', TONE[tone], className)}>
      {glyph}
      {children}
    </span>
  )
}
