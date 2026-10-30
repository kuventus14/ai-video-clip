import fs from 'node:fs'
import path from 'node:path'
import { loadBrandBand, type BrandBand } from './brandBand.ts'
import { buildProject, chooseReframeMode, renderProject } from './compose.ts'
import { detectSilences, planCuts } from './cuts.ts'
import { deriveAppliedStyle, interpretRequest, planCardLines, type EditPlan } from './interpret.ts'
import { ensureH264, probeVideo } from './media.ts'
import { trackPeople, type PersonTrack } from './person.ts'
import { runQa, type QaReport } from './qa.ts'
import { applyCorrections, dropVerifiedCorrections, partitionCorrections, proofreadCues, upscaleFactor, type CueCorrection, type Finding } from './qaChecks.ts'
import { canvasFor, detectPurpose, resolvePurpose, type PurposeGuess } from './purpose.ts'
import { computeCropPath, cropReversalsPerSec, type CropPath } from './reframe.ts'
import { analyzeReference, detectSceneCuts, FEASIBILITY, type StyleSpec } from './styleSpec.ts'
import { fetchReference } from './reference.ts'
import { buildTimeline, groupWordsIntoCues, hookRepeatsOpening, remapKeyframes, remapWords, shiftCues, subtractSpans } from './timeline.ts'
import { echoesPrompt, transcribe } from './transcribe.ts'
import { applySound, type MixRecipe, type SoundReport } from './sound.ts'
import { clampGainDb } from '../shared/soundGain.ts'
import { balanceSound, speechRatio, type SoundBalance } from './soundBalance.ts'
import { directEdit, extractReferenceFrames } from './director.ts'
import { cropToContent, detectContentRect } from './letterbox.ts'
import { emptyScript, normalizeScript, SCRIPT_LIMITS, scriptCardLines, toRenderScript, type EditScript } from './script.ts'
import { applyTempo, scaleSec } from './tempo.ts'
import { enhanceVoice } from './voice.ts'
import type { SfxMode } from '../shared/sound.ts'
import type { CaptionPosition } from '../shared/types.ts'
import type { AudioMode } from '../shared/voice.ts'
import { describeVideo, type VideoSummary } from './understand.ts'
import type { CaptionCue, Purpose, ReframeMode, Span, Transcript, VideoInfo } from './types.ts'

export class InputError extends Error {
  kind: 'too-short' | 'too-long' | 'unreadable'
  constructor(kind: InputError['kind'], message: string) {
    super(message)
    this.name = 'InputError'
    this.kind = kind
  }
}

export type Stage = 'probe' | 'normalize' | 'transcribe' | 'reference' | 'purpose' | 'understand' | 'plan' | 'cuts' | 'direct' | 'track' | 'voice' | 'build' | 'render' | 'tempo' | 'mix' | 'qa' | 'rework' | 'done'
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
  /** 소리: 'original' 은 원본 그대로(기본), 'voice' 는 소음을 줄이고 목소리 크기를 맞춘다 */
  audio?: AudioMode
  /** 배경음악 곡 id (없거나 null 이면 넣지 않는다) / 효과음 켜기·끄기(기본 끄기) */
  bgm?: string | null
  sfx?: SfxMode
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
  enhanceVoice: typeof enhanceVoice
  applySound: typeof applySound
  /** 음악·효과음 크기를 AI 가 정한다(실패하면 기본 규칙 그대로). 제작 앞에서 한 번만 부른다 */
  balanceSound: typeof balanceSound
  /** 편집 감독(AI). 없으면 감독 단계를 건너뛰고 지금 방식(컷+자막)으로 만든다 */
  directEdit?: typeof directEdit
  /** 레퍼런스 장면 사진 만들기. 없으면 사진 없이 감독을 부른다 */
  extractReferenceFrames?: typeof extractReferenceFrames
  /** 렌더 뒤 속도 조정. 대본의 speed > 1 일 때만 쓴다 */
  applyTempo?: typeof applyTempo
  /** 가로 영상의 검은 띠 찾기·자르기. 둘 다 있어야 하고, 없으면 띠를 그대로 둔다 */
  detectContentRect?: typeof detectContentRect
  cropToContent?: typeof cropToContent
}

