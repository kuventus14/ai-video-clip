import { captionLinesWithEdits, reviewParts, type ReviewTranscript } from '../shared/captionReview.ts'
import type { CaptionEdit, CaptionLine, CaptionReviewDto } from '../shared/types.ts'

const round2 = (n: number) => Math.round(n * 100) / 100

/** 인식 결과를 자막 확인 화면용으로: 줄마다 번호·시각·원문·의심 단어만 낸다(단어별 시각·신뢰도는 보내지 않는다). */
export function toCaptionReviewDto(t: ReviewTranscript, edits: CaptionEdit[] | null, track: CaptionLine[] | null, durationSec: number): CaptionReviewDto {
  const parts = reviewParts(t).map((p) => ({ i: p.i, start: round2(p.start), end: round2(p.end), text: p.text, lowWords: p.lowWords }))
  return {
    parts,
    edits: edits ?? [],
    hasSpeech: t.hasSpeech,
    durationSec,
    original: parts.map((p) => ({ start: p.start, end: p.end, text: p.text, lowWords: p.lowWords })),
    // 저장된 트랙이 있으면 그것, 없으면 예전(줄 번호) 편집을 입힌 줄(편집도 없으면 원래 줄)
    lines: track ?? captionLinesWithEdits(t, edits),
    custom: track !== null || (edits?.length ?? 0) > 0,
  }
}
