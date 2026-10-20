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