const DEFAULTS: PipelineDeps = {
  probeVideo, ensureH264, transcribe, detectSilences, detectSceneCuts, describeVideo, fetchReference, analyzeReference,
  interpretRequest, trackPeople, proofreadCues, buildProject, renderProject, runQa, enhanceVoice, applySound, balanceSound, directEdit, extractReferenceFrames, applyTempo, detectContentRect, cropToContent,
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
  '배경음악·효과음이 영상과 어울리는지(귀로 들어 보는 확인)',
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
  if (reframe === 'blur-fill') {
    const wider = info.width / info.height > canvas.width / canvas.height
    lines.push(
      wider
        ? `• 화면 구성: 원본을 자르지 않고 ${target} 화면 가운데에 두고 위아래를 흐린(블러) 배경으로 채워요`
        : `• 화면 구성: 원본이 ${info.height > info.width ? '세로' : '정사각'}라서 ${target} 화면 가운데에 두고 양옆을 흐린(블러) 배경으로 채워요`,
    )
  }
  const f = upscaleFactor(info, canvas, reframe)
  if (f > 1.5) lines.push(`• 주의: 원본 해상도가 낮아 화면이 ${f.toFixed(1)}배로 확대돼요. 선명도가 떨어질 수 있어요`)
  return lines
}

const hintFromSummary = (s: VideoSummary) => [s.topic, s.genre, ...s.searchQueries].join(', ').slice(0, HINT_MAX_CHARS)

type StageCallback = (s: Stage, detail?: string) => void

/** 입력 영상 길이 한도(1초~10분). 워커의 probe 단계도 올리자마자 같은 기준으로 알려 준다. */
export function assertDurationOk(durationSec: number): void {
  if (durationSec < MIN_SEC) throw new InputError('too-short', `영상이 너무 짧아요 (${durationSec.toFixed(1)}초). 1초 이상이어야 해요.`)
  if (durationSec > MAX_SEC) throw new InputError('too-long', `영상이 너무 길어요 (${Math.round(durationSec)}초). 10분 이하로 올려 주세요.`)
}

/** 1단계 결과 — 영상을 이해한 내용. JSON 으로 저장했다 읽어도 그대로 쓸 수 있다(앱은 analysis.json 으로 보관). */
export interface Analysis {
  version: 1
  description?: string
  /** H.264 로 변환했다면 변환본, 아니면 원본 경로 */
  sourcePath: string
  info: VideoInfo
  transcript: Transcript
  summary: VideoSummary
  purposeGuess: PurposeGuess
  /** 분석 때 레퍼런스를 함께 받았다면(CLI 경로) 그 정보 */
  referenceInfo?: VideoInfo
  spec?: StyleSpec
}

/** 2단계 결과 — 사용자에게 보여 줄 "이렇게 이해했어요" 와 실제 편집 방침. JSON 으로 저장했다 읽어도 된다(앱은 prepared.json). */
export interface Prepared {
  purpose: Purpose
  /** 사용자가 고른 값(자동이면 'auto') */
  purposeChoice: Purpose | 'auto'
  purposeGuess: PurposeGuess
  plan: EditPlan
  planCard: string[]
  reframe: ReframeMode
  referenceSource?: string
  /** 이 계획으로 만들면 자막이 놓일 위치(레퍼런스를 따르거나 기본 하단). 승인 화면의 기본값으로 쓰고 사용자가 바꿀 수 있다 */
  captionPosition: CaptionPosition
  /** AI 편집 감독이 짠 편집 대본. 없으면(감독 실패·건너뜀) 지금 방식(컷+자막)으로 만든다 */
  script?: EditScript
  /** 대본을 정리하며 뺀 것 등 사용자에게 알려 줄 노트 */
  directorNotes?: string[]
  spec?: StyleSpec
}

export interface AnalyzeInput {
  videoPath: string
  workDir: string
  description?: string
  /** 앱은 분석 뒤에 레퍼런스를 고르므로 넘기지 않는다. CLI(runEdit)만 넘긴다. */
  reference?: string
  onStage?: StageCallback
}

const REF_FRAMES_DIR = 'ref-frames'

/** 레퍼런스를 받아 스타일을 분석하고, AI 편집 감독이 볼 장면 사진을 작업 폴더에 남긴 뒤 원본은 지운다(스펙: 레퍼런스 원본은 남기지 않는다). */
async function fetchAndAnalyzeReference(d: PipelineDeps, source: string, workDir: string): Promise<{ spec: StyleSpec; info: VideoInfo }> {
  const ref = await d.fetchReference(source, path.join(workDir, 'ref'))
  try {
    const spec = await d.analyzeReference({ path: ref.path, info: ref.info })
    const framesDir = path.join(workDir, REF_FRAMES_DIR)
    fs.rmSync(framesDir, { recursive: true, force: true })
    try {
      await d.extractReferenceFrames?.(ref.path, ref.info.durationSec, framesDir)
    } catch {
      fs.rmSync(framesDir, { recursive: true, force: true }) // 사진을 못 만들어도 분석은 계속한다(감독이 사진 없이 돈다)
    }
    return { spec, info: ref.info }
  } finally {
    await ref.cleanup()
  }
}

