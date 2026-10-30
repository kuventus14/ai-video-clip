import { z } from 'zod'
import { CAPTION_LINE_LIMITS } from '../shared/captionReview.ts'
import { cleanScriptText, SCRIPT_TEXT_LIMITS } from '../shared/scriptText.ts'
import { SOUND_GAIN_RANGE } from '../shared/sound.ts'

export const PurposeChoice = z.enum(['auto', 'post', 'short'])

/** 분석을 시작한다. reference 는 http(s) 링크, 'uploaded'(올려 둔 파일), 비어 있으면 레퍼런스 없음. */
export const StartBody = z.object({
  description: z.string().max(2000).optional(),
  purposeChoice: PurposeChoice,
  reference: z.string().max(2000).nullable().optional(),
})

/** 레퍼런스·요청·용도를 (다시) 정해 계획을 요청한다. 보내지 않은 항목은 그대로 둔다. reference:null 은 레퍼런스를 지운다. */
/** 자막 확인에서 고친 줄. 줄 번호는 0 이상 정수, 글자는 160자 이하(null = 지움). 알 수 없는 칸은 받지 않는다. */
export const CaptionEditsBody = z
  .array(z.strictObject({ i: z.number().int().min(0), text: z.string().max(160).nullable() }))
  .max(500)

/**
 * 자막 트랙(줄 전체). 모양만 거르고(알 수 없는 칸 거절·글자 길이는 넉넉히 2000자까지), 겹침·길이·160자 같은 규칙은
 * 라우트가 captionLineProblems 로 검사해 "N번째 줄: …" 한국어로 알린다.
 */
export const CaptionTrackBody = z
  .array(z.strictObject({ start: z.number().finite(), end: z.number().finite(), text: z.string().max(2000) }))
  .max(CAPTION_LINE_LIMITS.maxLines)

export const PlanBody = z.object({
  reference: z.string().max(2000).nullable().optional(),
  request: z.string().max(4000).optional(),
  purposeChoice: PurposeChoice.optional(),
  captionEdits: CaptionEditsBody.optional(),
  captionTrack: CaptionTrackBody.nullable().optional(),
})

const scriptText = (max: number) =>
  z.string().refine((v) => 'ok' in cleanScriptText(v, max), `문구는 글자가 있어야 하고 ${max}자 이하, 주소 없이 써 주세요`)

/** 승인 화면에서 고친 편집 구성 문구(고친 칸만). 알 수 없는 칸은 받지 않는다. */
export const ScriptEditsBody = z.strictObject({
  title: scriptText(SCRIPT_TEXT_LIMITS.title).optional(),
  hookQuestion: scriptText(SCRIPT_TEXT_LIMITS.question).optional(),
  openingLines: z.array(scriptText(SCRIPT_TEXT_LIMITS.opening)).max(SCRIPT_TEXT_LIMITS.maxOpening).optional(),
})

export const ApproveBody = z.object({
  captions: z.enum(['auto', 'off']).optional(),
  captionPosition: z.enum(['top', 'middle', 'bottom']).optional(),
  scriptEdits: ScriptEditsBody.optional(),
  audio: z.enum(['original', 'voice', 'mic']).optional(),
  bgm: z.string().min(1).max(80).nullable().optional(),
  sfx: z.enum(['off', 'on']).optional(),
  quality: z.enum(['draft', 'looks', 'delivery']).optional(),
})

const gainDb = z.number().min(SOUND_GAIN_RANGE.min).max(SOUND_GAIN_RANGE.max)

/** 결과 화면에서 바꾼 음악·효과음 크기(dB, 기본 규칙 대비). 알 수 없는 칸은 받지 않는다. */
export const RemixBody = z.strictObject({ bgmGainDb: gainDb, sfxGainDb: gainDb })
