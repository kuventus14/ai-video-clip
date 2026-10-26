import type { BgmMood, SfxMode } from './sound.ts'
import type { AudioMode } from './voice.ts'

/** 작업(영상 하나를 편집하는 한 번의 흐름)의 상태. 화면·API·워커가 같은 값을 쓴다. */
export type JobStatus =
  | 'created' // 만들었고 영상을 올리는 중
  | 'queued_probe'
  | 'probing'
  | 'ready' // 올리기 끝, 영상 정보 확인 끝 — 사용자가 설명·용도를 정하고 시작하길 기다림
  | 'queued_analysis'
  | 'analyzing'
  | 'awaiting_reference' // 분석 끝, 레퍼런스를 고르길 기다림
  | 'queued_plan'
  | 'planning'
  | 'awaiting_plan' // "이렇게 이해했어요" 승인을 기다림
  | 'queued_produce'
  | 'producing'
  | 'awaiting_confirm' // 결과를 보고 확정하길 기다림
  | 'confirmed'
  | 'failed'

/** 워커가 하는 일의 단계. 실패하면 어느 단계에서 실패했는지 기억한다. */
export type Phase = 'probe' | 'analysis' | 'plan' | 'produce'

export type PurposeValue = 'post' | 'short'

/** 검수 리포트(report.json)에서 화면에 보여 주는 부분 */
export interface ReportDto {
  passed: boolean
  attempts: number
  reframe: string
  purpose: PurposeValue | null
  findings: { id: string; severity: 'high' | 'medium' | 'info'; message: string; atSec?: number }[]
  /** 자동으로 고친 자막. text 는 고친 글, original 은 고치기 전 글(옛 리포트에는 없다), reason 은 typo|term|spacing */
  appliedCorrections: { index: number; text: string; reason: string; original?: string }[]
  /** 자동 적용하지 않고 제안으로만 남긴 교정 */
  suggestions: { index: number; text: string; reason: string; original?: string }[]
  /** 이 버전의 검수가 확인하지 않는 항목 */
  unchecked: string[]
}

/** API 가 화면에 돌려주는 작업. 내부 경로·원본 파일 경로는 들어 있지 않다. */
export interface JobDto {
  id: string
  status: JobStatus
  /** 지금 하는 일(한국어). 진행 중일 때만 */
  stage: string | null
  createdAt: string
  updatedAt: string
  /** 지금 상태가 된 시각 — 진행 화면의 경과 시간은 여기서부터 센다 */
  statusSince: string
  /** 요약의 한 줄, 없으면 파일 이름 */
  title: string
  sourceName: string | null
  sourceInfo: { durationSec: number; width: number; height: number } | null
  purposeGuess: { purpose: PurposeValue; confidence: number; reasons: string[] } | null
  purposeChoice: 'auto' | PurposeValue
  /** 확정된 용도(계획 단계 이후) */
  purpose: PurposeValue | null
  description: string
  requestText: string
  /** 레퍼런스 링크, 또는 올린 파일이면 "파일: 이름" */
  referenceSource: string | null
  hasUploadedReference: boolean
  captionsMode: 'auto' | 'off'
  /** 소리: 원본 그대로 / 목소리 또렷하게 */
  audioMode: AudioMode
  /** 배경음악 곡 id (없으면 null) / 효과음 켜기·끄기 */
  bgmId: string | null
  sfxMode: SfxMode
  /** 자막 위치(상·중·하). 계획이 정한 값이 들어 있고 승인 화면에서 바꾼다. 아직 계획 전이면 null */
  captionPosition: CaptionPosition | null
  /** 편집 감독이 짠 구성(승인 화면에 보여 주고 문구를 고칠 수 있다). 감독이 실패했거나 계획 전이면 null. 사용자가 고친 문구가 반영돼 있다 */
  script: ScriptDto | null
  /** 자막 편집 줄 수: 트랙이 있으면 트랙의 줄 수, 없으면 줄 번호로 고친 수(없으면 0) */
  captionEditCount: number
  quality: 'draft' | 'looks' | 'delivery'
  summary: { topic: string; genre: string; oneLine: string; hookTitle: string; searchQueries: string[] } | null
  recommendations: Recommendation[]
  planCard: string[] | null
  report: ReportDto | null
  /** 결과 영상의 길이·크기(직접 잰 값). 결과가 없거나 못 쟀으면 null */
  resultInfo: { durationSec: number; width: number; height: number } | null
  media: { source?: string; result?: string; thumb?: string }
  log: { t: string; stage: string; message: string }[]
  error: string | null
  failedPhase: Phase | null
  parentJobId: string | null
  confirmedAt: string | null
}

/** 레퍼런스 추천 목록의 한 항목 */
export interface Recommendation {
  id: string
  url: string
  title: string
  channel?: string
  viewCount: number | null
  durationSec: number | null
  thumbnail: string
}