function readRefFrames(workDir: string): string[] {
  const dir = path.join(workDir, REF_FRAMES_DIR)
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort().map((f) => path.join(dir, f)) : []
}

/** 파일 정보 없이 스펙만 있을 때, 레퍼런스의 방향을 용도 인식용 가짜 크기로 바꾼다. */
function referenceSizeOf(spec: StyleSpec): { width: number; height: number } {
  return spec.orientation === 'portrait' ? { width: 1080, height: 1920 } : spec.orientation === 'landscape' ? { width: 1920, height: 1080 } : { width: 1080, height: 1080 }
}

/** 1단계: 입력 확인 → (변환) → 음성 인식 → (레퍼런스) → 용도 추정 → 영상 이해 */
export async function analyzeInput(i: AnalyzeInput, overrides: Partial<PipelineDeps> = {}): Promise<Analysis> {
  const d: PipelineDeps = { ...DEFAULTS, ...overrides }
  const stage: StageCallback = (s, detail) => i.onStage?.(s, detail)

  stage('probe')
  let info: VideoInfo
  try {
    info = await d.probeVideo(i.videoPath)
  } catch (e) {
    throw new InputError('unreadable', `영상을 읽을 수 없어요: ${(e as Error).message}`)
  }
  assertDurationOk(info.durationSec)

  const norm = await d.ensureH264(i.videoPath, info, i.workDir)
  if (norm.converted) stage('normalize', 'H.264 mp4 로 변환했어요')
  let src = norm.path
  info = norm.info

  // 위아래·양옆의 검은 띠(와 그 안의 글자)는 잘라내고 화면 부분만 쓴다. 못 찾거나 자르지 못하면 원본 그대로 진행한다.
  if (d.detectContentRect && d.cropToContent) {
    try {
      const rect = await d.detectContentRect(src, info)
      if (rect) {
        const cropped = await d.cropToContent({ inputPath: src, outPath: path.join(i.workDir, 'source-cropped.mp4'), rect, hasAudio: info.hasAudio })
        info = await d.probeVideo(cropped)
        src = cropped
        stage('normalize', `검은 띠를 잘라냈어요 (${info.width}x${info.height})`)
      }
    } catch {
      /* 띠 제거는 덤이다 — 실패해도 원본으로 계속한다 */
    }
  }

  // 음성 인식 (설명이 있으면 처음부터 용어 힌트로. 인식기가 힌트를 받아 적었으면 힌트 없이 다시 한다)
  const description = (i.description ?? '').trim()
  stage('transcribe')
  let transcript: Transcript
  if (description) {
    const prompt = description.slice(0, HINT_MAX_CHARS)
    const hinted = await d.transcribe(src, { prompt })
    transcript = echoesPrompt(hinted, prompt) ? await d.transcribe(src) : hinted
  } else {
    transcript = await d.transcribe(src)
  }

  // 레퍼런스: 분석하고 곧바로 지운다
  let spec: StyleSpec | undefined
  let refInfo: VideoInfo | undefined
  if (i.reference) {
    stage('reference')
    ;({ spec, info: refInfo } = await fetchAndAnalyzeReference(d, i.reference, i.workDir))
  }

  stage('purpose')
  const purposeGuess = detectPurpose({ info, reference: refInfo, description })

  stage('understand')
  const summary = await d.describeVideo({ info, transcript, userDescription: i.description, workDir: i.workDir })
  const lowCount = transcript.words.filter((w) => w.confidence < LOW_CONFIDENCE).length
  if (transcript.hasSpeech && !description && lowCount >= HINT_RETRANSCRIBE_MIN_LOW_WORDS) {
    stage('transcribe', '전문 용어 힌트로 다시 인식해요')
    const prompt = hintFromSummary(summary)
    const retried = await d.transcribe(src, { prompt })
    if (!echoesPrompt(retried, prompt)) transcript = retried // 힌트를 받아 적었으면 처음(힌트 없는) 결과를 쓴다
  }

  return { version: 1, description: description || undefined, sourcePath: src, info, transcript, summary, purposeGuess, referenceInfo: refInfo, spec }
}

export interface PrepareInput {
  analysis: Analysis
  workDir: string
  /** 새로 고른 레퍼런스(링크 또는 파일 경로) */
  reference?: string
  /** 이미 분석한 같은 레퍼런스의 스타일 명세서 — 있으면 다시 받지 않는다 */
  knownSpec?: StyleSpec
  request?: string
  purposeChoice: Purpose | 'auto'
  onStage?: StageCallback
  /** 사용자가 자막 확인에서 지운 줄의 시간 구간 — 편집 감독에게 알린다(그 구간을 덜어내지 않게) */
  deletedSpans?: Span[]
}

