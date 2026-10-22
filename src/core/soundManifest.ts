import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { ALLOWED_LICENSES, BGM_MOODS, SFX_ROLES, SoundError } from '../shared/sound.ts'
import { run as realRun } from './exec.ts'
import { measureAudio } from './sound.ts'

const safeRelativePath = (f: string) => !path.isAbsolute(f) && !f.split(/[\\/]/).includes('..')

const common = {
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, '소문자·숫자·하이픈만 쓸 수 있어요'),
  file: z.string().min(1).refine(safeRelativePath, '음원 폴더 안의 상대 경로여야 해요'),
  title: z.string().min(1),
  author: z.string().min(1),
  sourceUrl: z.string().url().startsWith('https://', 'https 주소여야 해요'),
  license: z.enum(ALLOWED_LICENSES),
}
/** 사람이 적는 음원 정보(재서 채우는 값은 빠져 있다) */
const SourcesSchema = z.object({
  version: z.literal(1),
  tracks: z.array(z.discriminatedUnion('kind', [z.object({ kind: z.literal('bgm'), ...common, mood: z.enum(BGM_MOODS) }), z.object({ kind: z.literal('sfx'), ...common, role: z.enum(SFX_ROLES) })])),
})
export type SoundSource = z.infer<typeof SourcesSchema>['tracks'][number]

type Measured = { durationSec: number; peakDb: number; lufs: number | null }
export type ManifestTrack = SoundSource & Measured
export interface Manifest {
  version: 1
  tracks: ManifestTrack[]
}

const round = (n: number, digits: number) => +n.toFixed(digits)

async function durationOf(file: string, run: typeof realRun): Promise<number> {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])
  const sec = Number.parseFloat(stdout.trim())
  if (!Number.isFinite(sec) || sec <= 0) throw new Error('길이를 읽을 수 없어요')
  return sec
}

/**
 * <dir>/sources.json(사람이 적은 제목·작가·출처·라이선스·분위기/역할)을 읽어 파일마다 길이·음량(LUFS)·최대치(dBFS)를 재고
 * manifest 와 CREDITS.md 내용을 만든다. 파일이 없거나 소리를 잴 수 없으면 그 id 를 말하며 SoundError.
 */
export async function buildManifest(dir: string, deps: { run?: typeof realRun } = {}): Promise<{ manifest: Manifest; credits: string }> {
  const run = deps.run ?? realRun
  const sourcesFile = path.join(dir, 'sources.json')
  if (!fs.existsSync(sourcesFile)) throw new SoundError(`${sourcesFile} 가 없어요. 음원 정보(제목·작가·출처·라이선스)를 적은 sources.json 을 먼저 만들어 주세요.`)

  let sources: z.infer<typeof SourcesSchema>
  try {
    sources = SourcesSchema.parse(JSON.parse(fs.readFileSync(sourcesFile, 'utf8')))
  } catch (e) {
    const why = e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : (e as Error).message
    throw new SoundError(`sources.json 을 읽을 수 없어요: ${why}`)
  }

  const seen = new Set<string>()
  const tracks: ManifestTrack[] = []
  for (const s of sources.tracks) {
    if (seen.has(s.id)) throw new SoundError(`sources.json 에 같은 id 가 두 번 있어요: ${s.id}`)
    seen.add(s.id)
    const file = path.join(dir, s.file)
    if (!fs.existsSync(file)) throw new SoundError(`음원 파일이 없어요: ${s.id} (${s.file})`)
    const level = await measureAudio(file, { run })
    if (level.peakDb === null) throw new SoundError(`소리가 없어서 음량을 잴 수 없어요: ${s.id} (${s.file})`)
    if (s.kind === 'bgm' && level.lufs === null) throw new SoundError(`배경음악의 음량을 잴 수 없어요(너무 짧거나 거의 무음): ${s.id} (${s.file})`)
    tracks.push({ ...s, durationSec: round(await durationOf(file, run), 3), peakDb: round(level.peakDb, 1), lufs: level.lufs === null ? null : round(level.lufs, 1) })
  }

  const row = (t: ManifestTrack) => `| ${t.id} | ${t.title} | ${t.author} | ${t.license} | ${t.sourceUrl} |`
  const table = (items: ManifestTrack[]) => ['| id | 제목 | 작가 | 라이선스 | 출처 |', '|---|---|---|---|---|', ...items.map(row)].join('\n')
  const credits = [
    '# 음원 출처와 라이선스',
    '',
    '이 파일은 `npm run sound:measure` 가 sources.json 에서 만들어요. 직접 고치지 마세요.',
    '이 앱 안에서 영상에 입히는 용도로만 쓰는 음원이에요. 음원 파일만 따로 다시 배포하지 마세요(저장소를 공개한다면 `assets/sound` 의 음원 파일은 빼고 이 목록만 올리세요).',
    '',
    '## 배경음악',
    '',
    table(tracks.filter((t) => t.kind === 'bgm')),
    '',
    '## 효과음',
    '',
    table(tracks.filter((t) => t.kind === 'sfx')),
    '',
  ].join('\n')
  return { manifest: { version: 1, tracks }, credits }
}

/** buildManifest 결과를 <dir>/manifest.json 과 <dir>/CREDITS.md 로 쓴다. */
export async function writeManifest(dir: string, deps: { run?: typeof realRun } = {}): Promise<Manifest> {
  const { manifest, credits } = await buildManifest(dir, deps)
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`)
  fs.writeFileSync(path.join(dir, 'CREDITS.md'), credits)
  return manifest
}
