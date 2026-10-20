import type { Metadata, Viewport } from 'next'
import { AppHeader } from '../components/AppHeader.tsx'
import './globals.css'

export const metadata: Metadata = {
  title: '영상 편집',
  description: '레퍼런스를 따라 영상을 자동으로 편집해요',
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0f1b3d' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0f1f' },
  ],
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <AppHeader />
        <main className="mx-auto w-full max-w-[1120px] px-4 py-8 sm:px-6">{children}</main>
      </body>
    </html>
  )
}