/** 결과 영상 길이 상한: 릴스·숏츠(세로)는 60초, 게시물(가로)은 없음 */
export const maxOutputSecFor = (purpose: Purpose): number | undefined => (purpose === 'short' ? SCRIPT_LIMITS.shortMaxSec : undefined)

/** "이렇게 이해했어요" 카드의 길이 안내 줄 */
export function lengthCardLines(durationSec: number, maxOutputSec?: number): string[] {
  if (maxOutputSec === undefined) return []
  return durationSec > maxOutputSec
    ? [`• 길이: ${Math.round(durationSec)}초라서 핵심만 골라 ${maxOutputSec}초 이하로 줄여요`]
    : [`• 길이: ${maxOutputSec}초 이하라 길이는 그대로 두고 편집만 해요`]
}

/**
 * 결과가 상한을 넘지 않게 남길 구간을 줄인다(편집 감독이 덜 뺐거나 대본이 없을 때의 안전장치).
 * 훅이 결과를 앞에서 보여 주므로 본편은 앞에서부터 이어 붙이고 넘치는 뒤쪽을 자른다. 출력 길이 = (훅 + 본편) / 속도.
 */
export function capKeptToOutput(kept: Span[], o: { maxOutputSec: number; hookSec: number; speed: number }): Span[] {
  let room = o.maxOutputSec * o.speed - o.hookSec
  const out: Span[] = []
  for (const k of kept) {
    if (room <= 0.3) break
    const len = k.end - k.start
    if (len <= room) {
      out.push(k)
      room -= len
    } else {
      out.push({ start: k.start, end: Math.round((k.start + room) * 1000) / 1000 })
      room = 0
    }
  }
  return out.length ? out : kept.slice(0, 1)
}

/** 2단계: (레퍼런스 받기·분석) → 용도 확정 → 요청 해석 → "이렇게 이해했어요" 카드 */
export async function prepareEdit(i: PrepareInput, overrides: Partial<PipelineDeps> = {}): Promise<Prepared> {
  const d: PipelineDeps = { ...DEFAULTS, ...overrides }
  const stage: StageCallback = (s, detail) => i.onStage?.(s, detail)
  const a = i.analysis

  let spec = i.knownSpec ?? (i.reference ? undefined : a.spec)
  let refInfo = a.referenceInfo
  if (!spec && i.reference) {
    stage('reference')
    ;({ spec, info: refInfo } = await fetchAndAnalyzeReference(d, i.reference, i.workDir))
  }

  // 용도는 레퍼런스가 정해진 지금 다시 정한다. 사용자가 고른 값이 항상 우선.
  const purposeGuess = detectPurpose({ info: a.info, reference: refInfo ?? (spec ? referenceSizeOf(spec) : undefined), description: a.description })
  const purpose = resolvePurpose(purposeGuess, i.purposeChoice)
  const canvas = canvasFor(purpose)

  stage('plan')
  const specUsed = spec ?? defaultStyleSpec(purpose)
  const plan = await d.interpretRequest({ spec: specUsed, userText: i.request, summary: a.summary, hasReference: spec !== undefined })
  const reframe = chooseReframeMode(a.info, canvas)
  const baseCard = !spec && !(i.request ?? '').trim()
    ? [
        '이렇게 이해했어요: 레퍼런스가 없어서 기본 스타일로 편집해요.',
        '• 컷: 말 사이의 긴 쉼과 "음·어" 같은 군더더기를 정리해요',
        '• 자막: 말하는 대로 넣고, 오타·오인식은 검수에서 고쳐요',
      ]
    : planCardLines(plan, specUsed)
  const maxOutputSec = maxOutputSecFor(purpose)
  const planCard = [...baseCard, ...reframeCardLines(reframe, a.info, canvas), ...lengthCardLines(a.info.durationSec, maxOutputSec)]
  const captionPosition = deriveAppliedStyle(plan, specUsed, a.summary, purpose).captions.position

  // 편집 감독: 영상·대본·(레퍼런스 사진)을 보고 편집 대본을 짠다. 실패해도 작업을 막지 않고 지금 방식으로 되돌아간다.
  let script: EditScript | undefined
  let directorNotes: string[] | undefined
  let finalCard = planCard
  if (d.directEdit) {
    stage('direct')
    try {
      const out = await d.directEdit({ info: a.info, transcript: a.transcript, summary: a.summary, sourcePath: a.sourcePath, spec, refFrames: spec ? readRefFrames(i.workDir) : [], workDir: i.workDir, deletedSpans: i.deletedSpans, maxOutputSec })
      // 감독 구현이 무엇을 돌려주든 대본을 한 번 더 정리한다(영상이 10초 이하면 제목만 등) — 정리는 여러 번 해도 같다
      const clean = normalizeScript(out.script, { durationSec: a.info.durationSec, fallbackTitle: a.summary.hookTitle || a.summary.genre || a.summary.topic, maxOutputSec })
      script = clean.script
      directorNotes = [...out.notes, ...clean.notes]
    } catch {
      script = undefined
    }
    if (script) finalCard = [...planCard.filter((l) => !l.startsWith('• 영상 구성')), ...scriptCardLines(script)]
    else finalCard = [...planCard.filter((l) => !l.startsWith('• 영상 구성')), '• 편집 구성을 AI가 짜지 못해서 기본 방식(컷+자막)으로 만들어요']
  }
  return { purpose, purposeChoice: i.purposeChoice, purposeGuess, plan, planCard: finalCard, reframe, referenceSource: i.reference, captionPosition, ...(script ? { script, directorNotes } : {}), spec }
}

