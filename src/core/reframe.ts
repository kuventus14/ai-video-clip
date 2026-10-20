import type { PersonBox, PersonTrack } from './person.ts'
import type { Canvas, CropKeyframe } from './types.ts'

export interface CropPath {
  /** 원본 시간 기준. centerX = 크롭 창 중심의 정규화 x */
  keyframes: CropKeyframe[]
  /** 크롭 창의 정규화 폭 (원본 폭 대비) */
  cropWidth: number
  /** 사람이 검출된 샘플의 비율 */
  coverage: number
  warnings: ('no-person' | 'low-coverage')[]
}

export interface Smoothing {
  /** 지수 이동의 시정수(초), 기본 0.6 */
  timeConstantSec?: number
  /** 이만큼(정규화) 벗어나야 크롭이 움직이기 시작한다, 기본 0.04 */
  deadband?: number
  /** 여러 명이 한 창에 들어가도 가장 큰 사람만 따른다 */
  preferLargest?: boolean
}

const MAX_SPEED = 0.4 // 크롭 창의 최대 이동 속도(정규화 원본 폭/초)
const HOLD_SEC = 1.5 // 검출이 끊겨도 마지막 위치를 유지하는 시간
const RETURN_SEC = 3 // 그 뒤 중앙으로 돌아오는 데 걸리는 시간
const MAX_KEYFRAMES_PER_SEC = 4
const LOW_COVERAGE = 0.3
const CUT_LEAD_SEC = 0.001

const area = (b: PersonBox) => b.w * b.h

/** 한 샘플에서 따라갈 x 중심. 몸이 있으면 몸, 없으면 얼굴. 없으면 null. */
function pickCenter(boxes: PersonBox[], cropWidth: number, preferLargest: boolean): number | null {
  const humans = boxes.filter((b) => b.kind === 'human')
  const pool = humans.length ? humans : boxes.filter((b) => b.kind === 'face')
  if (!pool.length) return null
  if (!preferLargest) {
    const minX = Math.min(...pool.map((b) => b.x))
    const maxX = Math.max(...pool.map((b) => b.x + b.w))
    if (maxX - minX <= cropWidth) return (minX + maxX) / 2
  }
  const largest = pool.reduce((a, b) => (area(b) > area(a) ? b : a))
  return largest.x + largest.w / 2
}

export function computeCropPath(
  track: PersonTrack,
  o: { srcW: number; srcH: number; target: Canvas; shotCuts: number[]; durationSec: number; smoothing?: Smoothing },
): CropPath {
  const sm = o.smoothing ?? {}
  const tau = sm.timeConstantSec ?? 0.6
  const deadband = sm.deadband ?? 0.04
  const cropWidth = (o.target.width / o.target.height) * (o.srcH / o.srcW)

  const samples = [...track.samples].sort((a, b) => a.t - b.t)
  const centers = samples.map((s) => pickCenter(s.boxes, cropWidth, sm.preferLargest ?? false))
  const coverage = samples.length ? centers.filter((c) => c !== null).length / samples.length : 0

  if (cropWidth >= 1) return { keyframes: [{ t: 0, centerX: 0.5 }], cropWidth, coverage, warnings: [] }

  const warnings: CropPath['warnings'] = coverage === 0 ? ['no-person'] : coverage < LOW_COVERAGE ? ['low-coverage'] : []
  const lo = cropWidth / 2
  const hi = 1 - cropWidth / 2
  const clampCenter = (v: number) => Math.min(hi, Math.max(lo, v))
  const cuts = [...o.shotCuts].sort((a, b) => a - b)
  const minGap = 1 / MAX_KEYFRAMES_PER_SEC - 1e-6

  const keyframes: CropKeyframe[] = []
  let lastEmitT = -Infinity
  const emit = (t: number, centerX: number) => {
    keyframes.push({ t, centerX })
    lastEmitT = t
  }

  let current: number | null = null
  let moving = false
  let prevT = 0
  let lastDetT = -Infinity
  let lastTarget = 0.5

  samples.forEach((s, i) => {
    const t = s.t
    const c = centers[i]!
    let target: number
    if (c !== null) {
      target = clampCenter(c)
      lastDetT = t
      lastTarget = target
    } else if (lastDetT === -Infinity) {
      target = 0.5
    } else {
      const gap = t - lastDetT
      target = gap <= HOLD_SEC ? lastTarget : lastTarget + (0.5 - lastTarget) * Math.min(1, (gap - HOLD_SEC) / RETURN_SEC)
    }

    if (current === null) {
      current = target
    } else {
      const dt = t - prevT
      const cut = cuts.find((ct) => ct > prevT + 1e-9 && ct <= t + 1e-9)
      if (cut !== undefined) {
        // 샷이 바뀌면 훑지 않고 점프한다. GSAP 이 키프레임 사이를 선형 보간하므로 직전 값을 컷 직전에 한 번 더 찍는다.
        const lead = cut - CUT_LEAD_SEC
        if (lead > (keyframes.at(-1)?.t ?? -Infinity)) emit(lead, current)
        current = target
        moving = false
        emit(cut, current)
      } else {
        const err = target - current
        if (!moving && Math.abs(err) >= deadband) moving = true
        else if (moving && Math.abs(err) < deadband / 4) moving = false
        if (moving) {
          const maxStep = MAX_SPEED * dt
          const step = Math.max(-maxStep, Math.min(maxStep, err * (1 - Math.exp(-dt / tau))))
          current += step
        }
      }
    }

    if (keyframes.length === 0 || t - lastEmitT >= minGap) emit(t, current)
    prevT = t
  })

  const end = keyframes.at(-1)
  if (!end) return { keyframes: [{ t: 0, centerX: 0.5 }, { t: o.durationSec, centerX: 0.5 }], cropWidth, coverage, warnings }
  if (end.t < o.durationSec - 1e-6) keyframes.push({ t: o.durationSec, centerX: end.centerX })
  return { keyframes, cropWidth, coverage, warnings }
}
