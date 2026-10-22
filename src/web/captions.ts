import { reviewParts, type ReviewTranscript } from '../shared/captionReview.ts'
import type { CaptionEdit, CaptionReviewDto } from '../shared/types.ts'

const round2 = (n: number) => Math.round(n * 100) / 100

/** 인식 결과를 자막 확인 화면용으로: 줄마다 번호·시각·원문·의심 단어만 낸다(단어별 시각·신뢰도는 보내지 않는다). */
export function toCaptionReviewDto(t: ReviewTranscript, edits: CaptionEdit[] | null): CaptionReviewDto {
  return {
    parts: reviewParts(t).map((p) => ({ i: p.i, start: round2(p.start), end: round2(p.end), text: p.text, lowWords: p.lowWords })),
    edits: edits ?? [],
    hasSpeech: t.hasSpeech,
  }
}
