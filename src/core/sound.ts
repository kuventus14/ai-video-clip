import { SoundError, type SfxRole, type SfxTrack } from '../shared/sound.ts'
import { run as realRun, ToolError } from './exec.ts'
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
/** 목소리가 이 값(LU)보다 크게 들어오면 음악을 줄이기 시작한다 */
export const DUCK_THRESHOLD_BELOW_VOICE_LU = 10
export const DUCK_RATIO = 6
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
}

/**
 * 렌더된 영상에 배경음악·효과음을 섞는 ffmpeg 인자. 화면은 복사하고 소리만 다시 만든다.
 * 음악은 반복해 영상 길이에 맞추고 앞뒤를 페이드, 목소리가 있으면 말할 때 자동으로 줄인다(sidechaincompress).
 * 마지막에 alimiter 로 찌그러짐을 막는다(level=disabled — 켜 두면 전체 소리가 1dB 커진다).
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
      `[${bgmIn}]${norm},atrim=duration=${fmt(dur)},asetpts=PTS-STARTPTS,volume=${(target - i.bgm.lufs).toFixed(2)}dB,afade=t=in:st=0:d=${fmt(fadeIn)},afade=t=out:st=${fmt(dur - fadeOut)}:d=${fmt(fadeOut)}[bg]`,
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
    graph.push(`[${sfxIn[k]}]${norm},volume=${(sfxPeak - s.peakDb).toFixed(2)}dB,adelay=${Math.round(s.atSec * 1000)}:all=1[sfx${k}]`)
    mixed.push(`[sfx${k}]`)
  })

  graph.push(`${mixed.join('')}amix=inputs=${mixed.length}:normalize=0:duration=first:dropout_transition=0,alimiter=limit=${LIMIT}:level=disabled[aout]`)
  args.push('-filter_complex', graph.join(';'), '-map', '0:v:0', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', fmt(dur), i.outPath)
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
