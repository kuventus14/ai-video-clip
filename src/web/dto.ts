import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { Job } from '../db/jobs.ts'
import { canRemix, SOUND_NOT_REMIXABLE, type Catalog } from '../shared/sound.ts'
import type { JobDto, ReportDto, ScriptDto, ScriptEdits, SoundAdjustDto, SoundListDto } from '../shared/types.ts'

const SummarySchema = z.object({
  topic: z.string(),
  genre: z.string(),
  oneLine: z.string(),
  hookTitle: z.string(),
  searchQueries: z.array(z.string()),
})

/** 편집 감독이 짠 대본 중 화면에 보여 주는 부분만 읽는다(저장된 JSON 이 낡았거나 깨져 있으면 null) */
const ScriptSchema = z.object({
  title: z.string(),
  hook: z.object({ sourceStart: z.number(), sourceEnd: z.number(), question: z.string() }).optional(),
  openingLines: z.array(z.string()),
  sections: z.array(z.object({ label: z.string() })),
  questions: z.array(z.unknown()),
  reactions: z.array(z.unknown()),
  speed: z.number(),
})

function toScriptDto(raw: unknown, edits: ScriptEdits | null): ScriptDto | null {
  const sc = ScriptSchema.safeParse(raw)
  if (!sc.success) return null
  const d = sc.data
  return {
    title: edits?.title ?? d.title,
    hookSec: d.hook ? Math.round((d.hook.sourceEnd - d.hook.sourceStart) * 1000) / 1000 : 0,
    hookQuestion: d.hook ? (edits?.hookQuestion ?? d.hook.question) : null,
    openingLines: edits?.openingLines ?? d.openingLines,
    sections: d.sections.map((x) => x.label),
    questions: d.questions.length,
    reactions: d.reactions.length,
    speed: d.speed,
  }
}

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

/** 제작이 남긴 지금 값·AI 추천 값(report.sound.balance). 없으면(소리 크기 기능 이전의 작업) null */
const BalanceSchema = z.object({
  sound: z.object({ balance: z.object({ bgmGainDb: z.number(), sfxGainDb: z.number(), aiBgmGainDb: z.number(), aiSfxGainDb: z.number(), reason: z.string() }) }),
})
/** 영상에 들어간 효과음 개수. 리포트에 없으면 null */
const SfxCountSchema = z.object({ sound: z.object({ sfxCount: z.number() }) })
function toSoundAdjust(job: Job): SoundAdjustDto | null {
  if (!job.bgmId && job.sfxMode !== 'on') return null
  const available = canRemix(job.resultPath)
  const parsed = BalanceSchema.safeParse(job.report)
  const b = parsed.success ? parsed.data.sound.balance : null
  return {
    available,
    reason: available ? null : SOUND_NOT_REMIXABLE,
    bgmGainDb: b?.bgmGainDb ?? 0,
    sfxGainDb: b?.sfxGainDb ?? 0,
    aiBgmGainDb: b?.aiBgmGainDb ?? 0,
    aiSfxGainDb: b?.aiSfxGainDb ?? 0,
    aiReason: b?.reason ?? '',
    sfxCount: (() => { const c = SfxCountSchema.safeParse(job.report); return c.success ? c.data.sound.sfxCount : null })(),
  }
}

/** 파일의 수정 시각(ms, 정수). 파일이 없으면 null */
const resultMtime = (p: string | null): number | null => {
  try {
    return p ? Math.floor(fs.statSync(p).mtimeMs) : null
  } catch {
    return null
  }
}

const exists = (p: string | null) => (p ? fs.existsSync(p) : false)

/** 내부 경로·원본 파일 경로를 숨기고, 파일이 있는 것만 /api/jobs/<id>/media/<종류> 주소로 채운 화면용 작업. */
export function toJobDto(job: Job): JobDto {
  const summary = SummarySchema.safeParse(job.summary)
  const media: JobDto['media'] = {}
  if (exists(job.sourcePath)) media.source = `/api/jobs/${job.id}/media/source`
  // 결과 파일의 수정 시각을 주소에 붙인다 — 소리만 다시 섞어 파일이 바뀌면 브라우저가 옛 영상을 보여 주지 않고, 확정처럼 파일이 안 바뀌는 변화에는 재생이 끊기지 않는다
  const resultVersion = resultMtime(job.resultPath)
  if (resultVersion !== null) media.result = `/api/jobs/${job.id}/media/result?v=${resultVersion}`
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
    captionPosition: job.captionPosition,
    script: toScriptDto(job.script, job.scriptEdits),
    captionEditCount: job.captionTrack ? job.captionTrack.length : (job.transcriptEdits?.length ?? 0),
    quality: job.quality,
    summary: summary.success ? summary.data : null,
    recommendations: job.recommendations,
    planCard: job.planCard,
    report: toReportDto(job.report),
    resultInfo: toResultInfo(job.report),
    soundAdjust: toSoundAdjust(job),
    remixing: job.remixPending && (job.status === 'queued_produce' || job.status === 'producing'),
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
