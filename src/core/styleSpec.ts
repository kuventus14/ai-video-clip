import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { run } from './exec.ts'
import { askClaude } from './llm.ts'
import { extractFrames } from './media.ts'
import type { VideoInfo } from './types.ts'

export const STYLE_FIELDS = ['pacing', 'captions', 'hookTitle', 'transitions', 'music', 'structure', 'orientation'] as const
export type StyleField = (typeof STYLE_FIELDS)[number]

export const Feasibility = z.enum(['exact', 'approximate', 'unsupported'])
export type Feasibility = z.infer<typeof Feasibility>

/** 첫 버전에서 레퍼런스의 각 요소를 얼마나 따라 할 수 있는지. LLM 이 아니라 코드가 정한다. */
export const FEASIBILITY: Record<StyleField, Feasibility> = {
  pacing: 'exact',
  captions: 'approximate',
  hookTitle: 'approximate',
  transitions: 'approximate',
  music: 'unsupported',
  structure: 'unsupported',
  orientation: 'exact',
}

const Qualitative = z.object({
  hook: z.object({ endSec: z.number().nonnegative(), description: z.string() }),
  captions: z.object({
    present: z.boolean(),
    position: z.enum(['top', 'middle', 'bottom']),
    size: z.enum(['small', 'medium', 'large']),
    color: z.string(),
    highlightColor: z.string().optional(),
    maxCharsPerLine: z.number().int().positive(),
  }),
  hookTitle: z.object({ present: z.boolean(), text: z.string().optional() }),
  transitions: z.object({ dominant: z.enum(['hard-cut', 'punch-zoom', 'crossfade', 'other']) }),
  music: z.object({ present: z.boolean(), energy: z.enum(['low', 'medium', 'high']), mood: z.string().optional() }),
  structure: z.array(z.string()),
})

export const StyleSpec = z.object({
  orientation: z.enum(['landscape', 'portrait', 'square']),
  durationSec: z.number().nonnegative(),
  pacing: z.object({ shotCount: z.number().int().positive(), avgShotLengthSec: z.number().positive(), cutsPerMinute: z.number().nonnegative() }),
  ...Qualitative.shape,
  feasibility: z.record(z.enum(STYLE_FIELDS), Feasibility),
})
export type StyleSpec = z.infer<typeof StyleSpec>

const MAX_ANALYZE_SEC = 180

/** ffmpeg showinfo 출력에서 장면 전환 시각(초)을 뽑는다. 순수 함수. */
export function parseSceneTimes(ffmpegStderr: string): number[] {
  return [...ffmpegStderr.matchAll(/pts_time:\s*([0-9]+(?:\.[0-9]+)?)/g)].map((m) => Number(m[1]))
}

export function computeCutStats(cutTimes: number[], durationSec: number) {
  const shotCount = cutTimes.length + 1
  return {
    shotCount,
    avgShotLengthSec: durationSec / shotCount,
    cutsPerMinute: durationSec > 0 ? (cutTimes.length / durationSec) * 60 : 0,
  }
}

export async function detectSceneCuts(videoPath: string, o: { threshold?: number; maxSec?: number } = {}): Promise<number[]> {
  const threshold = o.threshold ?? 0.3
  const maxSec = o.maxSec ?? MAX_ANALYZE_SEC
  const { stderr } = await run('ffmpeg', [
    '-hide_banner', '-nostdin', '-t', String(maxSec), '-i', videoPath,
    '-vf', `select='gt(scene,${threshold})',showinfo`,
    '-an', '-f', 'null', '-',
  ])
  return parseSceneTimes(stderr)
}

function orientationOf(w: number, h: number): StyleSpec['orientation'] {
  if (h / w >= 1.2) return 'portrait'
  if (w / h >= 1.2) return 'landscape'
  return 'square'
}

const PROMPT = [
  '당신은 짧은 영상의 편집 스타일을 분석하는 전문가입니다. 첨부한 이미지 8장은 한 레퍼런스 영상의 장면입니다.',
  '앞의 3장은 영상 첫 3초 안의 장면(훅 구간), 뒤의 5장은 전체에 고르게 뽑은 장면입니다.',
  '화면에서 보이는 편집 스타일만 근거로 JSON 한 개로만 답하세요(다른 글 금지). 확실하지 않으면 가장 그럴듯한 값을 고르세요.',
  '',
  '{"hook": {"endSec": 훅이 끝나는 시각(초), "description": "훅 구간에서 벌어지는 일"},',
  ' "captions": {"present": 자막이 있나, "position": "top|middle|bottom", "size": "small|medium|large", "color": "글자 색(#RRGGBB)", "highlightColor": "강조 색(없으면 생략)", "maxCharsPerLine": 한 줄 글자 수},',
  ' "hookTitle": {"present": 첫머리에 제목 카드가 있나, "text": "제목 문구(없으면 생략)"},',
  ' "transitions": {"dominant": "hard-cut|punch-zoom|crossfade|other"},',
  ' "music": {"present": 음악이 있을 것 같나, "energy": "low|medium|high", "mood": "분위기(없으면 생략)"},',
  ' "structure": ["영상의 흐름을 단계별 짧은 문구로"]}',
].join('\n')

export async function analyzeReference(
  ref: { path: string; info: VideoInfo },
  deps: { ask?: typeof askClaude } = {},
): Promise<StyleSpec> {
  const ask = deps.ask ?? askClaude
  const effective = Math.min(ref.info.durationSec, MAX_ANALYZE_SEC)
  const cuts = await detectSceneCuts(ref.path, { maxSec: MAX_ANALYZE_SEC })
  const pacing = computeCutStats(cuts, effective)

  const clamp = (t: number) => Math.min(Math.max(0, t), Math.max(0, effective - 0.1))
  const times = [0.5, 1.5, 2.5, ...Array.from({ length: 5 }, (_, k) => (effective * (k + 0.5)) / 5)].map(clamp)

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vae-ref-'))
  try {
    const images = await extractFrames(ref.path, times, tmp)
    const qual = await ask({ prompt: PROMPT, images, schema: Qualitative, effort: 'low' })
    return {
      orientation: orientationOf(ref.info.width, ref.info.height),
      durationSec: effective,
      pacing,
      ...qual,
      feasibility: { ...FEASIBILITY },
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}
