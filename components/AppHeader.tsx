'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cx } from './ui/cx.ts'

const LINKS = [
  { href: '/new', label: '새 영상', active: (p: string) => p === '/new' },
  { href: '/', label: '기록', active: (p: string) => p !== '/new' },
]

/** 재생헤드 모양의 앱 표식 — 눈금자의 재생헤드와 같은 모양이다. */
function Mark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="1.5" y="13" width="17" height="3" rx="1.5" fill="currentColor" opacity="0.35" />
      <path d="M10 6v10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M6.5 3h7L10 7.5z" fill="currentColor" />
    </svg>
  )
}

export function AppHeader() {
  const pathname = usePathname()
  return (
    <header className="bg-shell text-shell-ink">
      <div className="mx-auto flex h-14 max-w-[1120px] items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 rounded-control text-[17px] font-semibold tracking-tight text-shell-ink focus-visible:outline-shell-ink">
          <Mark />
          영상 편집
        </Link>
        <nav aria-label="주요 메뉴" className="flex h-full items-stretch gap-1">
          {LINKS.map((l) => {
            const active = l.active(pathname)
            return (
              <Link key={l.href} href={l.href} aria-current={active ? 'page' : undefined} className={cx('relative flex items-center px-3 text-[15px] transition-colors duration-150 hover:text-shell-ink focus-visible:outline-shell-ink', active ? 'font-medium text-shell-ink' : 'text-shell-ink-2')}>
                {l.label}
                {active ? <span aria-hidden="true" className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-shell-ink" /> : null}
              </Link>
            )
          })}
        </nav>
      </div>
    </header>
  )
}
