import fs from 'node:fs'
import path from 'node:path'
import { buildProject, chooseReframeMode, renderProject } from './compose.ts'
import { detectSilences, planCuts } from './cuts.ts'
import { deriveAppliedStyle, interpretRequest, planCardLines, type EditPlan } from './interpret.ts'
import { ensureH264, probeVideo } from './media.ts'
import { trackPeople, type PersonTrack } from './person.ts'
import { runQa, type QaReport } from './qa.ts'
import { applyCorrections, partitionCorrections, proofreadCues, upscaleFactor, type CueCorrection, type Finding } from './qaChecks.ts'
import { canvasFor, detectPurpose, resolvePurpose } from './purpose.ts'
import { computeCropPath, cropReversalsPerSec, type CropPath } from './reframe.ts'
import { analyzeReference, detectSceneCuts, FEASIBILITY, type StyleSpec } from './styleSpec.ts'
import { fetchReference } from './reference.ts'
import { groupWordsIntoCues, remapKeyframes, remapWords } from './timeline.ts'
import { transcribe } from './transcribe.ts'
import { describeVideo, type VideoSummary } from './understand.ts'
import type { CaptionCue, Purpose, Span, Transcript, VideoInfo } from './types.ts'

export class InputError extends Error {
  kind: 'too-short' | 'too-long' | 'unreadable'
  constructor(kind: InputError['kind'], message: string) {
    super(message)
    this.name = 'InputError'
    this.kind = kind
  }
}

export type Stage = 'probe' | 'normalize' | 'transcribe' | 'reference' | 'purpose' | 'understand' | 'plan' | 'cuts' | 'track' | 'build' | 'render' | 'qa' | 'rework' | 'done'
export type Quality = 'draft' | 'looks' | 'delivery'

export interface EditOptions {
  videoPath: string
  outDir: string
  reference?: string
  description?: string
  purpose?: Purpose | 'auto'
  request?: string
  quality?: Quality
  captions?: 'auto' | 'off'
  /** 작업 폴더(<outDir>/.vae-work-…)를 끝난 뒤에도 남긴다 */
  keepWork?: boolean
  onStage?: (s: Stage, detail?: string) => void
  /** 편집 계획이 정해진 직후(렌더 전)에 "이렇게 이해했어요" 카드와 용도를 알려 준다 */
  onPlan?: (planCard: string[], purpose: Purpose) => void
}

export interface EditResult {
  resultPath: string
  purpose: Purpose
  plan: EditPlan
  planCard: string[]
  qa: QaReport
  attempts: number
  delivered: true
  /** 자동으로 적용한 자막 교정 */
  appliedCorrections: CueCorrection[]
  /** 원문과 많이 달라서(또는 재작업 한도를 넘어) 자동 적용하지 않은 자막 교정 제안 */
  suggestions: CueCorrection[]
  summary: VideoSummary
  reframe: ReturnType<typeof chooseReframeMode>
}

/** 외부 도구·모델을 부르는 함수들. 시험에서 가짜로 바꿔 끼운다. */
export interface PipelineDeps {
  probeVideo: typeof probeVideo
  ensureH264: typeof ensureH264
  transcribe: typeof transcribe
  detectSilences: typeof detectSilences
  detectSceneCuts: typeof detectSceneCuts
  describeVideo: typeof describeVideo
  fetchReference: typeof fetchReference
  analyzeReference: typeof analyzeReference
  interpretRequest: typeof interpretRequest
  trackPeople: typeof trackPeople
  proofreadCues: typeof proofreadCues
  buildProject: typeof buildProject
  renderProject: typeof renderProject
  runQa: typeof runQa
}

const DEFAULTS: PipelineDeps = {
  probeVideo, ensureH264, transcribe, detectSilences, detectSceneCuts, describeVideo, fetchReference, analyzeReference,
  interpretRequest, trackPeople, proofreadCues, buildProject, renderProject, runQa,
}

const MIN_SEC = 1
const MAX_SEC = 600
const MAX_ATTEMPTS = 3 // 최초 + 재작업 2회
const LOW_CONFIDENCE = 0.5
const HINT_RETRANSCRIBE_MIN_LOW_WORDS = 5
const HINT_MAX_CHARS = 200
const CROP_JITTER_PER_SEC = 1
const LADDER: Quality[] = ['draft', 'looks', 'delivery']
const nextQuality = (q: Quality): Quality => LADDER[Math.min(LADDER.length - 1, LADDER.indexOf(q) + 1)]!

/** 이 버전의 검수가 확인하지 않는 항목 — 리포트에 그대로 남겨 "다 검사했다"고 오해하지 않게 한다. */
const UNCHECKED = [
  '음성 재전사와의 대조(자막이 실제 말과 맞는지 음성으로 다시 확인)',
  '자막과 음성의 싱크',
  '자막이 화면 밖으로 잘리거나 제목 카드와 겹치는지',
  '원본 대비 비트레이트 하락',
]

