import { Film, Plus, Upload } from 'lucide-react'
import { Badge } from '../components/ui/Badge.tsx'
import { Button } from '../components/ui/Button.tsx'
import { Card } from '../components/ui/Card.tsx'
import { EmptyState } from '../components/ui/EmptyState.tsx'
import { Field, Input, Textarea } from '../components/ui/Field.tsx'
import { Skeleton } from '../components/ui/Skeleton.tsx'
import { Spinner } from '../components/ui/Spinner.tsx'
import { Steps } from '../components/ui/Steps.tsx'

// 임시 견본 — 공용 컴포넌트의 모든 상태를 눈으로 확인하는 용도. Task 9 에서 기록 화면으로 바뀐다.
export default function Sampler() {
  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-[22px] font-semibold leading-tight">컴포넌트 견본</h1>

      <Card title="타임라인 눈금자" description="단계 · 진행 상태별 모습">
        <div className="flex flex-col gap-6">
          <Steps current={1} state="busy" />
          <Steps current={2} state="waiting" />
          <Steps current={4} state="failed" />
          <Steps current={5} state="done" />
          <div className="flex flex-col gap-3 border-t border-line pt-4">
            <div className="max-w-60"><Steps current={3} state="busy" compact /></div>
            <div className="max-w-60"><Steps current={2} state="waiting" compact /></div>
          </div>
        </div>
      </Card>

      <Card title="버튼" action={<Button size="sm" variant="ghost">보조 행동</Button>}>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" icon={<Plus size={18} strokeWidth={1.75} />}>새 영상 만들기</Button>
          <Button variant="primary" loading>만드는 중</Button>
          <Button variant="primary" disabled>비활성</Button>
          <Button>보통</Button>
          <Button variant="ghost">조용한 버튼</Button>
          <Button variant="danger">삭제</Button>
          <Button size="sm" icon={<Upload size={16} strokeWidth={1.75} />}>작은 버튼</Button>
        </div>
      </Card>

      <Card title="배지">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>게시물 영상용(가로)</Badge>
          <Badge tone="accent">릴스·숏츠용(세로)</Badge>
          <Badge tone="ok">통과</Badge>
          <Badge tone="warn">확인 필요</Badge>
          <Badge tone="bad">실패</Badge>
          <Badge tone="info">참고</Badge>
          <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-2"><Spinner size={14} />분석 중</span>
        </div>
      </Card>

      <Card title="입력">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="레퍼런스 링크" optional hint="유튜브·인스타 링크를 붙여 넣어도 돼요">{(p) => <Input {...p} placeholder="https://" />}</Field>
          <Field label="링크" error="http 로 시작하는 링크를 넣어 주세요">{(p) => <Input {...p} defaultValue="abc" />}</Field>
          <Field label="영상 설명" optional className="sm:col-span-2">{(p) => <Textarea {...p} placeholder="예: 롱아이언 스윙 레슨, 체중 이동이 핵심" />}</Field>
        </div>
      </Card>

      <Card title="불러오는 중">
        <div className="flex items-center gap-4">
          <Skeleton className="h-16 w-28" />
          <div className="flex flex-col gap-2"><Skeleton className="h-4 w-56" /><Skeleton className="h-3 w-36" /></div>
        </div>
      </Card>

      <Card>
        <EmptyState icon={<Film size={32} strokeWidth={1.5} />} title="아직 만든 영상이 없어요" description="영상을 하나 올리면 레퍼런스에 맞춰 자동으로 편집해 드려요." action={<Button variant="primary" icon={<Plus size={18} strokeWidth={1.75} />}>새 영상 만들기</Button>} />
      </Card>
    </div>
  )
}
