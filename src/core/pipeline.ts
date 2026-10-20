import fs from 'node:fs'
import path from 'node:path'
import { buildProject, chooseReframeMode, renderProject } from './compose.ts'
import { detectSilences, planCuts } from './cuts.ts'
import { deriveAppliedStyle, interpretRequest, planCardLines, type EditPlan } from './interpret.ts'
import { ensureH264, probeVideo } from './media.ts'
import { trackPeople, type PersonTrack } from './person.ts'
import { runQa, type QaReport } from './qa.ts'
import { applyCorrections, proofreadCues, upscaleFactor, type CueCorrection, type Finding } from './qaChecks.ts'
import { canvasFor, detectPurpose, resolvePurpose } from './purpose.ts'
import { computeCropPath, type CropPath } from './reframe.ts'
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
  /** 작업 폴더(<outDir>/work)를 끝난 뒤에도 남긴다 */
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
const LADDER: Quality[] = ['draft', 'looks', 'delivery']
const nextQuality = (q: Quality): Quality => LADDER[Math.min(LADDER.length - 1, LADDER.indexOf(q) + 1)]!

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
  const work = path.join(outDir, 'work')
  fs.mkdirSync(outDir, { recursive: true })
  fs.rmSync(work, { recursive: true, force: true })
  fs.mkdirSync(work, { recursive: true })

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
    const plan = await d.interpretRequest({ spec: specUsed, userText: o.request, summary })
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
      shotCuts = await d.detectSceneCuts(src)
      cropPath = computeCrop()
    }

    // 8) 자막: 컷 이후 시간으로 바꾸고, 렌더 전에 한 번 교정한다
    const outWords = remapWords(transcript.words, kept)
    const captionsOff = o.captions === 'off'
    let maxChars = style.captions.maxChars
    let cues: CaptionCue[] = captionsOff ? [] : groupWordsIntoCues(outWords, { maxChars })
    const applied: CueCorrection[] = []
    if (cues.length) {
      const suspectWords = outWords.filter((w) => w.confidence < LOW_CONFIDENCE).map((w) => w.text)
      const fixes = await d.proofreadCues(cues, { topic: summary.topic, genre: summary.genre, suspectWords })
      cues = applyCorrections(cues, fixes)
      applied.push(...fixes)
    }

    // 9) 만들고 검수하고, 필요하면 최대 2번 다시 만든다
    let quality: Quality = o.quality ?? 'looks'
    const history: { attempt: number; reasons: string[]; actions: string[] }[] = []
    let attempt = 1
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
      })

      const actionable = qa.findings.filter((f) => f.severity === 'high' && f.fixHint !== 'none')
      if ((actionable.length === 0 && qa.corrections.length === 0) || attempt >= MAX_ATTEMPTS) break

      stage('rework')
      const actions: string[] = []
      if (qa.corrections.length) {
        cues = applyCorrections(cues, qa.corrections)
        applied.push(...qa.corrections)
        actions.push(`자막 ${qa.corrections.length}곳 교정`)
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
      if (hints.has('recaption') && !qa.corrections.length && !captionsOff) {
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
    const finalQa: QaReport = { ...qa, findings: [...qa.findings, ...cropFindings] }
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
          qa: finalQa,
        },
        null,
        2,
      ),
    )

    stage('done')
    return { resultPath, purpose, plan, planCard, qa: finalQa, attempts: attempt, delivered: true, appliedCorrections: applied, summary, reframe }
  } finally {
    if (!o.keepWork) fs.rmSync(work, { recursive: true, force: true })
  }
}
