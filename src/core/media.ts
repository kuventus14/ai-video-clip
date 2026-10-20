import fs from 'node:fs'
import path from 'node:path'
import { run, ToolError } from './exec.ts'
import type { VideoInfo } from './types.ts'

interface FfprobeStream {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  r_frame_rate?: string
  avg_frame_rate?: string
  bit_rate?: string
  tags?: { rotate?: string }
  side_data_list?: { rotation?: number }[]
}

function parseRate(r: string | undefined): number {
  if (!r) return 0
  const [a, b] = r.split('/').map(Number)
  if (!a || !b) return 0
  return a / b
}

export async function probeVideo(videoPath: string): Promise<VideoInfo> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', videoPath])
  const json = JSON.parse(stdout) as { streams?: FfprobeStream[]; format?: { duration?: string; bit_rate?: string } }
  const streams = json.streams ?? []
  const v = streams.find((s) => s.codec_type === 'video')
  if (!v || !v.width || !v.height) throw new ToolError('ffprobe', null, '', `영상 스트림을 찾을 수 없어요: ${path.basename(videoPath)}`)

  const rotation = v.side_data_list?.find((d) => typeof d.rotation === 'number')?.rotation ?? Number(v.tags?.rotate ?? 0)
  const swap = Math.abs(rotation) % 180 === 90
  const bitrate = Number(v.bit_rate) || Number(json.format?.bit_rate) || null

  return {
    path: videoPath,
    durationSec: Number(json.format?.duration) || 0,
    width: swap ? v.height : v.width,
    height: swap ? v.width : v.height,
    fps: parseRate(v.r_frame_rate) || parseRate(v.avg_frame_rate),
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
    videoBitrate: bitrate,
    videoCodec: v.codec_name,
    rotation: rotation || 0,
  }
}

/** hyperframes 가 변환 없이 정상 렌더링하는 것을 실험으로 확인한 코덱(회전 메타데이터가 있어도 된다) */
const NATIVE_CODECS = new Set(['h264', 'hevc'])

/**
 * hyperframes 가 못 읽을 수 있는 드문 코덱(mpeg4·ProRes 등)만 H.264 mp4 로 바꿔 준다.
 * H.264·HEVC 는 컨테이너나 회전 메타데이터와 상관없이 그대로 돌려준다 — 4K 아이폰 영상을 통째로 다시 인코딩하면 수십 분이 걸린다.
 * 원본 파일은 건드리지 않는다.
 */
export async function ensureH264(
  videoPath: string,
  info: VideoInfo,
  workDir: string,
): Promise<{ path: string; info: VideoInfo; converted: boolean }> {
  if (!info.videoCodec || NATIVE_CODECS.has(info.videoCodec)) return { path: videoPath, info, converted: false }

  fs.mkdirSync(workDir, { recursive: true })
  const out = path.join(workDir, 'source-h264.mp4')
  await run(
    'ffmpeg',
    [
      '-v', 'error', '-nostdin', '-y', '-i', videoPath,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-c:v', 'libx264', '-crf', '16', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out,
    ],
    { timeoutMs: 60 * 60_000 },
  )
  return { path: out, info: await probeVideo(out), converted: true }
}

const MAX_EDGE = 1024

/** 지정한 시각마다 jpg 한 장씩 뽑는다. 긴 변은 1024px 이하로 줄인다. */
export async function extractFrames(videoPath: string, timesSec: number[], outDir: string): Promise<string[]> {
  fs.mkdirSync(outDir, { recursive: true })
  const { width, height } = await probeVideo(videoPath)
  const longEdge = Math.max(width, height)
  const k = longEdge > MAX_EDGE ? MAX_EDGE / longEdge : 1
  const even = (n: number) => Math.max(2, Math.round((n * k) / 2) * 2)

  const files: string[] = []
  for (const [i, t] of timesSec.entries()) {
    const out = path.join(outDir, `frame-${String(i).padStart(2, '0')}.jpg`)
    const args = ['-v', 'error', '-nostdin', '-y', '-ss', String(Math.max(0, t)), '-i', videoPath, '-frames:v', '1']
    if (k < 1) args.push('-vf', `scale=${even(width)}:${even(height)}`)
    args.push('-q:v', '3', out)
    await run('ffmpeg', args)
    files.push(out)
  }
  return files
}
