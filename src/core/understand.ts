import path from 'node:path'
import { z } from 'zod'
import { askClaude } from './llm.ts'
import { extractFrames } from './media.ts'
import type { Transcript, VideoInfo } from './types.ts'

const SummaryCore = z.object({
  topic: z.string().min(1),
  genre: z.string().min(1),
  oneLine: z.string().min(1),
  language: z.string().min(1),
  hasPeople: z.boolean(),
  /** 영상 첫머리에 올릴 제목 카드 문구 (한국어 16자 이하) */
  hookTitle: z.string().min(1).max(16),
  /** 비슷한 영상을 찾기 위한 검색어 3~5개 */
  searchQueries: z.array(z.string().min(1)).min(3).max(5),
})

export const VideoSummary = SummaryCore.extend({ source: z.enum(['user', 'analyzed']) })
export type VideoSummary = z.infer<typeof VideoSummary>

const FRAME_COUNT = 6
const TRANSCRIPT_EXCERPT_CHARS = 1500

function buildPrompt(i: { info: VideoInfo; transcript: Transcript; userDescription: string }): string {
  const orientation = i.info.height > i.info.width ? '세로' : i.info.width > i.info.height ? '가로' : '정사각'
  const speech = i.transcript.hasSpeech
    ? i.transcript.segments.map((s) => s.text).join(' ').slice(0, TRANSCRIPT_EXCERPT_CHARS)
    : null
  return [
    '당신은 영상 편집 도우미입니다. 아래 영상이 어떤 영상인지 파악하고, 비슷한 인기 영상을 찾기 위한 정보를 JSON 으로만 답하세요.',
    '',
    `영상 정보: ${Math.round(i.info.durationSec)}초, ${orientation} 비율(${i.info.width}x${i.info.height})`,
    i.userDescription ? `사용자 설명: ${i.userDescription}` : '사용자 설명: 없음 — 첨부된 화면과 음성으로 판단하세요.',
    speech ? `음성 전사(앞부분): ${speech}` : '음성 없음 — 화면만으로 판단하세요.',
    '',
    '출력 형식(JSON 한 개, 다른 글 금지):',
    '{"topic": "주제(짧게)", "genre": "장르(예: 골프 레슨)", "oneLine": "한 줄 요약", "language": "음성 언어 코드(ko 등)", "hasPeople": 사람이 나오면 true,',
    ' "hookTitle": "영상 첫머리 제목 카드 문구, 한국어 16자 이하", "searchQueries": ["유튜브 검색어 3~5개, 비슷한 인기 영상이 나오도록 구체적으로"]}',
  ].join('\n')
}

export async function describeVideo(
  i: { info: VideoInfo; transcript: Transcript; userDescription?: string; workDir: string },
  deps: { ask?: typeof askClaude; frames?: typeof extractFrames } = {},
): Promise<VideoSummary> {
  const ask = deps.ask ?? askClaude
  const frames = deps.frames ?? extractFrames
  const userDescription = (i.userDescription ?? '').trim()
  const source = userDescription ? 'user' : 'analyzed'

  let images: string[] | undefined
  if (source === 'analyzed') {
    const times = Array.from({ length: FRAME_COUNT }, (_, k) => (i.info.durationSec * (k + 0.5)) / FRAME_COUNT)
    images = await frames(i.info.path, times, path.join(i.workDir, 'understand-frames'))
  }

  const core = await ask({ prompt: buildPrompt({ info: i.info, transcript: i.transcript, userDescription }), images, schema: SummaryCore, effort: 'low' })
  return { ...core, source }
}