/** 분석을 시작할 때 보내는 값(POST /api/jobs/<id>/start). reference 는 http(s) 링크, 'uploaded'(올려 둔 파일), 비면 레퍼런스 없음. */
export interface StartInput {
  description?: string
  purposeChoice: 'auto' | PurposeValue
  reference?: string | null
}

/** 계획을 (다시) 요청할 때 보내는 값(POST /api/jobs/<id>/plan). 보내지 않은 항목은 그대로 둔다. */
export interface PlanInput {
  reference?: string | null
  request?: string
  purposeChoice?: 'auto' | PurposeValue
  /** 자막 확인에서 고친 줄 전체(보내면 저장된 것을 이 값으로 바꾼다, 빈 배열이면 비운다). 보내지 않으면 그대로 */
  captionEdits?: CaptionEdit[]
  /** 자막 트랙(줄 전체). 보내면 저장, 빈 배열은 자막을 전부 지움, null 은 비워 인식 결과로 되돌림(예전 편집도 비운다). 보내지 않으면 그대로 */
  captionTrack?: CaptionLine[] | null
}

/** 자막 한 줄: start~end(초) 동안 text 를 보여 준다. 사용자가 만든 자막 트랙은 이 줄들의 전체 목록이다. */
export interface CaptionLine {
  start: number
  end: number
  text: string
}

/** 자막 확인 화면에서 고친 한 줄. i = 줄 번호(reviewParts), text null(또는 공백뿐) = 이 줄을 지운다 */
export interface CaptionEdit {
  i: number
  text: string | null
}

/** 자막 확인 화면의 한 줄(원문). 줄마다 이 칸만 내보낸다 — 단어별 시각은 보내지 않는다 */
export interface CaptionPartDto {
  i: number
  start: number
  end: number
  text: string
  /** 인식기가 확신하지 못한 단어 */
  lowWords: string[]
}

/** 인식한 줄(원본) 한 줄 + 인식기가 확신하지 못한 단어 */
export interface CaptionOriginalLine extends CaptionLine {
  lowWords: string[]
}

/**
 * GET /api/jobs/<id>/captions.
 * 새 편집기(자막 트랙)가 쓰는 것: durationSec·original·lines·custom.
 * parts·edits 는 예전(줄 번호 편집) 화면이 쓰는 것으로, 새 화면으로 바꾸면서 없앤다.
 */
export interface CaptionReviewDto {
  parts: CaptionPartDto[]
  edits: CaptionEdit[]
  hasSpeech: boolean
  /** 영상 길이(초) — 줄 시각의 상한과 "자막 없는 구간" 계산에 쓴다 */
  durationSec: number
  /** 인식한 줄 그대로(의심 단어 표시용, "원래대로"의 기준) */
  original: CaptionOriginalLine[]
  /** 지금의 줄: 저장된 트랙 → 없으면 예전 편집을 입힌 줄 → 없으면 original */
  lines: CaptionLine[]
  /** 사용자가 고친 것(트랙 또는 예전 편집)이 저장돼 있나 */
  custom: boolean
}

/** 승인 화면에서 사용자가 고칠 수 있는 대본 문구(고친 칸만 보낸다) */
export interface ScriptEdits {
  title?: string
  hookQuestion?: string
  openingLines?: string[]
}

/** 승인 화면에 보여 주는 편집 구성 */
export interface ScriptDto {
  title: string
  /** 맨 앞에 붙는 훅 장면 길이(초). 훅이 없으면 0 */
  hookSec: number
  hookQuestion: string | null
  openingLines: string[]
  /** 소제목 흐름 */
  sections: string[]
  questions: number
  reactions: number
  speed: number
}

/** 자막을 화면 위·가운데·아래 중 어디에 둘지 */
export type CaptionPosition = 'top' | 'middle' | 'bottom'

/** 계획을 승인하고 제작을 시작할 때 보내는 값(POST /api/jobs/<id>/approve) */
export interface ApproveInput {
  captions?: 'auto' | 'off'
  captionPosition?: CaptionPosition
  /** 편집 구성의 문구를 고쳤을 때(고친 칸만) */
  scriptEdits?: ScriptEdits
  audio?: AudioMode
  /** 배경음악 곡 id. null 이면 고른 곡을 지운다. 보내지 않으면 그대로 */
  bgm?: string | null
  sfx?: SfxMode
  quality?: 'draft' | 'looks' | 'delivery'
}

/** 계획 승인 화면의 배경음악 목록에 보여 주는 곡 하나(파일 경로·출처 주소는 내보내지 않는다) */
export interface SoundTrackDto {
  id: string
  title: string
  author: string
  mood: BgmMood
  durationSec: number
  license: string
}

/** GET /api/sound — 배경음악 목록과 쓸 수 있는 효과음 개수 */
export interface SoundListDto {
  bgm: SoundTrackDto[]
  sfxCount: number
}
