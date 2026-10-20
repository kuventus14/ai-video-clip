import type { JobStatus, Phase } from '../shared/types.ts'

export type QueuedStatus = 'queued_probe' | 'queued_analysis' | 'queued_plan' | 'queued_produce'
export type RunningStatus = 'probing' | 'analyzing' | 'planning' | 'producing'

export const QUEUED_TO_RUNNING: Record<QueuedStatus, RunningStatus> = {
  queued_probe: 'probing',
  queued_analysis: 'analyzing',
  queued_plan: 'planning',
  queued_produce: 'producing',
}

export const PHASE_OF: Record<RunningStatus, Phase> = {
  probing: 'probe',
  analyzing: 'analysis',
  planning: 'plan',
  producing: 'produce',
}

export const QUEUED_OF: Record<Phase, QueuedStatus> = {
  probe: 'queued_probe',
  analysis: 'queued_analysis',
  plan: 'queued_plan',
  produce: 'queued_produce',
}

export const QUEUED_STATUSES = Object.keys(QUEUED_TO_RUNNING) as QueuedStatus[]
export const RUNNING_STATUSES = Object.values(QUEUED_TO_RUNNING) as RunningStatus[]

export const isQueued = (s: JobStatus): s is QueuedStatus => s in QUEUED_TO_RUNNING
export const isRunning = (s: JobStatus): s is RunningStatus => s in PHASE_OF

const ALLOWED: Record<JobStatus, JobStatus[]> = {
  created: ['queued_probe'],
  queued_probe: ['probing'],
  probing: ['ready', 'failed'],
  ready: ['queued_analysis'],
  queued_analysis: ['analyzing'],
  analyzing: ['awaiting_reference', 'queued_plan', 'failed'],
  awaiting_reference: ['queued_plan'],
  queued_plan: ['planning'],
  planning: ['awaiting_plan', 'failed'],
  awaiting_plan: ['queued_plan', 'queued_produce'],
  queued_produce: ['producing'],
  producing: ['awaiting_confirm', 'failed'],
  awaiting_confirm: ['confirmed', 'queued_plan'],
  confirmed: [],
  // 실패한 작업은 실패한 단계(또는 입력을 바꿔 plan 단계)를 다시 요청할 수 있다. 어느 단계인지는 API 가 failedPhase 로 검사한다.
  failed: ['queued_probe', 'queued_analysis', 'queued_plan', 'queued_produce'],
}

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return ALLOWED[from].includes(to)
}
