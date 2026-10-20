import type { Canvas, Purpose, VideoInfo } from './types.ts'

export interface PurposeGuess {
  purpose: Purpose
  /** 0..1 — 낮으면 사용자가 직접 고르도록 화면에서 강조한다 */
  confidence: number
  reasons: string[]
}

interface Rule {
  score: number
  reason: string
}

const SHORT_WORDS = /릴스|숏츠|쇼츠|shorts?|reels?|클립/i
const POST_WORDS = /게시물|강의|풀버전|롱폼|long ?form|full/i

function aspectRule(w: number, h: number, who: string): Rule | null {
  if (h / w >= 1.2) return { score: who === '영상' ? 3 : 2, reason: `${who}이 세로 비율이에요` }
  if (w / h >= 1.2) return { score: who === '영상' ? -3 : -2, reason: `${who}이 가로 비율이에요` }
  return null
}

function durationRule(d: number): Rule {
  if (d <= 60) return { score: 2, reason: '60초 이하의 짧은 영상이에요' }
  if (d <= 180) return { score: 1, reason: '3분 이하의 영상이에요' }
  if (d <= 480) return { score: -1, reason: '3~8분 길이의 영상이에요' }
  return { score: -2, reason: '8분이 넘는 긴 영상이에요' }
}

export function detectPurpose(i: {
  info: Pick<VideoInfo, 'width' | 'height' | 'durationSec'>
  reference?: Pick<VideoInfo, 'width' | 'height'>
  description?: string
}): PurposeGuess {
  const rules: Rule[] = []
  const a = aspectRule(i.info.width, i.info.height, '영상')
  if (a) rules.push(a)
  rules.push(durationRule(i.info.durationSec))
  if (i.reference) {
    const r = aspectRule(i.reference.width, i.reference.height, '레퍼런스')
    if (r) rules.push(r)
  }
  const desc = i.description ?? ''
  if (SHORT_WORDS.test(desc)) rules.push({ score: 3, reason: '설명에 릴스·숏츠 관련 말이 있어요' })
  if (POST_WORDS.test(desc)) rules.push({ score: -3, reason: '설명에 게시물·강의 관련 말이 있어요' })

  const score = rules.reduce((s, r) => s + r.score, 0)
  return {
    purpose: score > 0 ? 'short' : 'post',
    confidence: Math.min(1, Math.abs(score) / 6),
    reasons: rules.map((r) => r.reason),
  }
}

/** 사용자가 고른 값이 항상 우선한다. */
export function resolvePurpose(guess: PurposeGuess, userChoice?: Purpose | 'auto'): Purpose {
  return userChoice && userChoice !== 'auto' ? userChoice : guess.purpose
}

export function canvasFor(p: Purpose): Canvas {
  return p === 'post' ? { width: 1920, height: 1080 } : { width: 1080, height: 1920 }
}
