import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '영상 편집',
  description: '레퍼런스를 따라 영상을 자동으로 편집해요',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  )
}
