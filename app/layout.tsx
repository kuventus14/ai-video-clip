import type { Metadata, Viewport } from 'next'
import { AppHeader } from '../components/AppHeader.tsx'
import './globals.css'

export const metadata: Metadata = {
  title: '영상 편집',
  description: '레퍼런스를 따라 영상을 자동으로 편집해요',
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#09090a',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <AppHeader />
        <main className="mx-auto w-full max-w-[1240px] px-4 pb-24 pt-6 sm:px-8 sm:pt-10">{children}</main>
      </body>
    </html>
  )
}
