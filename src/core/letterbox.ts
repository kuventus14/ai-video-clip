import fs from 'node:fs'
import path from 'node:path'
import { run as realRun } from './exec.ts'
import type { VideoInfo } from './types.ts'

/** 검은 띠를 뺀 화면 부분. 모두 짝수 정수(x·y 는 왼쪽 위, 크기는 가로·세로) */
export interface ContentRect {
  x: number
  y: number
  width: number
  height: number
}

const SAMPLE_POINTS = [0.2, 0.4, 0.6, 0.8]
const SAMPLE_SEC = 2
const BLACK_LIMIT = 24
const SAME_TOLERANCE_PX = 6
/** 제거되는 면적이 이보다 작으면 건드리지 않는다(재인코딩 비용·화질 손해만 남는다) */
const MIN_REMOVED_AREA = 0.06
/** 결과가 원본의 이만큼보다 작아지면 어두운 장면을 띠로 오인한 것으로 보고 포기한다 */
const MIN_KEPT_AREA = 0.4
const TIMEOUT_MS = 30 * 60_000

const CROP_RE = /crop=(-?\d+):(-?\d+):(-?\d+):(-?\d+)/g

/** ffmpeg cropdetect 가 마지막으로 내놓은 사각형(그때까지 본 모든 화면을 합친 값). 없으면 null */
function lastCrop(stderr: string): ContentRect | null {
  let m: RegExpExecArray | null
  let last: RegExpExecArray | null = null
  CROP_RE.lastIndex = 0
  while ((m = CROP_RE.exec(stderr))) last = m
  if (!last) return null
  const [width, height, x, y] = last.slice(1).map(Number) as [number, number, number, number]
  return { x, y, width, height }
}

const evenDown = (n: number) => n - (n % 2)

/**
 * 영상 위아래(또는 양옆)의 검은 띠를 빼고 남는 화면 사각형을 찾는다.
 * 20·40·60·80% 지점의 2초씩을 cropdetect 로 보고, 네 사각형이 서로 비슷할 때(±6px)만 믿는다 — 장면마다 어둡기가 달라 흔들리면 띠가 아니다.
 * 띠가 없거나(제거 면적 6% 미만), 결과가 원본의 40% 미만으로 작아지거나(어두운 장면을 오인), 읽을 수 없으면 null.
 * 한계: 띠 안에 자막·로고가 박혀 있으면 그 글자도 "내용"으로 보여서 띠를 못 찾는다(null — 원본 그대로 진행).
 */
export async function detectContentRect(videoPath: string, info: VideoInfo, deps: { run?: typeof realRun } = {}): Promise<ContentRect | null> {
  const run = deps.run ?? realRun
  const W = info.width
  const H = info.height
  if (!(info.durationSec > 0) || W < 2 || H < 2) return null

  let rects: (ContentRect | null)[]
  try {
    rects = await Promise.all(
      SAMPLE_POINTS.map(async (p) => {
        const args = ['-v', 'info', '-nostdin', '-ss', String(+(info.durationSec * p).toFixed(3)), '-t', String(SAMPLE_SEC), '-i', videoPath, '-vf', `cropdetect=limit=${BLACK_LIMIT}:round=2`, '-an', '-f', 'null', '-']
        const { stderr } = await run('ffmpeg', args, { timeoutMs: 2 * 60_000 })
        return lastCrop(stderr)
      }),
    )
  } catch {
    return null
  }

  const valid = (r: ContentRect | null): r is ContentRect => !!r && r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0 && r.x + r.width <= W && r.y + r.height <= H
  if (!rects.every(valid)) return null
  const all = rects as ContentRect[]

  const spread = (pick: (r: ContentRect) => number) => Math.max(...all.map(pick)) - Math.min(...all.map(pick))
  if ([(r: ContentRect) => r.x, (r: ContentRect) => r.y, (r: ContentRect) => r.width, (r: ContentRect) => r.height].some((pick) => spread(pick) > SAME_TOLERANCE_PX)) return null

  // 네 사각형의 합집합: 어느 지점에서든 보이는 내용은 자르지 않는다
  const x0 = evenDown(Math.min(...all.map((r) => r.x)))
  const y0 = evenDown(Math.min(...all.map((r) => r.y)))
  const right = Math.max(...all.map((r) => r.x + r.width))
  const bottom = Math.max(...all.map((r) => r.y + r.height))
  const rect: ContentRect = { x: x0, y: y0, width: Math.min(evenDown(W), right + (right % 2)) - x0, height: Math.min(evenDown(H), bottom + (bottom % 2)) - y0 }
  if (rect.width < 2 || rect.height < 2) return null

  const kept = (rect.width * rect.height) / (W * H)
  if (1 - kept < MIN_REMOVED_AREA) return null
  if (kept < MIN_KEPT_AREA) return null
  return rect
}

/**
 * 화면 부분(rect)만 잘라 새 파일로 만든다. 화면은 다시 인코딩하고(crf 17) 소리는 그대로 복사하며, 색인을 앞에 둔다(faststart).
 * 실패하면 던진다 — 부르는 쪽(analyzeInput)이 원본으로 계속한다.
 */
export async function cropToContent(i: { inputPath: string; outPath: string; rect: ContentRect; hasAudio: boolean }, deps: { run?: typeof realRun } = {}): Promise<string> {
  const run = deps.run ?? realRun
  fs.mkdirSync(path.dirname(i.outPath), { recursive: true })
  const { x, y, width, height } = i.rect
  const args = [
    '-v', 'error', '-nostdin', '-y', '-i', i.inputPath, '-map', '0:v:0', ...(i.hasAudio ? ['-map', '0:a:0'] : []),
    '-vf', `crop=${width}:${height}:${x}:${y}`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', ...(i.hasAudio ? ['-c:a', 'copy'] : ['-an']),
    '-movflags', '+faststart', i.outPath,
  ]
  await run('ffmpeg', args, { timeoutMs: TIMEOUT_MS })
  return i.outPath
}
