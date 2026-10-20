import { JobView } from '../../../components/job/JobView.tsx'

export const metadata = { title: '작업 · 영상 편집' }

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <JobView id={id} />
}
