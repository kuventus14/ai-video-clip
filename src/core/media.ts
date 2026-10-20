import fs from 'node:fs'
import path from 'node:path'
import { run, ToolError } from './exec.ts'
import type { VideoInfo } from './types.ts'

interface FfprobeStream {
  codec_type?: string
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
  }
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
