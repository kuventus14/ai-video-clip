import fs from 'node:fs'
import path from 'node:path'
import { run } from '../../src/core/exec.ts'

const DIR = path.resolve(import.meta.dirname, '../../.cache/fixtures')

export interface Fixtures {
  landscape: string // 1920x1080, 5초, 오디오 있음
  portrait: string // 1080x1920, 3초, 오디오 있음
  silent: string // 1920x1080, 2초, 오디오 없음
  square: string // 1080x1080, 3초, 오디오 있음
  koreanName: string // landscape 복사본, 파일명에 한글·공백·괄호
  rotated: string // 가로로 인코딩됐지만 회전 메타데이터 90도 → 화면상 세로
}

async function make(out: string, size: string, seconds: number, audio: boolean): Promise<void> {
  if (fs.existsSync(out)) return
  const args = ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=30:duration=${seconds}`]
  if (audio) args.push('-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`)
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast')
  if (audio) args.push('-c:a', 'aac', '-shortest')
  else args.push('-an')
  args.push(out)
  await run('ffmpeg', args)
}

export async function ensureFixtures(): Promise<Fixtures> {
  fs.mkdirSync(DIR, { recursive: true })
  const f: Fixtures = {
    landscape: path.join(DIR, 'landscape.mp4'),
    portrait: path.join(DIR, 'portrait.mp4'),
    silent: path.join(DIR, 'silent.mp4'),
    square: path.join(DIR, 'square.mp4'),
    koreanName: path.join(DIR, '테스트 영상 (1).mp4'),
    rotated: path.join(DIR, 'rotated.mp4'),
  }
  await make(f.landscape, '1920x1080', 5, true)
  await make(f.portrait, '1080x1920', 3, true)
  await make(f.silent, '1920x1080', 2, false)
  await make(f.square, '1080x1080', 3, true)
  if (!fs.existsSync(f.koreanName)) fs.copyFileSync(f.landscape, f.koreanName)
  if (!fs.existsSync(f.rotated)) {
    await run('ffmpeg', ['-v', 'error', '-y', '-display_rotation', '90', '-i', f.landscape, '-c', 'copy', f.rotated])
  }
  return f
}
