import type { StageVisual } from '../../src/ui/format.ts'
import { cx } from '../ui/cx.ts'

const BAR_COUNT = 44
// 막대 높이는 계산해서 정해 둔다(고정 값이라 렌더가 늘 같고, 움직임을 끈 화면에서도 이퀄라이저 모양으로 남는다)
const BARS = Array.from({ length: BAR_COUNT }, (_, i) => {
  const hi = 0.3 + 0.7 * Math.abs(Math.sin(i * 0.61) * Math.cos(i * 0.23 + 1))
  return { hi: Number(hi.toFixed(2)), delay: Number(((i * 0.083) % 1.4).toFixed(2)), dur: Number((0.9 + ((i * 7) % 5) * 0.13).toFixed(2)) }
})

function Wave() {
  return (
    <div className="absolute inset-x-[8%] top-1/2 flex h-[46%] -translate-y-1/2 items-center justify-between gap-[3px]">
      {BARS.map((b, i) => (
        <span key={i} className="h-full w-full max-w-[7px] origin-center rounded-full bg-accent" style={{ transform: `scaleY(${b.hi})`, animation: `sg-wave ${b.dur}s ease-in-out ${b.delay}s infinite alternate`, ['--lo' as string]: 0.1, ['--hi' as string]: b.hi }} />
      ))}
      <span className="absolute inset-x-0 top-1/2 h-px bg-ink/20" />
    </div>
  )
}

function Scan() {
  return (
    <>
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute inset-x-0 h-0.5 bg-accent shadow-[0_0_24px_4px_rgb(255_178_36/0.55)]" style={{ animation: 'sg-scan 2.8s var(--ease-in-out) infinite alternate' }} />
      </div>
      <div className="absolute inset-[14%] grid grid-cols-6 grid-rows-4 gap-2">
        {Array.from({ length: 24 }, (_, i) => (
          <span key={i} className="rounded-[4px] border border-ink/25" style={{ animation: `sg-cell 3.2s ease-in-out ${((i * 37) % 24) * 0.13}s infinite` }} />
        ))}
      </div>
    </>
  )
}

function Probe() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      {[0, 1, 2].map((i) => (
        <div key={i} className="absolute inset-x-0 h-px bg-accent/80" style={{ animation: `sg-scan 1.6s linear ${i * 0.5}s infinite` }} />
      ))}
    </div>
  )
}

/** 필름 띠: 프레임과 스프로킷 구멍이 이어져 흘러간다 */
function Strip() {
  const frame = (key: number) => (
    <div key={key} className="relative h-full w-[132px] shrink-0 border-x-[6px] border-ink/10 bg-ink/[0.07]">
      <span className="absolute inset-x-3 top-3 h-[3px] rounded-full bg-ink/20" />
      <span className="absolute inset-x-3 bottom-3 h-[3px] rounded-full bg-ink/20" />
      <span className="absolute inset-x-5 inset-y-8 rounded-[6px] border border-ink/30" />
    </div>
  )
  return (
    <div className="absolute inset-x-0 top-1/2 h-[46%] -translate-y-1/2 overflow-hidden">
      <div className="flex h-full w-[200%]" style={{ animation: 'sg-strip 6s linear infinite' }}>
        {Array.from({ length: 24 }, (_, i) => frame(i))}
      </div>
      <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-accent" />
    </div>
  )
}

/** 편집 계획: 세 레인에 블록이 차례로 자라고, 재생헤드가 훑고 지나간다 */
function Cuts() {
  const lanes = [
    { label: '영상', blocks: [[2, 28], [32, 22], [58, 16], [78, 20]] },
    { label: '자막', blocks: [[6, 14], [24, 18], [46, 12], [64, 24]] },
    { label: '제목', blocks: [[2, 16]] },
  ]
  return (
    <div className="absolute inset-x-[7%] top-1/2 -translate-y-1/2">
      <div className="relative flex flex-col gap-3">
        {lanes.map((lane, li) => (
          <div key={lane.label} className="flex items-center gap-3">
            <span className="w-8 shrink-0 text-[11px] font-medium text-ink/60">{lane.label}</span>
            <div className="relative h-7 flex-1 rounded-[6px] bg-ink/[0.06]">
              {lane.blocks.map(([x, w], bi) => (
                <span key={bi} className="absolute inset-y-1 origin-left rounded-[4px] bg-ink/70" style={{ left: `${x}%`, width: `${w}%`, animation: `sg-cut 3.6s var(--ease-expo) ${(li * 4 + bi) * 0.22}s infinite alternate` }} />
              ))}
            </div>
          </div>
        ))}
        <span className="absolute -inset-y-3 left-11 right-0">
          <span className="absolute inset-y-0 w-0.5 bg-accent shadow-[0_0_14px_2px_rgb(255_178_36/0.5)]" style={{ animation: 'playhead-run 3.6s linear infinite' }} />
        </span>
      </div>
    </div>
  )
}

