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
  appliedCorrections: { index: number; text: string; reason: string }[]
  suggestions: { index: number; text: string; reason: string }[]
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
}

/** 계획을 승인하고 제작을 시작할 때 보내는 값(POST /api/jobs/<id>/approve) */
export interface ApproveInput {
  captions?: 'auto' | 'off'
  quality?: 'draft' | 'looks' | 'delivery'
}
