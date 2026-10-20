import type { ReactNode } from 'react'

/**
 * 화면 아래에 떠 있는 행동 막대 — 긴 폼에서도 주 행동이 항상 보인다. 오류는 막대 안에, 못 누르는 이유(hint)는 버튼 옆에 둔다.
 * children 에는 버튼을 넣는다(주 행동은 하나).
 */
export function ActionBar({ error, hint, children }: { error?: string | null; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="sticky bottom-3 z-10 flex flex-col gap-2 rounded-panel border border-line bg-panel px-4 py-3 shadow-float">
      {error ? (
        <p role="alert" className="text-[13px] font-medium text-bad">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
        {hint ? <p className="text-[13px] text-ink-3">{hint}</p> : null}
        <div className="flex items-center gap-2">{children}</div>
      </div>
    </div>
  )
}
