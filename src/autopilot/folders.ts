import fs from 'node:fs'
import path from 'node:path'

export const VIDEO_EXTS = ['.mp4', '.mov', '.m4v', '.avi', '.mkv', '.webm']

export const isVideo = (name: string): boolean => !name.startsWith('.') && VIDEO_EXTS.includes(path.extname(name).toLowerCase())

/** 폴더 안 영상 파일(숨김 파일·하위 폴더 제외), 이름순 */
export function listVideos(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && isVideo(e.name))
    .map((e) => path.join(dir, e.name))
    .sort()
}

/**
 * 복사가 끝난 파일만 고른다. 에어드롭·카톡 저장처럼 파일이 쓰이는 중이면 크기가 계속 바뀌므로,
 * 지난번 확인 때와 크기·수정 시각이 같고 마지막 수정 뒤 minAgeMs 가 지난 파일만 '준비됨'으로 본다.
 */
export class StabilityTracker {
  private seen = new Map<string, string>()
  constructor(private minAgeMs = 5000) {}

  ready(files: string[], now = Date.now()): string[] {
    const out: string[] = []
    const next = new Map<string, string>()
    for (const f of files) {
      let st: fs.Stats
      try {
        st = fs.statSync(f)
      } catch {
        continue
      }
      const sig = `${st.size}:${st.mtimeMs}`
      if (st.size > 0 && this.seen.get(f) === sig && now - st.mtimeMs >= this.minAgeMs) out.push(f)
      next.set(f, sig)
    }
    this.seen = next
    return out
  }
}

/** dir 안에서 겹치지 않는 파일 이름을 고른다: 이름.mp4 → 이름 (2).mp4 → 이름 (3).mp4 … */
export function uniquePath(dir: string, name: string): string {
  const ext = path.extname(name)
  const stem = name.slice(0, name.length - ext.length)
  let p = path.join(dir, name)
  for (let n = 2; fs.existsSync(p); n++) p = path.join(dir, `${stem} (${n})${ext}`)
  return p
}

/** 파일을 옮긴다(이름이 겹치면 번호를 붙인다). 다른 디스크로 옮길 때는 복사 후 지운다 */
export function moveInto(file: string, dir: string, name = path.basename(file)): string {
  fs.mkdirSync(dir, { recursive: true })
  const dest = uniquePath(dir, name)
  try {
    fs.renameSync(file, dest)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
    fs.copyFileSync(file, dest)
    fs.rmSync(file)
  }
  return dest
}

/** 영상 원본 이름에서 확장자를 뗀 이름 */
export const stemOf = (file: string): string => path.basename(file, path.extname(file))
