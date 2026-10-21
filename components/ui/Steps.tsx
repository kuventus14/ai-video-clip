import { STEPS } from '../../src/ui/format.ts'
import { cx } from './cx.ts'

/**
 * 작업의 진행을 편집기의 타임라인처럼 그린다: 단계는 "장(chapter)", 끝난 구간은 호박색으로 채워지고, 지금 구간에 재생헤드가 선다.
 *  - busy: 워커가 하는 중 — 헤드가 구간 안을 계속 달린다(움직임 줄이기 설정이면 가운데에 멈춘다)
 *  - waiting: 내가 할 차례 — 헤드가 구간 시작에 멈춰 있다
 *  - failed: 이 구간에서 멈췄다(헤드가 붉어진다)
 *  - done: 모두 끝났다(헤드 없음)
 * compact 는 목록 행용으로 글자 없이 눈금자만 그린다.
 */
export type StepsState = 'busy' | 'waiting' | 'done' | 'failed'

const NOTE: Record<StepsState, string> = { busy: '진행 중', waiting: '내 차례', failed: '멈춤', done: '끝' }

// 색 클래스는 한 줄에 하나만 둔다(Tailwind 는 클래스 순서가 아니라 CSS 순서로 이기기 때문).
function labelClass(segment: 'done' | 'current' | 'failed' | 'todo', isCurrent: boolean, state: StepsState): string {
  if (isCurrent) return state === 'failed' ? 'font-semibold text-bad' : 'font-semibold text-ink'
  return segment === 'todo' ? 'text-ink-3' : 'text-ink-2'
}

export function Steps({ current, state, compact = false, className }: { current: number; state: StepsState; compact?: boolean; className?: string }) {
  const segmentState = (i: number): 'done' | 'current' | 'failed' | 'todo' => {
    if (state === 'done' || i < current) return 'done'
    if (i === current) return state === 'failed' ? 'failed' : 'current'
    return 'todo'
  }

  const segments = STEPS.map((label, i) => {
    const s = segmentState(i)
    const isCurrent = i === current && state !== 'done'
    return (
      <li key={label} data-state={s} aria-current={isCurrent ? 'step' : undefined} className="min-w-0">
        <div className={cx('tp-seg', i === 0 && 'rounded-l-full', i === STEPS.length - 1 && 'rounded-r-full', compact && '!h-[3px]')} data-state={s}>
          {isCurrent ? <span aria-hidden="true" className="playhead" data-tone={state === 'failed' ? 'bad' : undefined} data-motion={state === 'busy' ? 'run' : 'rest'} /> : null}
        </div>
        {compact ? null : (
          <>
            <div aria-hidden="true" className="tp-ticks" />
            <div className={cx('mt-1.5 flex items-baseline gap-1.5 pr-1 text-[12px] leading-tight sm:text-[13px]', labelClass(s, isCurrent, state))}>
              <span className="hidden tabular-nums opacity-60 sm:inline" aria-hidden="true">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span>
                {label}
                {isCurrent ? <span className="sr-only"> ({NOTE[state]})</span> : s === 'done' ? <span className="sr-only"> (끝)</span> : null}
              </span>
            </div>
          </>
        )}
      </li>
    )
  })

  const ruler = (
    <ol aria-label={compact ? undefined : '진행 단계'} aria-hidden={compact || undefined} className={cx('tp grid list-none grid-cols-6 p-0', compact ? 'pt-1' : 'pt-3', !compact && className)}>
      {segments}
    </ol>
  )
  if (!compact) return ruler
  // 목록 행에서는 눈금자 전체를 한 문장으로 읽어 준다(여섯 칸을 하나씩 읽으면 행마다 너무 길다)
  const spoken = state === 'done' ? '모든 단계 끝' : `${STEPS[current]} 단계, ${NOTE[state]}`
  return (
    <div role="img" aria-label={spoken} className={className}>
      {ruler}
    </div>
  )
}
