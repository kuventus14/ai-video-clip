import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { Job } from '../db/jobs.ts'
import type { Catalog } from '../shared/sound.ts'
import type { JobDto, ReportDto, SoundListDto } from '../shared/types.ts'

const SummarySchema = z.object({
  topic: z.string(),
  genre: z.string(),
  oneLine: z.string(),
  hookTitle: z.string(),
  searchQueries: z.array(z.string()),
})

const Finding = z.object({ id: z.string(), severity: z.enum(['high', 'medium', 'info']), message: z.string(), atSec: z.number().optional() })
const Correction = z.object({ index: z.number(), text: z.string(), reason: z.string(), original: z.string().optional() })
const ReportSchema = z.object({
  qa: z.object({ passed: z.boolean(), findings: z.array(Finding) }),
  attempts: z.number().default(1),
  reframe: z.string().default('none'),
  purpose: z.object({ resolved: z.enum(['post', 'short']).optional() }).optional(),
  appliedCorrections: z.array(Correction).default([]),
  suggestions: z.array(Correction).default([]),
  unchecked: z.array(z.string()).default([]),
})

function toReportDto(report: unknown): ReportDto | null {
  const parsed = ReportSchema.safeParse(report)
  if (!parsed.success) return null
  const r = parsed.data
  return {
    passed: r.qa.passed,
    attempts: r.attempts,
    reframe: r.reframe,
    purpose: r.purpose?.resolved ?? null,
    findings: r.qa.findings,
    appliedCorrections: r.appliedCorrections,
    suggestions: r.suggestions,
    unchecked: r.unchecked,
  }
}

/** 결과 영상을 잰 값(워커가 리포트에 붙인다). 없거나 형식이 틀리면 null */
const OutputSchema = z.object({ output: z.object({ durationSec: z.number(), width: z.number(), height: z.number() }) })
function toResultInfo(report: unknown): JobDto['resultInfo'] {
  const parsed = OutputSchema.safeParse(report)
  return parsed.success ? parsed.data.output : null
}

const exists = (p: string | null) => (p ? fs.existsSync(p) : false)

/** 내부 경로·원본 파일 경로를 숨기고, 파일이 있는 것만 /api/jobs/<id>/media/<종류> 주소로 채운 화면용 작업. */
export function toJobDto(job: Job): JobDto {
  const summary = SummarySchema.safeParse(job.summary)
  const media: JobDto['media'] = {}
  if (exists(job.sourcePath)) media.source = `/api/jobs/${job.id}/media/source`
  if (exists(job.resultPath)) media.result = `/api/jobs/${job.id}/media/result`
  if (exists(job.thumbPath)) media.thumb = `/api/jobs/${job.id}/media/thumb`

  const ref = job.referenceSource
  return {
    id: job.id,
    status: job.status,
    stage: job.stage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    statusSince: job.statusChangedAt,
    title: (summary.success && summary.data.oneLine) || job.sourceName || '이름 없는 작업',
    sourceName: job.sourceName,
    sourceInfo: job.sourceInfo,
    purposeGuess: job.purposeGuess,
    purposeChoice: job.purposeChoice,
    purpose: job.purpose,
    description: job.description,
    requestText: job.requestText,
    referenceSource: ref === null ? null : /^https?:\/\//i.test(ref) ? ref : `파일: ${path.basename(ref)}`,
    hasUploadedReference: !!job.referenceUploadPath,
    captionsMode: job.captionsMode,
    audioMode: job.audioMode,
    bgmId: job.bgmId,
    sfxMode: job.sfxMode,
    quality: job.quality,
    summary: summary.success ? summary.data : null,
    recommendations: job.recommendations,
    planCard: job.planCard,
    report: toReportDto(job.report),
    resultInfo: toResultInfo(job.report),
    media,
    log: job.log.slice(-30),
    error: job.errorMessage,
    failedPhase: job.failedPhase,
    parentJobId: job.parentJobId,
    confirmedAt: job.confirmedAt,
  }
}

/** 음원 목록을 화면용으로: 배경음악은 곡마다, 효과음은 개수만 */
export function toSoundListDto(c: Catalog): SoundListDto {
  return {
    bgm: c.bgm.map((t) => ({ id: t.id, title: t.title, author: t.author, mood: t.mood, durationSec: t.durationSec, license: t.license })),
    sfxCount: c.sfx.length,
  }
}
