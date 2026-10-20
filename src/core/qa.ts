import { run } from './exec.ts'
import { askClaude } from './llm.ts'
import { probeVideo } from './media.ts'
import { trackPeople } from './person.ts'
import {
  checkAudioLevels,
  checkBlackSegments,
  checkCueTiming,
  checkFraming,
  checkResolution,
  flagLowConfidence,
  parseBlackdetect,
  parseVolumeDetect,
  proofreadCues,
  type CueCorrection,
  type Finding,
} from './qaChecks.ts'
import type { Canvas, CaptionCue, ReframeMode, VideoInfo, Word } from './types.ts'

export interface QaInput {
  sourceInfo: VideoInfo
  outputPath: string
  canvas: Canvas
  reframe: ReframeMode
  cues: CaptionCue[]
  words: Word[]
  maxChars: number
  summary: { topic: string; genre: string }
}

export interface QaReport {
  /** high 가 하나도 없으면 true */
  passed: boolean
  findings: Finding[]
  /** 자막 교정 제안(적용 여부는 호출한 쪽이 정한다) */
  corrections: CueCorrection[]
  checkedAt: string
}

const LOW_CONFIDENCE = 0.5

export async function runQa(
  i: QaInput,
  deps: { ask?: typeof askClaude; track?: typeof trackPeople } = {},
): Promise<QaReport> {
  const track = deps.track ?? trackPeople
  const findings: Finding[] = []
  let corrections: CueCorrection[] = []

  // 1) 결과물 규격
  const out = await probeVideo(i.outputPath)
  if (out.durationSec < 0.1) findings.push({ id: 'output-empty', severity: 'high', message: '결과 영상이 비어 있어요.', fixHint: 'rerender-quality' })
  if (out.width !== i.canvas.width || out.height !== i.canvas.height) {
    findings.push({
      id: 'output-size',
      severity: 'high',
      message: `결과 영상 크기가 ${out.width}x${out.height} 로 목표(${i.canvas.width}x${i.canvas.height})와 달라요.`,
      fixHint: 'rerender-quality',
    })
  }
  if (i.sourceInfo.hasAudio && !out.hasAudio) {
    findings.push({ id: 'output-no-audio', severity: 'high', message: '원본에는 소리가 있었는데 결과 영상에 소리가 없어요.', fixHint: 'rerender-quality' })
  }

  // 2) 검은 화면
  const black = await run('ffmpeg', ['-hide_banner', '-nostdin', '-i', i.outputPath, '-vf', 'blackdetect=d=0.5:pix_th=0.10', '-an', '-f', 'null', '-'])
  findings.push(...checkBlackSegments(parseBlackdetect(black.stderr)))

  // 3) 오디오 레벨
  if (out.hasAudio) {
    const vol = await run('ffmpeg', ['-hide_banner', '-nostdin', '-i', i.outputPath, '-vn', '-af', 'volumedetect', '-f', 'null', '-'])
    findings.push(...checkAudioLevels(parseVolumeDetect(vol.stderr)))
  }

  // 4) 해상도(확대 배율)
  findings.push(...checkResolution(i.sourceInfo, i.canvas, i.reframe))

  // 5) 자막
  if (!i.words.length) {
    findings.push({ id: 'no-speech', severity: 'info', message: '음성이 없어 자막 점검을 건너뛰었어요.', fixHint: 'none' })
  } else {
    findings.push(...checkCueTiming(i.cues, out.durationSec, i.maxChars))
    findings.push(...flagLowConfidence(i.words, LOW_CONFIDENCE))
    const suspectWords = i.words.filter((w) => w.confidence < LOW_CONFIDENCE).map((w) => w.text)
    corrections = await proofreadCues(i.cues, { ...i.summary, suspectWords }, { ask: deps.ask })
    if (corrections.length) {
      findings.push({
        id: 'caption-corrections',
        severity: 'medium',
        message: `자막 ${corrections.length}곳에 오타·오인식 교정이 필요해 보여요.`,
        fixHint: 'recaption',
      })
    }
  }

  // 6) 세로 크롭의 인물 구도 (출력 영상에서 다시 찾은 위치로)
  if (i.reframe === 'track') findings.push(...checkFraming(await track(i.outputPath), i.reframe, i.canvas))

  return { passed: !findings.some((f) => f.severity === 'high'), findings, corrections, checkedAt: new Date().toISOString() }
}