export interface ProduceInput {
  analysis: Analysis
  prepared: Prepared
  outDir: string
  /** 주지 않으면 outDir 안에 고유 작업 폴더를 만들고 끝나면(keepWork 가 아니면) 지운다 */
  workDir?: string
  quality?: Quality
  captions?: 'auto' | 'off'
  /** 주면 계획이 정한 위치 대신 이 위치에 자막을 둔다 */
  captionPosition?: CaptionPosition
  /** 승인 화면에서 사용자가 문구를 고친 편집 대본. 없으면 prepared.script 를 쓴다 */
  script?: EditScript
  audio?: AudioMode
  bgm?: string | null
  sfx?: SfxMode
  /** true 면 결과 폴더에 다시 섞기용 dry.mp4·mix.json 을 남기고(소리를 안 쓰면 옛 파일을 지운다). 웹 앱의 워커만 켠다 — CLI 의 --out 폴더에는 사용자 파일이 있을 수 있어 건드리지 않는다 */
  remixFiles?: boolean
  /** 사용자가 결과 화면에서 직접 조절해 둔 음악·효과음 크기(dB). 있으면 AI 추천 대신 이 값으로 입히고(쓰지 않는 소리는 0), AI 추천은 되돌리기용으로 남긴다 */
  soundGain?: { bgmGainDb: number; sfxGainDb: number }
  keepWork?: boolean
  onStage?: StageCallback
  /**
   * 컷을 계산할 때 쓰는 인식 결과. 주지 않으면 analysis.transcript. 사용자가 자막을 고치거나 지워도(analysis.transcript 가 바뀌어도)
   * 영상은 달라지지 않게 원래 인식 결과를 준다 — 지운 줄의 구간이 무음으로 잘려 나가면 안 된다.
   */
  cutTranscript?: Transcript
  /** 채널 띠(위: 제목, 아래: 채널명). 주지 않으면 assets/brand/brand.json 을 읽고(세로 용도에만), null 이면 띠 없이 만든다 */
  brand?: BrandBand | null
}

