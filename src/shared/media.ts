/** 올릴 수 있는 영상 확장자. 화면(고르는 즉시 검사)과 서버(올리는 중 검사)가 같은 목록을 쓴다. */
export const VIDEO_EXTS = ['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi'] as const

export const UNSUPPORTED_FORMAT_MESSAGE = `지원하지 않는 형식이에요 (${VIDEO_EXTS.map((e) => e.slice(1)).join(', ')})`

/** 파일 이름의 확장자(소문자). 허용 목록에 없거나 확장자가 없으면 null. 경로 구분자(/ \) 앞은 보지 않는다. */
export function videoExtOf(name: string | null | undefined): string | null {
  if (!name) return null
  const base = name.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return null // 점이 없거나 ".mp4" 처럼 이름 없이 점으로 시작하면 확장자가 아니다
  const ext = base.slice(dot).toLowerCase()
  return (VIDEO_EXTS as readonly string[]).includes(ext) ? ext : null
}
