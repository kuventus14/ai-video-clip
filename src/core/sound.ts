import fs from 'node:fs'
import nodePath from 'node:path'
import { z } from 'zod'
import { clampGainDb, loadCatalog, SOUND_NOT_REMIXABLE, SoundError, soundChoiceProblem, trackPath, type BgmTrack, type Catalog, type SfxMode, type SfxRole, type SfxTrack } from '../shared/sound.ts'
import { run as realRun, ToolError } from './exec.ts'
import type { SoundBalance } from './soundBalance.ts'
import type { Span } from './types.ts'

/** 효과음 사이 최소 간격 — 컷이 아주 많은 영상에서도 정신없지 않게 한다. */
export const SFX_MIN_GAP_SEC = 2
/** 컷 효과음은 경계보다 조금 앞에서 시작해 화면이 바뀔 때 소리가 이미 올라와 있게 한다. */
export const SFX_CUT_LEAD_SEC = 0.15
export const SFX_HOOK_AT_SEC = 0.1
/** 영상 끝에서 이 시간 안에는 효과음을 넣지 않는다(끝이 잘리거나 어색해진다). */
export const SFX_END_MARGIN_SEC = 0.3

export interface SfxEvent {
  /** 출력(컷 이후) 시간 기준 */
  atSec: number
  trackId: string
  role: SfxRole
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6

/**
 * 효과음 위치: 제목 카드가 나올 때 pop, 남은 구간 사이 경계마다 whoosh. 이웃 이벤트와 2초 안이면 뒤의 것을 버리고,
 * 영상 끝 0.3초 안·0초 앞은 버린다. 같은 역할 파일이 여럿이면 이벤트 순서대로 돌려 쓴다(같은 입력 → 같은 결과).
 */
export function planSfx(i: { kept: Span[]; hookTitle: boolean; sfx: SfxTrack[] }): SfxEvent[] {
  const total = i.kept.reduce((s, k) => s + (k.end - k.start), 0)
  const tracksOf = (role: SfxRole) => i.sfx.filter((t) => t.role === role)

  const wanted: { atSec: number; role: SfxRole }[] = []
  if (i.hookTitle && tracksOf('pop').length) wanted.push({ atSec: SFX_HOOK_AT_SEC, role: 'pop' })
  if (tracksOf('whoosh').length) {
    let acc = 0
    for (const k of i.kept.slice(0, -1)) {
      acc += k.end - k.start
      wanted.push({ atSec: round6(acc - SFX_CUT_LEAD_SEC), role: 'whoosh' })
    }
  }

  const out: SfxEvent[] = []
  const used: Partial<Record<SfxRole, number>> = {}
  for (const w of wanted.sort((a, b) => a.atSec - b.atSec)) {
    if (w.atSec < 0 || w.atSec > total - SFX_END_MARGIN_SEC) continue
    const prev = out.at(-1)
    if (prev && w.atSec - prev.atSec < SFX_MIN_GAP_SEC - 1e-9) continue
    const pool = tracksOf(w.role)
    const n = used[w.role] ?? 0
    used[w.role] = n + 1
    out.push({ atSec: w.atSec, role: w.role, trackId: pool[n % pool.length]!.id })
  }
  return out
}

/** 소리를 측정한 값. 소리가 없으면(트랙 없음·완전한 무음) 둘 다 null, 아주 짧은 소리는 lufs 만 null. */
export interface AudioLevel {
  lufs: number | null
  peakDb: number | null
}

const NO_AUDIO: AudioLevel = { lufs: null, peakDb: null }
const FFMPEG_TIMEOUT_MS = 20 * 60_000

/** 배경음악은 목소리보다 이만큼(LU) 작게 깐다. 실제 영상 한 편으로 맞춘 값이다(README 한계 참고). */
export const BGM_BELOW_VOICE_LU = 14
/** 목소리가 없을 때 배경음악의 절대 음량 */
export const BGM_NO_VOICE_LUFS = -22
/** 효과음의 최대 음량은 목소리 최대 음량보다 이만큼(dB) 작게 */
export const SFX_BELOW_VOICE_PEAK_DB = 8
export const SFX_MAX_PEAK_DB = -6
/** 목소리가 이 값(LU)보다 크게 들어오면 음악을 줄이기 시작한다. 실제 영상 한 편(20초)으로 맞췄다: 이 값과 비율로 말할 때 음악이 6~8dB 줄고 목소리보다 약 22 LU 작게 들린다(쉴 때는 약 14 LU). */
export const DUCK_THRESHOLD_BELOW_VOICE_LU = 18
export const DUCK_RATIO = 8
export const DUCK_ATTACK_MS = 15
export const DUCK_RELEASE_MS = 350
/** 합친 소리의 한계(≈ -1.9 dBFS). AAC 로 다시 인코딩하면 최대치가 0.8dB 가량 더 튀어서(과하게 키운 시험에서 실측) 이만큼 여유를 둔다. */
export const LIMIT = 0.8
export const BGM_FADE_IN_SEC = 1
export const BGM_FADE_OUT_SEC = 2.5

const fmt = (n: number) => String(+n.toFixed(3))

/** ffmpeg ebur128 요약에서 통합 음량(LUFS)과 최대 음량(dBFS)을 읽는다. */
export async function measureAudio(file: string, deps: { run?: typeof realRun } = {}): Promise<AudioLevel> {
  const run = deps.run ?? realRun
  let stderr: string
  try {
    ;({ stderr } = await run('ffmpeg', ['-hide_banner', '-nostats', '-nostdin', '-i', file, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { timeoutMs: FFMPEG_TIMEOUT_MS }))
  } catch (e) {
    if (e instanceof ToolError && /does not contain any stream|matches no streams/.test(e.stderr)) return NO_AUDIO // 소리 트랙이 없는 영상
    throw e
  }
  const at = stderr.lastIndexOf('Summary:')
  if (at < 0) return NO_AUDIO
  const summary = stderr.slice(at)
  const read = (re: RegExp) => {
    const v = summary.match(re)?.[1]
    return v === undefined || /inf/i.test(v) ? null : Number(v)
  }
  const lufs = read(/I:\s+(-?[\d.]+|-?inf)\s+LUFS/)
  const peakDb = read(/Peak:\s+(-?[\d.]+|-?inf)\s+dBFS/)
  if (peakDb === null) return NO_AUDIO // 완전한 무음은 Peak: -inf
  // 0.4초보다 짧은 소리(효과음)는 통합 음량을 못 재서 I: -70.0 이 나온다 — 음량은 없음, 최대치는 있음
  return { lufs: lufs === null || lufs <= -70 ? null : lufs, peakDb }
}

export interface MixInput {
  /** 렌더된 영상(목소리가 담겨 있다) */
  videoPath: string
  outPath: string
  durationSec: number
  hasAudio: boolean
  /** videoPath 소리의 측정값 */
  voice: AudioLevel
  bgm?: { file: string; lufs: number }
  /** 출력 시간 기준 효과음 */
  sfx: { file: string; peakDb: number; atSec: number }[]
  /** 기본 규칙(음악 = 목소리 -14 LU)에서 음악을 키우거나(+) 줄이는(-) dB. 기본 0 */
  bgmGainDb?: number
  /** 기본 규칙(효과음 최대치 = 목소리 최대치 -8 dB)에서 효과음을 키우거나 줄이는 dB. 기본 0 */
  sfxGainDb?: number
}

/**
 * 렌더된 영상에 배경음악·효과음을 섞는 ffmpeg 인자. 화면은 복사하고 소리만 다시 만든다.
 * 음악은 반복해 영상 길이에 맞추고 앞뒤를 페이드, 목소리가 있으면 말할 때 자동으로 줄인다(sidechaincompress).
 * 마지막에 alimiter 로 찌그러짐을 막는다(level=disabled — 켜 두면 전체 소리가 1dB 커진다).
 * 결과는 색인(moov)을 앞에 둔다(faststart) — 인스타 릴스 업로드 규격이고 브라우저 미리보기도 빨라진다.
 */
export function buildMixArgs(i: MixInput): string[] {
  const dur = i.durationSec
  const args = ['-v', 'error', '-nostdin', '-y', '-i', i.videoPath]
  let next = 1
  let baseIn = '0:a'
  if (!i.hasAudio) {
    args.push('-f', 'lavfi', '-t', fmt(dur), '-i', 'anullsrc=r=48000:cl=stereo')
    baseIn = `${next++}:a`
  }
  let bgmIn = ''
  if (i.bgm) {
    args.push('-stream_loop', '-1', '-i', i.bgm.file)
    bgmIn = `${next++}:a`
  }
  const sfxIn = i.sfx.map((s) => {
    args.push('-i', s.file)
    return `${next++}:a`
  })

  const norm = 'aformat=sample_rates=48000:channel_layouts=stereo'
  const hasVoice = i.hasAudio && i.voice.lufs !== null
  const graph: string[] = []
  const mixed: string[] = ['[vo]']

  if (i.bgm && hasVoice) graph.push(`[${baseIn}]${norm},asplit=2[vo][key]`)
  else graph.push(`[${baseIn}]${norm}[vo]`)

  if (i.bgm) {
    const fadeIn = Math.min(BGM_FADE_IN_SEC, dur / 4)
    const fadeOut = Math.min(BGM_FADE_OUT_SEC, dur / 4)
    const target = hasVoice ? i.voice.lufs! - BGM_BELOW_VOICE_LU : BGM_NO_VOICE_LUFS
    graph.push(
      `[${bgmIn}]${norm},atrim=duration=${fmt(dur)},asetpts=PTS-STARTPTS,volume=${(target - i.bgm.lufs + (i.bgmGainDb ?? 0)).toFixed(2)}dB,afade=t=in:st=0:d=${fmt(fadeIn)},afade=t=out:st=${fmt(dur - fadeOut)}:d=${fmt(fadeOut)}[bg]`,
    )
    if (hasVoice) {
      const threshold = Math.min(1, Math.max(0.001, 10 ** ((i.voice.lufs! - DUCK_THRESHOLD_BELOW_VOICE_LU) / 20)))
      graph.push(`[bg][key]sidechaincompress=threshold=${threshold.toFixed(4)}:ratio=${DUCK_RATIO}:attack=${DUCK_ATTACK_MS}:release=${DUCK_RELEASE_MS}[bgd]`)
      mixed.push('[bgd]')
    } else {
      mixed.push('[bg]')
    }
  }

  const sfxPeak = Math.min(SFX_MAX_PEAK_DB, (i.voice.peakDb ?? -3) - SFX_BELOW_VOICE_PEAK_DB)
  i.sfx.forEach((s, k) => {
    graph.push(`[${sfxIn[k]}]${norm},volume=${(sfxPeak - s.peakDb + (i.sfxGainDb ?? 0)).toFixed(2)}dB,adelay=${Math.round(s.atSec * 1000)}:all=1[sfx${k}]`)
    mixed.push(`[sfx${k}]`)
  })

  graph.push(`${mixed.join('')}amix=inputs=${mixed.length}:normalize=0:duration=first:dropout_transition=0,alimiter=limit=${LIMIT}:level=disabled[aout]`)
  args.push('-filter_complex', graph.join(';'), '-map', '0:v:0', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', fmt(dur), '-movflags', '+faststart', i.outPath)
  return args
}

/** 영상에 배경음악·효과음을 섞어 새 파일(outPath)을 만든다. ffmpeg 가 실패하면 한국어 SoundError. */
export async function mixSound(i: MixInput, deps: { run?: typeof realRun } = {}): Promise<string> {
  const run = deps.run ?? realRun
  try {
    await run('ffmpeg', buildMixArgs(i), { timeoutMs: FFMPEG_TIMEOUT_MS })
  } catch (e) {
    const detail = e instanceof ToolError ? e.stderr.trim().split('\n').slice(-2).join(' ') : (e as Error).message
    throw new SoundError(`배경음악·효과음을 입히지 못했어요. 같은 일이 반복되면 진행 기록을 알려 주세요. (${detail})`)
  }
  return i.outPath
}

export interface SoundChoice {
  /** 배경음악 곡 id (없으면 null) */
  bgm: string | null
  sfx: SfxMode
}

/** report.json 에 남기는 사용한 음원 정보 */
export interface SoundReport {
  bgm?: { id: string; title: string; author: string; license: string; sourceUrl: string }
  sfxCount: number
  /** 지금 쓴 크기(bgmGainDb·sfxGainDb)와 AI 가 추천한 크기(ai…)·이유. 소리를 입히기 전(오프셋 기능 이전)에 만든 리포트에는 없다 */
  balance?: { bgmGainDb: number; sfxGainDb: number; aiBgmGainDb: number; aiSfxGainDb: number; reason: string }
}

/** 다시 섞을 수 있게 남기는 "섞는 방법"(out/mix.json). 효과음 시각은 속도 적용 뒤 출력 시각이다. */
export interface MixRecipe {
  durationSec: number
  hasAudio: boolean
  /** 소리 없는 원본 렌더(dry.mp4)의 목소리 측정값 */
  voice: AudioLevel
  bgmId: string | null
  sfx: { trackId: string; atSec: number }[]
  /** 제작할 때 AI 가 정한 크기. 유저가 바꿔도 "AI 추천으로 되돌리기"가 이 값을 쓴다 */
  ai: SoundBalance
}

const level = z.number().nullable()
const RecipeSchema = z.object({
  durationSec: z.number().positive(),
  hasAudio: z.boolean(),
  voice: z.object({ lufs: level, peakDb: level }),
  bgmId: z.string().nullable(),
  sfx: z.array(z.object({ trackId: z.string(), atSec: z.number().min(0) })),
  ai: z.object({ bgmGainDb: z.number(), sfxGainDb: z.number(), reason: z.string() }),
})

const bgmInfo = (t: BgmTrack) => ({ id: t.id, title: t.title, author: t.author, license: t.license, sourceUrl: t.sourceUrl })

export interface ApplySoundInput {
  /** 렌더된 영상 */
  renderedPath: string
  /** 소리를 입힌 새 영상을 둘 곳 */
  outPath: string
  choice: SoundChoice
  /** 원본 시간 기준 남은 구간(효과음 위치 계산용) */
  kept: Span[]
  hookTitle: boolean
  durationSec: number
  hasAudio: boolean
  /** 말이 있는 영상인가(대본 분석 결과). 소리 트랙만 있고 말이 없으면 주변 소음을 목소리로 재지 않는다 */
  hasSpeech: boolean
  /** 렌더 뒤 속도 조정 배수(기본 1). 효과음 위치를 같은 배수로 앞당긴다 — durationSec 은 속도를 적용한 뒤의 길이를 준다 */
  speed?: number
  /** 음악·효과음 크기 오프셋(dB). 없으면 기본 규칙 그대로 */
  gains?: { bgmGainDb: number; sfxGainDb: number }
}

/** 사용자가 고른 곡·효과음으로 렌더된 영상에 소리를 입힌다. 고른 곡이 목록에 없으면 SoundError. */
export async function applySound(
  i: ApplySoundInput,
  deps: { catalog?: Catalog; measure?: typeof measureAudio; mix?: typeof mixSound } = {},
): Promise<{ path: string; report: SoundReport; recipe: Omit<MixRecipe, 'ai'> }> {
  const catalog = deps.catalog ?? loadCatalog()
  const measure = deps.measure ?? measureAudio
  const mix = deps.mix ?? mixSound

  const bgm = i.choice.bgm ? catalog.bgm.find((t) => t.id === i.choice.bgm) : undefined
  const problem = soundChoiceProblem(catalog, i.choice.bgm, i.choice.sfx)
  if (problem) throw new SoundError(problem)

  // 말이 없는 영상의 소리는 주변 소음이다 — 그것을 "목소리"로 재면 음악이 소음보다 14 LU 작게(거의 안 들리게) 깔린다.
  // 소음은 그대로 섞고, 음악은 절대 크기(-22 LUFS)로 깐다.
  const voice = i.hasAudio && i.hasSpeech ? await measure(i.renderedPath) : NO_AUDIO
  const events = i.choice.sfx === 'on' ? planSfx({ kept: i.kept, hookTitle: i.hookTitle, sfx: catalog.sfx }) : []
  const sfx = events.map((e) => {
    const t = catalog.sfx.find((x) => x.id === e.trackId)!
    return { file: trackPath(catalog, t), peakDb: t.peakDb, atSec: e.atSec / (i.speed ?? 1) }
  })
  const path = await mix({
    videoPath: i.renderedPath, outPath: i.outPath, durationSec: i.durationSec, hasAudio: i.hasAudio, voice,
    bgm: bgm ? { file: trackPath(catalog, bgm), lufs: bgm.lufs } : undefined,
    sfx,
    bgmGainDb: i.gains?.bgmGainDb,
    sfxGainDb: i.gains?.sfxGainDb,
  })
  return {
    path,
    report: { ...(bgm ? { bgm: bgmInfo(bgm) } : {}), sfxCount: sfx.length },
    recipe: { durationSec: i.durationSec, hasAudio: i.hasAudio, voice, bgmId: bgm?.id ?? null, sfx: events.map((e, k) => ({ trackId: e.trackId, atSec: sfx[k]!.atSec })) },
  }
}

/**
 * 제작 때 남긴 소리 없는 렌더(dry.mp4)와 섞는 방법(mix.json)으로 음악·효과음 크기만 바꿔 다시 섞는다. 화면은 다시 그리지 않는다.
 * 임시 파일(result.tmp.mp4)에 만들고 성공해야 result.mp4 를 바꿔치기한다 — 실패해도 기존 결과가 그대로 남는다.
 */
export async function remixSound(
  i: { outDir: string; gains: { bgmGainDb: number; sfxGainDb: number } },
  deps: { catalog?: Catalog; mix?: typeof mixSound } = {},
): Promise<SoundReport> {
  const dry = nodePath.join(i.outDir, 'dry.mp4')
  const recipeFile = nodePath.join(i.outDir, 'mix.json')
  if (!fs.existsSync(dry) || !fs.existsSync(recipeFile)) throw new SoundError(SOUND_NOT_REMIXABLE)
  const parsed = (() => {
    try {
      return RecipeSchema.safeParse(JSON.parse(fs.readFileSync(recipeFile, 'utf8')))
    } catch {
      return { success: false as const }
    }
  })()
  if (!parsed.success) throw new SoundError('섞는 방법 기록(mix.json)을 읽을 수 없어요. 이 작업은 다시 만들어 주세요.')
  const recipe = parsed.data

  const catalog = deps.catalog ?? loadCatalog()
  const mix = deps.mix ?? mixSound
  const problem = soundChoiceProblem(catalog, recipe.bgmId, recipe.sfx.length ? 'on' : 'off')
  if (problem) throw new SoundError(problem)
  const bgm = recipe.bgmId ? catalog.bgm.find((t) => t.id === recipe.bgmId) : undefined
  const sfx = recipe.sfx.map((e) => {
    const t = catalog.sfx.find((x) => x.id === e.trackId)
    if (!t) throw new SoundError(`효과음 파일(${e.trackId})을 음원 목록에서 찾을 수 없어요. 이 작업은 다시 만들어 주세요.`)
    return { file: trackPath(catalog, t), peakDb: t.peakDb, atSec: e.atSec }
  })
  const gains = { bgmGainDb: clampGainDb(i.gains.bgmGainDb), sfxGainDb: clampGainDb(i.gains.sfxGainDb) }

  const tmp = nodePath.join(i.outDir, 'result.tmp.mp4') // ffmpeg 는 확장자로 출력 형식을 정한다
  try {
    await mix({ videoPath: dry, outPath: tmp, durationSec: recipe.durationSec, hasAudio: recipe.hasAudio, voice: recipe.voice, bgm: bgm ? { file: trackPath(catalog, bgm), lufs: bgm.lufs } : undefined, sfx, ...gains })
    fs.renameSync(tmp, nodePath.join(i.outDir, 'result.mp4'))
  } catch (e) {
    fs.rmSync(tmp, { force: true })
    throw e
  }
  return {
    ...(bgm ? { bgm: bgmInfo(bgm) } : {}),
    sfxCount: sfx.length,
    balance: { ...gains, aiBgmGainDb: recipe.ai.bgmGainDb, aiSfxGainDb: recipe.ai.sfxGainDb, reason: recipe.ai.reason },
  }
}

/** CLI 의 --bgm / --sfx 값을 점검한다. 없는 곡이면 쓸 수 있는 id 를 알려 준다. */
export function checkSoundFlags(v: { bgm?: string; sfx?: string }, catalog: Catalog): { ok: true; bgm: string | null; sfx: SfxMode } | { ok: false; message: string } {
  if (v.sfx !== undefined && v.sfx !== 'on' && v.sfx !== 'off') return { ok: false, message: '--sfx 는 on 또는 off 예요' }
  if (v.sfx === 'on' && !catalog.sfx.length) return { ok: false, message: '효과음 파일이 아직 없어서 --sfx on 을 쓸 수 없어요' }
  const bgm = v.bgm === undefined || v.bgm === 'none' ? null : v.bgm
  if (bgm && !catalog.bgm.some((t) => t.id === bgm)) {
    const ids = catalog.bgm.map((t) => t.id)
    return { ok: false, message: `--bgm 곡을 찾을 수 없어요: ${bgm}. ${ids.length ? `쓸 수 있는 곡: ${ids.join(', ')}` : '음원 목록이 비어 있어요'}` }
  }
  return { ok: true, bgm, sfx: v.sfx === 'on' ? 'on' : 'off' }
}
