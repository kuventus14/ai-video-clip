import type { SfxRole, SfxTrack } from '../shared/sound.ts'
import type { Span } from './types.ts'

/** 효과음 사이 최소 간격 — 컷이 아주 많은 영상에서도 정신없지 않게 한다. */
export const SFX_MIN_GAP_SEC = 2
/** 컷 효과음은 경계보다 조금 앞에서 시작해 화면이 바뀔 때 소리가 이미 올라와 있게 한다. */
export const SFX_CUT_LEAD_SEC = 0.15
export const SFX_HOOK_AT_SEC = 0.1
/** 영상 끝에서 이 시간 안에는 효과음을 넣지 않는다(끝이 잘리거나 어색해진다). */
export const SFX_END_MARGIN_SEC = 0.3

export interface SfxEvent {
  /** 출력(컷 이후) 시간 기준 */
  atSec: number
  trackId: string
  role: SfxRole
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6

/**
 * 효과음 위치: 제목 카드가 나올 때 pop, 남은 구간 사이 경계마다 whoosh. 이웃 이벤트와 2초 안이면 뒤의 것을 버리고,
 * 영상 끝 0.3초 안·0초 앞은 버린다. 같은 역할 파일이 여럿이면 이벤트 순서대로 돌려 쓴다(같은 입력 → 같은 결과).
 */
export function planSfx(i: { kept: Span[]; hookTitle: boolean; sfx: SfxTrack[] }): SfxEvent[] {
  const total = i.kept.reduce((s, k) => s + (k.end - k.start), 0)
  const tracksOf = (role: SfxRole) => i.sfx.filter((t) => t.role === role)

  const wanted: { atSec: number; role: SfxRole }[] = []
  if (i.hookTitle && tracksOf('pop').length) wanted.push({ atSec: SFX_HOOK_AT_SEC, role: 'pop' })
  if (tracksOf('whoosh').length) {
    let acc = 0
    for (const k of i.kept.slice(0, -1)) {
      acc += k.end - k.start
      wanted.push({ atSec: round6(acc - SFX_CUT_LEAD_SEC), role: 'whoosh' })
    }
  }

  const out: SfxEvent[] = []
  const used: Partial<Record<SfxRole, number>> = {}
  for (const w of wanted.sort((a, b) => a.atSec - b.atSec)) {
    if (w.atSec < 0 || w.atSec > total - SFX_END_MARGIN_SEC) continue
    const prev = out.at(-1)
    if (prev && w.atSec - prev.atSec < SFX_MIN_GAP_SEC - 1e-9) continue
    const pool = tracksOf(w.role)
    const n = used[w.role] ?? 0
    used[w.role] = n + 1
    out.push({ atSec: w.atSec, role: w.role, trackId: pool[n % pool.length]!.id })
  }
  return out
}
