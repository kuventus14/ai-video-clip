/** 용도: post = 게시물 영상용(가로), short = 릴스·숏츠용(세로) */
export type Purpose = 'post' | 'short'

export interface Canvas {
  width: number
  height: number
}

/** 시간 구간(초) */
export interface Span {
  start: number
  end: number
}

export interface VideoInfo {
  path: string
  durationSec: number
  /** 회전 메타데이터를 반영한, 화면에 보이는 크기 */
  width: number
  height: number
  fps: number
  hasAudio: boolean
  videoBitrate: number | null
  /** ffprobe codec_name (h264, hevc …) */
  videoCodec?: string
  /** 회전 메타데이터(도). 0 이면 없음 */
  rotation?: number
}

export interface Word {
  text: string
  start: number
  end: number
  /** 0..1 */
  confidence: number
}

export interface Transcript {
  language: string
  durationSec: number
  words: Word[]
  segments: { text: string; start: number; end: number }[]
  hasSpeech: boolean
}

/** 출력 타임라인(컷 이후) 기준 자막 한 덩어리 */
export interface CaptionCue {
  text: string
  start: number
  end: number
}

/** t = 초, centerX = 크롭 창 중심의 원본 기준 정규화 x(0..1, 좌측 0) */
export interface CropKeyframe {
  t: number
  centerX: number
}

export type ReframeMode = 'none' | 'track' | 'blur-fill'