/** 렌더링: 프레임 칸이 차례로 켜진다(몇 퍼센트인지는 모르므로 끝없이 도는 모양으로만 보인다) */
function Frames() {
  const cells = 36
  return (
    <div className="absolute inset-x-[7%] top-1/2 -translate-y-1/2">
      <div className="grid grid-cols-12 gap-2">
        {Array.from({ length: cells }, (_, i) => (
          <span key={i} className="aspect-video rounded-[4px] bg-accent" style={{ animation: `sg-cell 3.6s ease-in-out ${i * 0.1}s infinite` }} />
        ))}
      </div>
    </div>
  )
}

function Checks() {
  const items = ['자막 오타', '화질', '검은 화면', '소리', '구도']
  return (
    <ul className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col gap-3">
      {items.map((label, i) => (
        <li key={label} className="flex items-center gap-3 text-[15px] font-medium text-ink">
          <span className="grid size-6 place-items-center rounded-full bg-accent text-accent-deep" style={{ animation: `sg-tick 5s var(--ease-expo) ${i * 0.7}s infinite` }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M3 7.5l2.5 2.5L11 4.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          {label}
        </li>
      ))}
    </ul>
  )
}

/** 순서 대기: 필름 리더처럼 도는 원 */
function Leader() {
  return (
    <svg viewBox="0 0 120 120" className="absolute left-1/2 top-1/2 size-[34%] max-h-[220px] -translate-x-1/2 -translate-y-1/2 text-ink" fill="none" aria-hidden="true">
      <circle cx="60" cy="60" r="52" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <circle cx="60" cy="60" r="36" stroke="currentColor" strokeOpacity="0.15" strokeWidth="2" />
      <path d="M6 60h108M60 6v108" stroke="currentColor" strokeOpacity="0.2" strokeWidth="1" />
      <g style={{ transformOrigin: '60px 60px', animation: 'sg-spin 2.4s linear infinite' }}>
        <path d="M60 8a52 52 0 0 1 52 52" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
      </g>
      <circle cx="60" cy="60" r="3.5" fill="var(--accent)" style={{ animation: 'sg-blink 1.2s ease-in-out infinite' }} />
    </svg>
  )
}

/**
 * 진행 중인 단계를 보여 주는 모션 그래픽 무대. 원본 영상의 한 장면을 어둡게 깔고 그 위에 단계별 그림이 움직인다
 * (음성 인식=파형, 영상 이해=스캔, 레퍼런스 분석=필름 띠, 편집 계획=타임라인 블록, 렌더링=프레임 칸, 검수=점검표, 순서 대기=리더).
 * 진행률은 알 수 없으므로 끝없이 도는 모양으로만 보이고, 장식이라 화면 낭독기에는 숨긴다.
 */
export function StageGraphic({ visual, thumb, elapsed, className }: { visual: StageVisual; thumb?: string; elapsed: string; className?: string }) {
  return (
    <div className={cx('vf relative aspect-video w-full overflow-hidden rounded-panel bg-stage', className)} data-active="true" aria-hidden="true">
      {thumb ? (
        <>
          {/* 흐린 배경 + 또렷한 원본 장면: 세로 영상도 가로 무대를 꽉 채운다 */}
          <img src={thumb} alt="" className="absolute inset-0 size-full scale-125 object-cover opacity-30 blur-2xl" />
          <img src={thumb} alt="" className="absolute inset-0 size-full object-contain opacity-40" style={{ animation: 'vf-breathe 6s ease-in-out infinite' }} />
        </>
      ) : null}
      <span className="absolute inset-0 bg-stage/45" />
      {visual === 'listen' ? <Wave /> : null}
      {visual === 'watch' ? <Scan /> : null}
      {visual === 'probe' ? <Probe /> : null}
      {visual === 'reference' ? <Strip /> : null}
      {visual === 'plan' ? <Cuts /> : null}
      {visual === 'render' ? <Frames /> : null}
      {visual === 'qa' ? <Checks /> : null}
      {visual === 'wait' ? <Leader /> : null}
      <span className="vf-c" data-p="tl" />
      <span className="vf-c" data-p="tr" />
      <span className="vf-c" data-p="bl" />
      <span className="vf-c" data-p="br" />
      <span className="absolute right-6 top-5 flex items-center gap-2 text-[15px] font-semibold tracking-wider text-accent tnum">
        <span style={{ animation: 'sg-blink 1.6s steps(1) infinite' }}>●</span>
        {elapsed}
      </span>
    </div>
  )
}
