'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cx } from './ui/cx.ts'

const LINKS = [
  { href: '/new', label: '새 영상', active: (p: string) => p === '/new' },
  { href: '/', label: '기록', active: (p: string) => p !== '/new' },
]

/** 앱 표식: 영상 프레임을 가로지르는 재생헤드 — 마우스를 올리면 헤드가 프레임을 훑고 지나간다. */
function Mark() {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none" aria-hidden="true" className="overflow-visible">
      <rect x="3" y="6" width="24" height="18" rx="5" stroke="currentColor" strokeWidth="2" />
      <g className="[transform-box:fill-box] transition-transform duration-700 ease-[var(--ease-expo)] group-hover:translate-x-[10px] motion-reduce:transition-none">
        <path d="M9 2.5h6L12 6.5z" fill="var(--accent)" />
        <path d="M12 6v18" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
      </g>
    </svg>
  )
}

export function AppHeader() {
  const pathname = usePathname()
  return (
    <header className="bg-canvas">
      <div className="mx-auto flex h-[68px] max-w-[1240px] items-center gap-8 px-5 sm:px-8">
        <Link href="/" className="group flex items-center gap-2.5 rounded-control text-[19px] font-bold tracking-[-0.03em] text-ink">
          <Mark />
          영상 편집
        </Link>
        <nav aria-label="주요 메뉴" className="flex h-full items-stretch gap-1">
          {LINKS.map((l) => {
            const active = l.active(pathname)
            return (
              <Link key={l.href} href={l.href} aria-current={active ? 'page' : undefined} className={cx('relative flex items-center px-3.5 text-[15px] transition-colors duration-200 hover:text-ink', active ? 'font-semibold text-ink' : 'text-ink-2')}>
                {l.label}
                <span aria-hidden="true" className={cx('absolute inset-x-3.5 bottom-3 h-0.5 origin-left rounded-full bg-accent transition-transform duration-500 ease-[var(--ease-expo)]', active ? 'scale-x-100' : 'scale-x-0')} />
              </Link>
            )
          })}
        </nav>
      </div>
    </header>
  )
}
