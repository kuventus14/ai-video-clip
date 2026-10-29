// node 모듈을 가져오지 않는 순수 파일 — 화면(클라이언트)도 같은 범위를 쓴다

/** 배경음악·효과음 크기를 기본 규칙에서 얼마나 키우거나 줄일지(dB). 화면 슬라이더와 서버 검사가 같은 범위를 쓴다. */
export const SOUND_GAIN_RANGE = { min: -12, max: 6 } as const

/** 숫자가 아니면 0, 범위 밖은 끝값으로 자르고 0.5 단위로 반올림한다. */
export function clampGainDb(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0
  const r = Math.round(Math.min(SOUND_GAIN_RANGE.max, Math.max(SOUND_GAIN_RANGE.min, n)) * 2) / 2
  return r === 0 ? 0 : r // -0 을 0 으로
}
