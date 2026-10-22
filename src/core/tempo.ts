import { run as realRun, ToolError } from './exec.ts'

/** 사용자에게 그대로 보여 줘도 되는 속도 조정 오류. */
export class TempoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TempoError'
  }
}

const FPS = 30
const TIMEOUT_MS = 30 * 60_000

/** 속도를 적용하기 전의 시각을 적용한 뒤의 시각으로(자막 큐·효과음 위치·길이에 쓴다). */
export const scaleSec = (t: number, speed: number): number => t / speed

/**
 * 렌더가 끝난 영상 전체를 speed 배속으로 만든다: 화면은 `setpts=PTS/speed`(30fps 유지), 소리는 `atempo`(높이 보존).
 * 영상에 이미 입혀 둔 자막·오버레이도 같이 빨라지므로 서로 어긋나지 않는다. speed ≤ 1.001 이면 아무것도 하지 않고 입력 경로를 돌려준다.
 * 화면을 한 번 더 인코딩하므로 화질 손해를 줄이려고 crf 17 로 한다.
 */
export async function applyTempo(i: { inputPath: string; outPath: string; speed: number; hasAudio: boolean }, deps: { run?: typeof realRun } = {}): Promise<string> {
  if (i.speed <= 1.001) return i.inputPath
  const run = deps.run ?? realRun
  const s = +i.speed.toFixed(4)
  const graph = i.hasAudio ? `[0:v]setpts=PTS/${s},fps=${FPS}[v];[0:a]atempo=${s}[a]` : `[0:v]setpts=PTS/${s},fps=${FPS}[v]`
  const args = [
    '-v', 'error', '-nostdin', '-y', '-i', i.inputPath, '-filter_complex', graph, '-map', '[v]', ...(i.hasAudio ? ['-map', '[a]'] : []),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', ...(i.hasAudio ? ['-c:a', 'aac', '-b:a', '192k'] : []),
    '-movflags', '+faststart', i.outPath,
  ]
  try {
    await run('ffmpeg', args, { timeoutMs: TIMEOUT_MS })
  } catch (e) {
    const detail = e instanceof ToolError ? e.stderr.trim().split('\n').slice(-1)[0] : (e as Error).message
    throw new TempoError(`영상 속도를 맞추지 못했어요. 같은 일이 반복되면 진행 기록을 알려 주세요. (${detail})`)
  }
  return i.outPath
}
