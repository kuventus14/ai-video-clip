import { Plus } from 'lucide-react'
import Link from 'next/link'
import { HistoryList } from '../components/job/HistoryList.tsx'
import { buttonClass } from '../components/ui/Button.tsx'

export default function HomePage() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-[22px] font-semibold leading-tight">내 영상</h1>
        <Link href="/new" className={buttonClass('primary')}>
          <Plus size={18} strokeWidth={1.75} aria-hidden="true" />
          새 영상 만들기
        </Link>
      </div>
      <HistoryList />
    </div>
  )
}
