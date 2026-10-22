import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

/** 효과음: 끄기 / 켜기. 컷·제목 카드 순간에 짧은 효과음을 넣는다. */
export type SfxMode = 'off' | 'on'
export const SFX_MODES: SfxMode[] = ['off', 'on']

export const BGM_MOODS = ['calm', 'bright', 'energetic'] as const
export type BgmMood = (typeof BGM_MOODS)[number]
export const SFX_ROLES = ['whoosh', 'pop', 'impact', 'click', 'ding'] as const
export type SfxRole = (typeof SFX_ROLES)[number]

/** 저작자 표시가 필요 없는 라이선스만 쓴다(CC-BY·비영리 전용은 목록에 넣지 않는다). */
export const ALLOWED_LICENSES = ['CC0', 'Pixabay License', 'Mixkit Free License'] as const
export type License = (typeof ALLOWED_LICENSES)[number]

/** 사용자에게 그대로 보여 줘도 되는 음원 관련 오류(목록이 깨졌거나 고른 파일이 없을 때 등). */
export class SoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SoundError'
  }
}

const safeRelativePath = (f: string) => !path.isAbsolute(f) && !f.split(/[\\/]/).includes('..')

const common = {
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, '소문자·숫자·하이픈만 쓸 수 있어요'),
  file: z.string().min(1).refine(safeRelativePath, '음원 폴더 안의 상대 경로여야 해요'),
  title: z.string().min(1),
  author: z.string().min(1),
  sourceUrl: z.string().url().startsWith('https://', 'https 주소여야 해요'),
  license: z.enum(ALLOWED_LICENSES),
  durationSec: z.number().positive(),
  peakDb: z.number(),
}

const BgmTrackSchema = z.object({ kind: z.literal('bgm'), ...common, lufs: z.number(), mood: z.enum(BGM_MOODS) })
const SfxTrackSchema = z.object({ kind: z.literal('sfx'), ...common, lufs: z.number().nullable(), role: z.enum(SFX_ROLES) })
const ManifestSchema = z.object({ version: z.literal(1), tracks: z.array(z.discriminatedUnion('kind', [BgmTrackSchema, SfxTrackSchema])) })

export type BgmTrack = z.infer<typeof BgmTrackSchema>
export type SfxTrack = z.infer<typeof SfxTrackSchema>

export interface Catalog {
  dir: string
  bgm: BgmTrack[]
  sfx: SfxTrack[]
}

type Env = Record<string, string | undefined>

/** 음원 폴더: VAE_SOUND_DIR, 없으면 <실행 위치>/assets/sound. */
export function soundDir(env: Env = process.env): string {
  return path.resolve(/*turbopackIgnore: true*/ env.VAE_SOUND_DIR ?? path.join(process.cwd(), 'assets/sound'))
}

/** 음원 파일의 실제 경로 */
export const trackPath = (c: Catalog, t: BgmTrack | SfxTrack): string => path.join(c.dir, t.file)

/**
 * <dir>/manifest.json 을 읽고 검증한다. 목록이 없으면 빈 목록. 목록이 깨졌거나(형식·라이선스·id 중복)
 * 적힌 파일이 없으면 SoundError — 어떤 음원이 문제인지 말해 준다.
 */
export function loadCatalog(dir: string = soundDir()): Catalog {
  const manifest = path.join(dir, 'manifest.json')
  if (!fs.existsSync(manifest)) return { dir, bgm: [], sfx: [] }

  let parsed: z.infer<typeof ManifestSchema>
  try {
    parsed = ManifestSchema.parse(JSON.parse(fs.readFileSync(manifest, 'utf8')))
  } catch (e) {
    const why = e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : (e as Error).message
    throw new SoundError(`음원 목록(manifest.json)을 읽을 수 없어요: ${why}`)
  }

  const seen = new Set<string>()
  for (const t of parsed.tracks) {
    if (seen.has(t.id)) throw new SoundError(`음원 목록(manifest.json)에 같은 id 가 두 번 있어요: ${t.id}`)
    seen.add(t.id)
    if (!fs.existsSync(path.join(dir, t.file))) throw new SoundError(`음원 파일이 없어요: ${t.id} (${t.file})`)
  }
  return {
    dir,
    bgm: parsed.tracks.filter((t): t is BgmTrack => t.kind === 'bgm'),
    sfx: parsed.tracks.filter((t): t is SfxTrack => t.kind === 'sfx'),
  }
}

/**
 * 고른 배경음악·효과음을 지금 음원 목록으로 쓸 수 있는지. 쓸 수 없으면 사용자에게 보여 줄 한국어 안내, 괜찮으면 null.
 * 승인(approve)·다시 시도(retry)·제작(applySound)이 같은 기준을 쓴다.
 */
export function soundChoiceProblem(c: Catalog, bgm: string | null, sfx: SfxMode): string | null {
  if (bgm && !c.bgm.some((t) => t.id === bgm)) return `고른 배경음악(${bgm})을 음원 목록에서 찾을 수 없어요. 다른 곡을 골라 주세요.`
  if (sfx === 'on' && !c.sfx.length) return '효과음 파일이 아직 없어서 효과음을 켤 수 없어요. 효과음을 끄고 진행해 주세요.'
  return null
}

export function findTrack(c: Catalog, id: string): BgmTrack | SfxTrack | undefined {
  return c.bgm.find((t) => t.id === id) ?? c.sfx.find((t) => t.id === id)
}