/** 3단계: 컷 → (사람 추적) → 자막 → 만들기·검수·재작업 → result.mp4 와 report.json */
export async function produceEdit(i: ProduceInput, overrides: Partial<PipelineDeps> = {}): Promise<EditResult> {
  const d: PipelineDeps = { ...DEFAULTS, ...overrides }
  const stage: StageCallback = (s, detail) => i.onStage?.(s, detail)
  const outDir = path.resolve(i.outDir)
  fs.mkdirSync(outDir, { recursive: true })
  // 이 실행이 직접 만든 고유 폴더만 쓰고 지운다 — 결과 폴더에 원래 있던 파일은 건드리지 않는다
  const ownWork = i.workDir === undefined
  const work = i.workDir ?? fs.mkdtempSync(path.join(outDir, '.vae-work-'))

  const { analysis, prepared } = i
  const { info, transcript, summary } = analysis
  const src = analysis.sourcePath
  const { purpose, plan, planCard, reframe } = prepared
  const guess = prepared.purposeGuess
  const canvas = canvasFor(purpose)
  const style = deriveAppliedStyle(plan, prepared.spec ?? defaultStyleSpec(purpose), summary, purpose)
  if (i.captionPosition) style.captions.position = i.captionPosition
  // 편집 대본이 있으면 대본의 제목·훅 질문이 옛 제목 카드를 대신한다
  const script = i.script ?? prepared.script
  if (script) delete style.hookTitle
  const brand = i.brand === undefined ? loadBrandBand(purpose) : (i.brand ?? undefined)

  try {
    // 6) 컷
    stage('cuts')
    const silences = await d.detectSilences(src)
    const cutPlan = planCuts({ transcript: i.cutTranscript ?? transcript, silences, durationSec: info.durationSec, padSec: style.padSec })
    let kept: Span[] = cutPlan.kept.length ? cutPlan.kept : [{ start: 0, end: info.durationSec }]
    // 편집 감독이 "빼도 된다"고 한 약한 구간을 뺀다(다 지워 버리면 쓰지 않는다)
    if (script?.drop.length) {
      const trimmed = subtractSpans(kept, script.drop)
      if (trimmed.length) kept = trimmed
    }
    // 훅 장면을 맨 앞에 붙인 출력 타임라인(훅이 없으면 kept 그대로)
    // 훅이 영상 맨 앞 장면이면 앞에 또 붙이지 않고(같은 말이 연달아 두 번 나온다) 질문만 본편 첫머리 위에 띄운다
    const hookSpan = script?.hook ? { start: script.hook.sourceStart, end: script.hook.sourceEnd } : undefined
    const hookInPlace = hookSpan !== undefined && hookRepeatsOpening(hookSpan, kept, SCRIPT_LIMITS.hookMaxSec)
    const speed = script?.speed ?? 1
    const tempoOn = speed > 1.001 && d.applyTempo !== undefined
    const effSpeed = tempoOn ? speed : 1
    // 릴스·숏츠는 결과가 60초를 넘지 않게: 감독이 덜 뺐으면 넘치는 뒤쪽을 자른다
    const maxOutputSec = maxOutputSecFor(purpose)
    const lengthFindings: Finding[] = []
    if (maxOutputSec !== undefined) {
      const hookLen = hookSpan && !hookInPlace ? hookSpan.end - hookSpan.start : 0
      const before = (hookLen + kept.reduce((a, k) => a + k.end - k.start, 0)) / effSpeed
      if (before > maxOutputSec + 0.05) {
        kept = capKeptToOutput(kept, { maxOutputSec, hookSec: hookLen, speed: effSpeed })
        lengthFindings.push({ id: 'length-capped', severity: 'info', message: `결과가 ${Math.round(before)}초라서 ${maxOutputSec}초에 맞게 뒤쪽을 잘랐어요`, fixHint: 'none' })
      }
    }
    const timeline = buildTimeline(kept, hookInPlace ? undefined : hookSpan)
    const hookSec = timeline.hookSec
    let renderScript = script ? toRenderScript(script, kept, hookSec, timeline.totalSec) : undefined
    if (renderScript && script?.hook && hookInPlace) {
      const sec = Math.min(script.hook.sourceEnd - script.hook.sourceStart, timeline.totalSec)
      renderScript = { ...renderScript, hook: { sec, question: script.hook.question }, hookSec: sec }
    }
    // 자막·단어 시각은 본편(kept) 기준으로 만들고, 쓸 때 훅 길이만큼 밀고 속도로 나눈다
    const outTime = <T extends { start: number; end: number }>(xs: T[], toBuild: boolean): T[] => {
      const shifted = shiftCues(xs, hookSec)
      return toBuild ? shifted : shifted.map((x) => ({ ...x, start: scaleSec(x.start, effSpeed), end: scaleSec(x.end, effSpeed) }))
    }

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
    const captionsOff = i.captions === 'off'
    let maxChars = style.captions.maxChars
    let cues: CaptionCue[] = captionsOff ? [] : groupWordsIntoCues(outWords, { maxChars })
    const applied: CueCorrection[] = []
    const suggestions: CueCorrection[] = []
    const extraFindings: Finding[] = []
    if (cues.length) {
      try {
        const suspectWords = outWords.filter((w) => w.confidence < LOW_CONFIDENCE).map((w) => w.text)
        // 사용자가 자막 확인에서 고친 글자(신뢰도 1)가 든 줄은 교정이 다시 바꾸지 않는다
        const fixes = dropVerifiedCorrections(cues, outWords, await d.proofreadCues(cues, { topic: summary.topic, genre: summary.genre, suspectWords }))
        const part = partitionCorrections(cues, fixes)
        cues = applyCorrections(cues, part.safe)
        applied.push(...part.safe)
        suggestions.push(...part.unsafe)
      } catch (e) {
        extraFindings.push({ id: 'proofread-failed', severity: 'info', message: `자막 교정 점검을 하지 못했어요 (${(e as Error).message})`, fixHint: 'none' })
      }
    }

    // 8-2) 목소리 보정: 소리만 정리한 영상을 한 번 만들어 두고, 재작업을 포함한 모든 렌더가 그것을 쓴다
    let renderSrc = src
    if (i.audio === 'voice' && info.hasAudio) {
      stage('voice')
      renderSrc = await d.enhanceVoice({ sourcePath: src, outPath: path.join(work, 'source-voice.mp4'), workDir: path.join(work, 'voice'), durationSec: info.durationSec })
    }

    // 9) 만들고 검수하고, 필요하면 최대 2번 다시 만든다
    let quality: Quality = i.quality ?? 'looks'
    const history: { attempt: number; reasons: string[]; actions: string[] }[] = []
    let attempt = 1
    let correctionsApplied = false // 검수 교정 때문에 도는 재작업은 1회로 제한한다(모델이 매번 다른 답을 내도 계속 렌더하지 않게)
    let qa: QaReport
    let renderedPath: string
    let soundReport: SoundReport | undefined
    let dryPath: string | undefined // 마지막 시도의, 소리를 입히기 전 렌더 — 다시 섞을 수 있게 결과 폴더에 남긴다
    let mixRecipe: MixRecipe | undefined
    const wantsSound = Boolean(i.bgm) || i.sfx === 'on'
    // 음악·효과음 크기는 영상 내용을 보고 한 번만 정한다(재작업으로 다시 입혀도 같은 값). 실패하면 기본 규칙(0, 0)
    const balance: SoundBalance = wantsSound
      ? await d.balanceSound({ summary, speechRatio: speechRatio(i.cutTranscript ?? transcript, info.durationSec), bgmId: i.bgm ?? null, sfxOn: i.sfx === 'on' })
      : { bgmGainDb: 0, sfxGainDb: 0, reason: '' }
    // 사용자가 직접 조절한 크기가 있으면 그 값으로 입힌다(이번에 쓰는 소리에만). AI 추천(balance)은 리포트·되돌리기용으로 그대로 둔다.
    const gains = i.soundGain
      ? { bgmGainDb: i.bgm ? clampGainDb(i.soundGain.bgmGainDb) : 0, sfxGainDb: i.sfx === 'on' ? clampGainDb(i.soundGain.sfxGainDb) : 0 }
      : { bgmGainDb: balance.bgmGainDb, sfxGainDb: balance.sfxGainDb }
    for (;;) {
      stage('build')
      const built = await d.buildProject({
        workDir: path.join(work, `attempt-${attempt}`),
        sourcePath: renderSrc,
        info,
        canvas,
        kept: timeline.segments,
        cues: outTime(cues, true),
        crop: cropPath ? remapKeyframes(cropPath.keyframes, timeline.segments) : undefined,
        reframe,
        style,
        script: renderScript,
        brand,
      })
      stage('render', `${quality} 화질`)
      const rendered = await d.renderProject(built.projectDir, { outPath: path.join(work, `render-${attempt}.mp4`), quality })
      renderedPath = rendered.outPath

      // 속도 조정: 자막·오버레이가 이미 입혀진 영상 전체를 같은 배수로 빠르게 한다(어긋나지 않는다)
      if (tempoOn) {
        stage('tempo', `${speed}배`)
        renderedPath = await d.applyTempo!({ inputPath: renderedPath, outPath: path.join(work, `tempo-${attempt}.mp4`), speed, hasAudio: info.hasAudio })
      }

      // 배경음악·효과음: 렌더가 끝난 영상에 입히고, 검수는 입힌 결과를 본다(재작업으로 다시 렌더할 때마다 다시 입힌다)
      if (wantsSound) {
        stage('mix')
        dryPath = renderedPath
        const mixed = await d.applySound({
          renderedPath,
          outPath: path.join(work, `mix-${attempt}.mp4`),
          choice: { bgm: i.bgm ?? null, sfx: i.sfx ?? 'off' },
          kept: timeline.segments,
          hookTitle: Boolean(script?.hook) || style.hookTitle !== undefined,
          durationSec: scaleSec(built.durationSec, effSpeed),
          hasAudio: info.hasAudio,
          hasSpeech: (i.cutTranscript ?? transcript).hasSpeech, // 자막을 다 지워도 말이 있는 영상이다(음악 크기를 목소리에 맞춰 잰다)
          speed: effSpeed,
          gains,
        })
        renderedPath = mixed.path
        soundReport = { ...mixed.report, balance: { ...gains, aiBgmGainDb: balance.bgmGainDb, aiSfxGainDb: balance.sfxGainDb, reason: balance.reason } }
        mixRecipe = { ...mixed.recipe, ai: balance }
      }

      stage('qa')
      qa = await d.runQa({
        sourceInfo: info,
        outputPath: renderedPath,
        canvas,
        reframe,
        cues: outTime(cues, false),
        words: outTime(outWords, false),
        maxChars,
        summary: { topic: summary.topic, genre: summary.genre },
        skipCaptions: captionsOff,
        purpose,
        sourcePath: src,
        kept: timeline.segments,
        speed: effSpeed,
      })

      const isActionable = (f: Finding): boolean => {
        if (f.severity !== 'high' || f.fixHint === 'none') return false
        if (f.fixHint === 'rerender-quality') return quality !== 'delivery' // 이미 최고 화질이면 다시 렌더해도 달라질 게 없다
        if (f.fixHint === 'recaption') return !captionsOff && applied.length === 0 // 교정을 이미 적용했다면 재묶기로 그 교정을 되돌리지 않는다
        if (f.fixHint === 'recrop') return track !== undefined
        return true
      }
      const actionable = qa.findings.filter(isActionable)
      const qaFixes = partitionCorrections(cues, dropVerifiedCorrections(cues, outWords, qa.corrections)) // 검수가 낸 교정도 사용자가 고친 줄에는 쓰지 않는다
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
    if (i.sfx === 'on' && soundReport?.sfxCount === 0) {
      extraFindings.push({ id: 'sfx-none', severity: 'info', message: '효과음을 켰지만 넣을 곳(컷이 바뀌는 순간·제목 카드)이 없어서 넣지 않았어요.', fixHint: 'none' })
    }
    const finalQa: QaReport = { ...qa, findings: [...qa.findings, ...extraFindings, ...lengthFindings, ...cropFindings, ...suggestionFindings] }
    const resultPath = path.join(outDir, 'result.mp4')
    // 소리만 다시 섞을 수 있게 소리 없는 렌더와 섞는 방법을 남긴다(remixFiles 일 때만). 이번에 소리를 안 썼다면 같은 폴더의 옛 파일을 지운다(다시 섞기가 열리면 안 된다).
    const dryOut = path.join(outDir, 'dry.mp4')
    const recipeOut = path.join(outDir, 'mix.json')
    if (i.remixFiles && dryPath && mixRecipe) {
      fs.copyFileSync(dryPath, dryOut)
      fs.writeFileSync(recipeOut, JSON.stringify(mixRecipe))
    } else if (i.remixFiles) {
      fs.rmSync(dryOut, { force: true })
      fs.rmSync(recipeOut, { force: true })
    }
    fs.copyFileSync(renderedPath, resultPath)

    fs.writeFileSync(
      path.join(outDir, 'report.json'),
      JSON.stringify(
        {
          schema: 1,
          createdAt: new Date().toISOString(),
          input: { path: info.path, durationSec: info.durationSec, width: info.width, height: info.height },
          purpose: { resolved: purpose, guess, userChoice: prepared.purposeChoice },
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
          unchecked: script ? [...UNCHECKED, 'AI 가 쓴 문구(제목·질문·소제목)가 영상 내용과 맞는지(사람이 읽어 보는 확인)'] : UNCHECKED,
          ...(script ? { script, directorNotes: prepared.directorNotes ?? [] } : {}),
          ...(soundReport ? { sound: soundReport } : {}),
          qa: finalQa,
        },
        null,
        2,
      ),
    )

    stage('done')
    return { resultPath, purpose, plan, planCard, qa: finalQa, attempts: attempt, delivered: true, appliedCorrections: applied, suggestions, summary, reframe }
  } finally {
    if (ownWork && !i.keepWork) fs.rmSync(work, { recursive: true, force: true })
  }
}

/** 세 단계를 이어 한 번에 끝낸다 (CLI). 단계 순서·동작은 세 함수로 나누기 전과 같다. */
export async function runEdit(o: EditOptions, overrides: Partial<PipelineDeps> = {}): Promise<EditResult> {
  const outDir = path.resolve(o.outDir)
  fs.mkdirSync(outDir, { recursive: true })
  // 이 실행이 직접 만든 고유 폴더만 쓰고 지운다 — 결과 폴더에 원래 있던 파일은 건드리지 않는다
  const work = fs.mkdtempSync(path.join(outDir, '.vae-work-'))
  try {
    const analysis = await analyzeInput({ videoPath: o.videoPath, workDir: work, description: o.description, reference: o.reference, onStage: o.onStage }, overrides)
    const prepared = await prepareEdit({ analysis, workDir: work, request: o.request, purposeChoice: o.purpose ?? 'auto', onStage: o.onStage }, overrides)
    o.onPlan?.(prepared.planCard, prepared.purpose)
    return await produceEdit({ analysis, prepared, outDir, workDir: work, quality: o.quality, captions: o.captions, audio: o.audio, bgm: o.bgm, sfx: o.sfx, onStage: o.onStage }, overrides)
  } finally {
    if (!o.keepWork) fs.rmSync(work, { recursive: true, force: true })
  }
}