/** 레퍼런스가 없을 때 쓰는 무난한 기본 스타일 */
function defaultStyleSpec(purpose: Purpose): StyleSpec {
  return {
    orientation: purpose === 'short' ? 'portrait' : 'landscape',
    durationSec: 0,
    pacing: { shotCount: 1, avgShotLengthSec: 5, cutsPerMinute: 12 },
    hook: { endSec: 3, description: '' },
    captions: { present: true, position: 'bottom', size: 'medium', color: '#FFFFFF', maxCharsPerLine: purpose === 'short' ? 14 : 22 },
    hookTitle: { present: false },
    transitions: { dominant: 'hard-cut' },
    music: { present: false, energy: 'low' },
    structure: [],
    feasibility: { ...FEASIBILITY },
  }
}

function reframeCardLines(reframe: ReturnType<typeof chooseReframeMode>, info: VideoInfo, canvas: { width: number; height: number }): string[] {
  const lines: string[] = []
  const target = canvas.height > canvas.width ? '세로' : '가로'
  if (reframe === 'track') lines.push(`• 화면 구성: 원본을 ${target} 화면으로 자르면서 사람이 가운데 오도록 따라가요`)
  if (reframe === 'blur-fill') lines.push(`• 화면 구성: 원본이 ${info.height > info.width ? '세로' : '정사각'}라서 ${target} 화면 가운데에 두고 양옆을 흐린(블러) 배경으로 채워요`)
  const f = upscaleFactor(info, canvas, reframe)
  if (f > 1.5) lines.push(`• 주의: 원본 해상도가 낮아 화면이 ${f.toFixed(1)}배로 확대돼요. 선명도가 떨어질 수 있어요`)
  return lines
}

const hintFromSummary = (s: VideoSummary) => [s.topic, s.genre, ...s.searchQueries].join(', ').slice(0, HINT_MAX_CHARS)

