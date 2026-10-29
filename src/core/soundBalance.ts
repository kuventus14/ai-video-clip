import { clampGainDb, loadCatalog, type Catalog } from '../shared/sound.ts'
import { askClaude, extractJson } from './llm.ts'
import type { Transcript } from './types.ts'
import type { VideoSummary } from './understand.ts'

/** 기본 규칙(음악 = 목소리 -14 LU, 효과음 최대치 = 목소리 최대치 -8 dB)에서 얼마나 키우거나 줄일지(dB) */
export interface SoundBalance {
  bgmGainDb: number
  sfxGainDb: number
  /** 화면에 보일 한 줄 이유(60자 이하). AI 를 못 쓴 경우는 빈 글 */
  reason: string
}

/** AI 가 정할 수 있는 범위. 유저 슬라이더(-12 ~ +6)보다 좁게 — AI 는 소리를 직접 듣지 못해서 크게 틀리면 안 된다 */
const AI_RANGE = { min: -6, max: 4 }
const REASON_MAX = 60
const NONE: SoundBalance = { bgmGainDb: 0, sfxGainDb: 0, reason: '' }

/** 길이 중 말하는 구간의 비율(0..1). 겹친 구간은 한 번만 센다. */
export function speechRatio(t: Transcript, durationSec: number): number {
  if (!t.hasSpeech || durationSec <= 0) return 0
  const spans = t.segments
    .map((s) => [Math.max(0, s.start), Math.min(durationSec, s.end)] as const)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0])
  let total = 0
  let reach = 0
  for (const [a, b] of spans) {
    total += Math.max(0, b - Math.max(a, reach))
    reach = Math.max(reach, b)
  }
  return Math.min(1, total / durationSec)
}

const aiClamp = (n: unknown): number => Math.min(AI_RANGE.max, Math.max(AI_RANGE.min, clampGainDb(n)))

function buildPrompt(i: { summary: VideoSummary; speechRatio: number; bgm?: { title: string; mood: string }; sfxOn: boolean }): string {
  return [
    '짧은 세로 영상(릴스)에 배경음악과 효과음을 깐다. 기본 규칙은 이렇다: 음악은 목소리보다 14 LU 작게, 효과음 최대치는 목소리 최대치보다 8 dB 작게, 말할 때는 음악이 자동으로 줄어든다.',
    '이 영상에서 기본 규칙 대비 음악과 효과음을 얼마나 키우거나 줄이면 좋을지 dB 오프셋으로 정해라. 0 이면 기본 그대로, 양수는 크게, 음수는 작게.',
    '',
    `장르: ${i.summary.genre}`,
    `주제: ${i.summary.topic}`,
    `한 줄 요약: ${i.summary.oneLine}`,
    `말하는 구간 비율: ${Math.round(i.speechRatio * 100)}%`,
    i.bgm ? `배경음악: ${i.bgm.title} (분위기 ${i.bgm.mood})` : '배경음악: 쓰지 않음',
    `효과음: ${i.sfxOn ? '켬' : '끔'}`,
    '',
    '판단 기준: 말이 빽빽하고 정보 전달이 중요하면 음악을 줄이고, 말이 적고 분위기·활기가 중요한 영상이면 음악을 키운다. 효과음은 영상이 빠르고 경쾌하면 키우고 차분하면 줄인다. 확신이 없으면 0.',
    `범위: ${AI_RANGE.min} ~ +${AI_RANGE.max} dB, 0.5 단위.`,
    '',
    '설명 없이 JSON 만 답해라: {"bgmGainDb": 숫자, "sfxGainDb": 숫자, "reason": "화면에 보일 한국어 한 줄 이유(60자 이하)"}',
  ].join('\n')
}

/**
 * AI 가 영상 장르·말 비율·음악 분위기를 보고 음악·효과음 크기 오프셋을 정한다. AI 는 소리를 직접 듣지 못하므로 어디까지나 추천이다.
 * 쓸 음악도 효과음도 없으면 AI 를 부르지 않는다. 호출 실패·엉뚱한 답이면 오프셋 0 으로 돌아가고 제작은 계속된다.
 */
export async function decideSoundBalance(
  i: { summary: VideoSummary; speechRatio: number; bgm?: { title: string; mood: string }; sfxOn: boolean },
  deps: { ask?: typeof askClaude } = {},
): Promise<SoundBalance> {
  if (!i.bgm && !i.sfxOn) return NONE
  const ask = deps.ask ?? askClaude
  try {
    const raw = extractJson(await ask({ prompt: buildPrompt(i), effort: 'low' }))
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return NONE
    const r = raw as Record<string, unknown>
    return {
      bgmGainDb: i.bgm ? aiClamp(r.bgmGainDb) : 0,
      sfxGainDb: i.sfxOn ? aiClamp(r.sfxGainDb) : 0,
      reason: typeof r.reason === 'string' ? r.reason.trim().slice(0, REASON_MAX) : '',
    }
  } catch {
    return NONE
  }
}

/** 파이프라인이 쓰는 입구: 곡 id 로 음원 목록에서 제목·분위기를 찾아 묻는다. 목록을 못 읽으면 AI 를 부르지 않고 오프셋 0. */
export async function balanceSound(
  i: { summary: VideoSummary; speechRatio: number; bgmId: string | null; sfxOn: boolean },
  deps: { ask?: typeof askClaude; catalog?: () => Catalog } = {},
): Promise<SoundBalance> {
  try {
    const track = i.bgmId ? (deps.catalog ?? loadCatalog)().bgm.find((t) => t.id === i.bgmId) : undefined
    return await decideSoundBalance({ summary: i.summary, speechRatio: i.speechRatio, bgm: track && { title: track.title, mood: track.mood }, sfxOn: i.sfxOn }, { ask: deps.ask })
  } catch {
    return NONE
  }
}
