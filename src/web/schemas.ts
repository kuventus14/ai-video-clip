import { z } from 'zod'

export const PurposeChoice = z.enum(['auto', 'post', 'short'])

/** 분석을 시작한다. reference 는 http(s) 링크, 'uploaded'(올려 둔 파일), 비어 있으면 레퍼런스 없음. */
export const StartBody = z.object({
  description: z.string().max(2000).optional(),
  purposeChoice: PurposeChoice,
  reference: z.string().max(2000).nullable().optional(),
})

/** 레퍼런스·요청·용도를 (다시) 정해 계획을 요청한다. 보내지 않은 항목은 그대로 둔다. reference:null 은 레퍼런스를 지운다. */
export const PlanBody = z.object({
  reference: z.string().max(2000).nullable().optional(),
  request: z.string().max(4000).optional(),
  purposeChoice: PurposeChoice.optional(),
})

export const ApproveBody = z.object({
  captions: z.enum(['auto', 'off']).optional(),
  audio: z.enum(['original', 'voice']).optional(),
  quality: z.enum(['draft', 'looks', 'delivery']).optional(),
})