export async function runEdit(o: EditOptions, overrides: Partial<PipelineDeps> = {}): Promise<EditResult> {
  const d: PipelineDeps = { ...DEFAULTS, ...overrides }
  const stage = (s: Stage, detail?: string) => o.onStage?.(s, detail)
  const outDir = path.resolve(o.outDir)
  fs.mkdirSync(outDir, { recursive: true })
  // 이 실행이 직접 만든 고유 폴더만 쓰고 지운다 — 결과 폴더에 원래 있던 파일은 건드리지 않는다
  const work = fs.mkdtempSync(path.join(outDir, '.vae-work-'))

  try {
    // 1) 입력 확인
    stage('probe')
    let info: VideoInfo
    try {
      info = await d.probeVideo(o.videoPath)
    } catch (e) {
      throw new InputError('unreadable', `영상을 읽을 수 없어요: ${(e as Error).message}`)
    }
    if (info.durationSec < MIN_SEC) throw new InputError('too-short', `영상이 너무 짧아요 (${info.durationSec.toFixed(1)}초). 1초 이상이어야 해요.`)
    if (info.durationSec > MAX_SEC) throw new InputError('too-long', `영상이 너무 길어요 (${Math.round(info.durationSec)}초). 10분 이하로 올려 주세요.`)

    const norm = await d.ensureH264(o.videoPath, info, work)
    if (norm.converted) stage('normalize', 'H.264 mp4 로 변환했어요')
    const src = norm.path
    info = norm.info

    // 2) 음성 인식 (설명이 있으면 처음부터 용어 힌트로)
    const description = (o.description ?? '').trim()
    stage('transcribe')
    let transcript: Transcript = await d.transcribe(src, description ? { prompt: description.slice(0, HINT_MAX_CHARS) } : undefined)

    // 3) 레퍼런스: 분석하고 곧바로 지운다
    let spec: StyleSpec | undefined
    let refInfo: VideoInfo | undefined
    if (o.reference) {
      stage('reference')
      const ref = await d.fetchReference(o.reference, path.join(work, 'ref'))
      try {
        refInfo = ref.info
        spec = await d.analyzeReference({ path: ref.path, info: ref.info })
      } finally {
        await ref.cleanup()
      }
    }

    // 4) 용도, 영상 이해
    stage('purpose')
    const guess = detectPurpose({ info, reference: refInfo, description })
    const purpose = resolvePurpose(guess, o.purpose)
    const canvas = canvasFor(purpose)

    stage('understand')
    const summary = await d.describeVideo({ info, transcript, userDescription: o.description, workDir: work })
    const lowCount = transcript.words.filter((w) => w.confidence < LOW_CONFIDENCE).length
    if (transcript.hasSpeech && !description && lowCount >= HINT_RETRANSCRIBE_MIN_LOW_WORDS) {
      stage('transcribe', '전문 용어 힌트로 다시 인식해요')
      transcript = await d.transcribe(src, { prompt: hintFromSummary(summary) })
    }

    // 5) 편집 계획
    stage('plan')
    const specUsed = spec ?? defaultStyleSpec(purpose)
    const plan = await d.interpretRequest({ spec: specUsed, userText: o.request, summary, hasReference: spec !== undefined })
    const style = deriveAppliedStyle(plan, specUsed, summary, purpose)
    const reframe = chooseReframeMode(info, canvas)
    const baseCard = !spec && !(o.request ?? '').trim()
      ? [
          '이렇게 이해했어요: 레퍼런스가 없어서 기본 스타일로 편집해요.',
          '• 컷: 말 사이의 긴 쉼과 "음·어" 같은 군더더기를 정리해요',
          '• 자막: 말하는 대로 넣고, 오타·오인식은 검수에서 고쳐요',
        ]
      : planCardLines(plan, specUsed)
    const planCard = [...baseCard, ...reframeCardLines(reframe, info, canvas)]
    o.onPlan?.(planCard, purpose)

    // 6) 컷
    stage('cuts')
    const silences = await d.detectSilences(src)
    const cutPlan = planCuts({ transcript, silences, durationSec: info.durationSec, padSec: style.padSec })
    const kept: Span[] = cutPlan.kept.length ? cutPlan.kept : [{ start: 0, end: info.durationSec }]

    // 7) 세로 크롭이면 사람 위치 추적
    let track: PersonTrack | undefined
    let shotCuts: number[] = []
    let cropPath: CropPath | undefined
    const computeCrop = (smoothing?: Parameters<typeof computeCropPath>[1]['smoothing']) =>
      computeCropPath(track!, { srcW: info.width, srcH: info.height, target: canvas, shotCuts, durationSec: info.durationSec, smoothing })
    if (reframe === 'track') {
      stage('track')
      track = await d.trackPeople(src, { sampleFps: 4 })
      shotCuts = await d.detectSceneCuts(src, { maxSec: info.durationSec }) // 기본 180초 한계에 걸리지 않게 영상 전체를 본다
      cropPath = computeCrop()
    }

    // 8) 자막: 컷 이후 시간으로 바꾸고, 렌더 전에 한 번 교정한다 (원문과 너무 다른 교정은 제안으로만 남긴다)
    const outWords = remapWords(transcript.words, kept)
    const captionsOff = o.captions === 'off'
    let maxChars = style.captions.maxChars
    let cues: CaptionCue[] = captionsOff ? [] : groupWordsIntoCues(outWords, { maxChars })
    const applied: CueCorrection[] = []
    const suggestions: CueCorrection[] = []
    const extraFindings: Finding[] = []
    if (cues.length) {
      try {
        const suspectWords = outWords.filter((w) => w.confidence < LOW_CONFIDENCE).map((w) => w.text)
        const fixes = await d.proofreadCues(cues, { topic: summary.topic, genre: summary.genre, suspectWords })
        const part = partitionCorrections(cues, fixes)
        cues = applyCorrections(cues, part.safe)
        applied.push(...part.safe)
        suggestions.push(...part.unsafe)
      } catch (e) {
        extraFindings.push({ id: 'proofread-failed', severity: 'info', message: `자막 교정 점검을 하지 못했어요 (${(e as Error).message})`, fixHint: 'none' })
      }
    }

    // 9) 만들고 검수하고, 필요하면 최대 2번 다시 만든다
    let quality: Quality = o.quality ?? 'looks'
    const history: { attempt: number; reasons: string[]; actions: string[] }[] = []
    let attempt = 1
    let correctionsApplied = false // 검수 교정 때문에 도는 재작업은 1회로 제한한다(모델이 매번 다른 답을 내도 계속 렌더하지 않게)
    let qa: QaReport
    let renderedPath: string
    for (;;) {
      stage('build')
      const built = await d.buildProject({
        workDir: path.join(work, `attempt-${attempt}`),
        sourcePath: src,
        info,
        canvas,
        kept,
        cues,
        crop: cropPath ? remapKeyframes(cropPath.keyframes, kept) : undefined,
        reframe,
        style,
      })
      stage('render', `${quality} 화질`)
      const rendered = await d.renderProject(built.projectDir, { outPath: path.join(work, `render-${attempt}.mp4`), quality })
      renderedPath = rendered.outPath

      stage('qa')
      qa = await d.runQa({
        sourceInfo: info,
        outputPath: renderedPath,
        canvas,
        reframe,
        cues,
        words: outWords,
        maxChars,
        summary: { topic: summary.topic, genre: summary.genre },
        skipCaptions: captionsOff,
        purpose,
        sourcePath: src,
        kept,
      })

      const isActionable = (f: Finding): boolean => {
        if (f.severity !== 'high' || f.fixHint === 'none') return false
        if (f.fixHint === 'rerender-quality') return quality !== 'delivery' // 이미 최고 화질이면 다시 렌더해도 달라질 게 없다
        if (f.fixHint === 'recaption') return !captionsOff && applied.length === 0 // 교정을 이미 적용했다면 재묶기로 그 교정을 되돌리지 않는다
        if (f.fixHint === 'recrop') return track !== undefined
        return true
      }
      const actionable = qa.findings.filter(isActionable)
      const qaFixes = partitionCorrections(cues, qa.corrections)
      const useCorrections = qaFixes.safe.length > 0 && !correctionsApplied
      if (attempt >= MAX_ATTEMPTS || (actionable.length === 0 && !useCorrections)) {
        suggestions.push(...qaFixes.safe, ...qaFixes.unsafe) // 적용하지 못한 교정은 제안으로 남긴다
        break
      }

      stage('rework')
      const actions: string[] = []
      if (useCorrections) {
        cues = applyCorrections(cues, qaFixes.safe)
        applied.push(...qaFixes.safe)
        correctionsApplied = true
        actions.push(`자막 ${qaFixes.safe.length}곳 교정`)
      }
      const hints = new Set(actionable.map((f) => f.fixHint))
      if (hints.has('rerender-quality')) {
        quality = nextQuality(quality)
        actions.push(`${quality} 화질로 다시 렌더링`)
      }
      if (hints.has('recrop') && track) {
        cropPath = computeCrop({ timeConstantSec: 1.2, deadband: 0.06, preferLargest: true })
        actions.push('크롭을 더 부드럽게 다시 계산')
      }
      if (hints.has('recaption') && !useCorrections && !captionsOff && applied.length === 0) {
        maxChars = Math.max(6, maxChars - 2)
        cues = groupWordsIntoCues(outWords, { maxChars })
        actions.push(`자막을 한 줄 ${maxChars}자로 다시 묶음`)
      }
      history.push({ attempt, reasons: qa.findings.filter((f) => f.severity === 'high' || f.fixHint === 'recaption').map((f) => f.id), actions })
      attempt++
    }

    // 10) 산출물
    const cropFindings: Finding[] = (cropPath?.warnings ?? []).map((w) =>
      w === 'no-person'
        ? { id: 'crop-no-person', severity: 'medium', message: '사람을 찾지 못해 화면 중앙으로 잘랐어요.', fixHint: 'none' }
        : { id: 'crop-low-coverage', severity: 'medium', message: '사람이 보이는 구간이 적어서 일부는 화면 중앙으로 잘렸어요.', fixHint: 'none' },
    )
    const jitter = cropPath ? cropReversalsPerSec(cropPath.keyframes) : 0
    if (jitter > CROP_JITTER_PER_SEC) {
      cropFindings.push({
        id: 'crop-jitter',
        severity: 'medium',
        message: `크롭이 초당 ${jitter.toFixed(1)}번 좌우로 방향을 바꿔요. 사람이 여러 명이거나 움직임이 많은 영상이면 화면이 흔들려 보일 수 있어요.`,
        fixHint: 'none',
      })
    }
    const suggestionFindings: Finding[] = suggestions.map((s) => ({
      id: 'caption-suggestion',
      severity: 'info',
      message: `자막 ${s.index + 1}번을 "${s.text}" 로 고치는 게 좋을 수 있어요 (원문과 많이 달라서 자동으로 적용하지 않았어요).`,
      fixHint: 'none',
    }))
    const finalQa: QaReport = { ...qa, findings: [...qa.findings, ...extraFindings, ...cropFindings, ...suggestionFindings] }
    const resultPath = path.join(outDir, 'result.mp4')
    fs.copyFileSync(renderedPath, resultPath)

    fs.writeFileSync(
      path.join(outDir, 'report.json'),
      JSON.stringify(
        {
          schema: 1,
          createdAt: new Date().toISOString(),
          input: { path: o.videoPath, durationSec: info.durationSec, width: info.width, height: info.height },
          purpose: { resolved: purpose, guess, userChoice: o.purpose ?? 'auto' },
          summary,
          plan,
          planCard,
          reframe,
          cut: { removed: cutPlan.removed.length, keptDurationSec: cutPlan.keptDurationSec },
          quality,
          attempts: attempt,
          history,
          appliedCorrections: applied,
          suggestions,
          unchecked: UNCHECKED,
          qa: finalQa,
        },
        null,
        2,
      ),
    )

    stage('done')
    return { resultPath, purpose, plan, planCard, qa: finalQa, attempts: attempt, delivered: true, appliedCorrections: applied, suggestions, summary, reframe }
  } finally {
    if (!o.keepWork) fs.rmSync(work, { recursive: true, force: true })
  }
}
