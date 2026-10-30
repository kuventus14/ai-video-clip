import fs from 'node:fs'
import path from 'node:path'
import { findDeepFilter, VOICE_TOOL_MISSING } from '../shared/voice.ts'
import { run as realRun } from './exec.ts'

/** 사용자에게 그대로 보여 줘도 되는 목소리 보정 오류(설치 안내 등). */
export class VoiceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VoiceError'
  }
}

/**
 * AI 소음 제거(deep-filter) 뒤에 붙이는 정리: 100Hz 아래 웅웅 소리 제거, 말소리 대역(1k·3kHz) 살짝 키움,
 * 말 사이 소음을 부드럽게 줄임. 실제 소음 있는 영상으로 고른 값이다 — 말끝을 더 세게 끊으면 말끝이 잘린다.
 */
export const VOICE_FILTER = 'highpass=f=100,equalizer=f=1000:t=q:w=1:g=2,equalizer=f=3000:t=q:w=1:g=1,agate=threshold=0.015:ratio=2.5:attack=8:release=120:range=0.3'

/**
 * '마이크 음성'(mic) 정리 — 핀마이크를 입 가까이 단 소리처럼:
 * 80Hz 아래·12kHz 위(바람·쉿 소리) 자르기 → 가까운 마이크의 따뜻함(180Hz)·또렷함(3.5kHz) 살리고 웅웅거림(350Hz) 줄이기 →
 * 치찰음 줄이기 → 크기 고르게(압축) → 말 사이를 거의 조용하게(게이트를 깊게, 말끝은 천천히 닫아 잘리지 않게).
 */
export const MIC_FILTER = [
  'highpass=f=80',
  'lowpass=f=12000',
  'equalizer=f=180:t=q:w=1:g=2',
  'equalizer=f=350:t=q:w=1.2:g=-3',
  'equalizer=f=3500:t=q:w=1:g=3',
  'deesser=i=0.4',
  'acompressor=threshold=0.08:ratio=3:attack=5:release=120:makeup=2',
  'agate=threshold=0.02:ratio=4:attack=5:release=200:range=0.06',
].join(',')

/** 모드별 설정: deep-filter 소음 제거 한도(dB, 없으면 끝까지)와 그 뒤 정리 필터 */
export const VOICE_PROFILES = {
  voice: { attenDb: 30 as number | undefined, filter: VOICE_FILTER },
  mic: { attenDb: undefined as number | undefined, filter: MIC_FILTER },
} as const
export type VoiceProfile = keyof typeof VOICE_PROFILES
const LOUDNESS = 'I=-16:TP=-1.5:LRA=11'
/** deep-filter 가 파일 하나를 처리하는 데 인터넷이 필요 없다 — macOS 에서는 네트워크를 막은 채 돌린다. */
const NO_NETWORK = '(version 1)(allow default)(deny network*)'
const TIMEOUT_MS = 20 * 60_000

export interface VoiceDeps {
  run: typeof realRun
  findTool: () => string | null
  platform: NodeJS.Platform
}

export interface VoiceInput {
  sourcePath: string
  outPath: string
  /** 중간 파일을 두는 폴더(끝나면 지운다) */
  workDir: string
  /** 원본 영상 길이 — 보정한 소리를 이 길이에 맞춘다(소음 제거가 끝을 조금 줄이므로) */
  durationSec: number
  /** 'voice'(기본): 소음을 줄임 / 'mic': 핀마이크처럼 주변 소리를 끝까지 지우고 목소리를 앞으로 */
  profile?: VoiceProfile
}

/**
 * 영상의 소리만 정리해 새 영상을 만든다: AI 소음 제거 → 말소리 대역 정리 → 소리 크기를 -16 LUFS 로 맞춤.
 * 영상 화면은 다시 인코딩하지 않고 복사한다(화질 손해 없음). 길이는 원본과 같다. 돌려주는 값은 outPath.
 */
export async function enhanceVoice(i: VoiceInput, deps: Partial<VoiceDeps> = {}): Promise<string> {
  const d: VoiceDeps = { run: realRun, findTool: () => findDeepFilter(), platform: process.platform, ...deps }
  const tool = d.findTool()
  if (!tool) throw new VoiceError(VOICE_TOOL_MISSING)

  const raw = path.join(i.workDir, 'voice-raw.wav')
  const cleanDir = path.join(i.workDir, 'clean')
  const cleaned = path.join(cleanDir, 'voice-raw.wav')
  const ffmpeg = (args: string[]) => d.run('ffmpeg', ['-v', 'error', '-nostdin', '-y', ...args], { timeoutMs: TIMEOUT_MS })

  fs.mkdirSync(i.workDir, { recursive: true })
  try {
    await ffmpeg(['-i', i.sourcePath, '-vn', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', raw])

    // voice: -a 30 으로 소음 제거를 30dB 로 제한해 쉬는 구간이 완전한 무음이 되지 않게 / mic: 한도 없이 끝까지 지운다
    const profile = VOICE_PROFILES[i.profile ?? 'voice']
    const filter = profile.filter
    const deep = ['-D', ...(profile.attenDb !== undefined ? ['-a', String(profile.attenDb)] : []), '-o', cleanDir, raw]
    await (d.platform === 'darwin' ? d.run('sandbox-exec', ['-p', NO_NETWORK, tool, ...deep], { timeoutMs: TIMEOUT_MS }) : d.run(tool, deep, { timeoutMs: TIMEOUT_MS }))
    if (!fs.existsSync(cleaned)) throw new VoiceError('목소리 보정 결과 파일이 만들어지지 않았어요. 같은 일이 반복되면 진행 기록을 알려 주세요.')

    // 소리 크기는 두 번에 걸쳐 정확히 맞춘다(1차: 측정, 2차: 그 값으로 적용)
    const measured = await d.run('ffmpeg', ['-hide_banner', '-nostats', '-i', cleaned, '-af', `${filter},loudnorm=${LOUDNESS}:print_format=json`, '-f', 'null', '-'], { timeoutMs: TIMEOUT_MS })
    const loudnorm = loudnormFrom(measured.stderr)

    await ffmpeg([
      '-i', i.sourcePath, '-i', cleaned,
      '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy',
      '-af', `${filter},${loudnorm},apad=whole_dur=${i.durationSec}`,
      '-c:a', 'aac', '-b:a', '192k', '-t', String(i.durationSec),
      i.outPath,
    ])
    return i.outPath
  } finally {
    fs.rmSync(i.workDir, { recursive: true, force: true })
  }
}

/** 1차 측정 결과로 정확히 맞추는 loudnorm. 소리가 거의 없어 측정이 안 되면(-inf) 측정값 없이 한 번에 맞춘다. */
function loudnormFrom(stderr: string): string {
  const base = `loudnorm=${LOUDNESS}`
  try {
    const m = JSON.parse(stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1)) as Record<string, string>
    const keys = ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset'] as const
    if (!keys.every((k) => Number.isFinite(parseFloat(m[k]!)))) return base
    return `${base}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`
  } catch {
    return base
  }
}
