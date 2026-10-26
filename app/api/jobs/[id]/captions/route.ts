import fs from 'node:fs'
import path from 'node:path'
import type { ReviewTranscript } from '../../../../../src/shared/captionReview.ts'
import { toCaptionReviewDto } from '../../../../../src/web/captions.ts'
import { assertLocalHost, jsonError, loadJob } from '../../../../../src/web/http.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 자막 확인 화면에 보여 줄 인식 결과(줄 목록, 원문)와 이미 저장된 편집.
 * 분석이 끝난 뒤 계획을 만들기 전(awaiting_reference)·계획 확인(awaiting_plan)·결과 확인(awaiting_confirm, 결과 화면에서 자막을 고치러 들어가는 길)·계획 단계 실패일 때만 준다.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const wrongHost = assertLocalHost(req)
  if (wrongHost) return wrongHost
  const found = await loadJob(ctx.params)
  if ('res' in found) return found.res
  const { job, jobs } = found
  const ok = job.status === 'awaiting_reference' || job.status === 'awaiting_plan' || job.status === 'awaiting_confirm' || (job.status === 'failed' && job.failedPhase === 'plan')
  if (!ok) return jsonError(409, '지금은 자막을 확인할 수 있는 상태가 아니에요')

  const file = path.join(jobs.jobDir(job.id), 'analysis.json')
  if (!fs.existsSync(file)) return jsonError(404, '분석 결과를 찾을 수 없어요')
  let transcript: (ReviewTranscript & { durationSec?: number }) | undefined
  try {
    transcript = (JSON.parse(fs.readFileSync(file, 'utf8')) as { transcript?: ReviewTranscript & { durationSec?: number } }).transcript
  } catch {
    return jsonError(500, '분석 결과를 읽을 수 없어요')
  }
  if (!transcript) return jsonError(404, '분석 결과를 찾을 수 없어요')
  return Response.json(toCaptionReviewDto(transcript, job.transcriptEdits, job.captionTrack, job.sourceInfo?.durationSec ?? transcript.durationSec ?? 0))
}
