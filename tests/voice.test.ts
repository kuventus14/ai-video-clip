import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { ensureFixtures } from './helpers/fixtures.ts'
import { run } from '../src/core/exec.ts'
import { probeVideo } from '../src/core/media.ts'
import { enhanceVoice, VOICE_FILTER, VoiceError, type VoiceDeps } from '../src/core/voice.ts'
import { findDeepFilter, VOICE_TOOL_MISSING } from '../src/shared/voice.ts'

let work: string
beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'vae-voice-'))
})

const TOOL = '/fake/deep-filter'
const LOUDNORM_JSON = JSON.stringify({ input_i: '-24.30', input_tp: '-8.70', input_lra: '9.40', input_thresh: '-35.10', target_offset: '0.20' })

/** 가짜 run: 호출을 기록하고, deep-filter 는 출력 폴더에 결과 파일을 만들어 주고, 측정 호출에는 loudnorm JSON 을 돌려준다. */
function fake(over: { measure?: string; noOutput?: boolean; platform?: NodeJS.Platform; tool?: string | null } = {}) {
  const calls: { file: string; args: string[] }[] = []
  const deps: Partial<VoiceDeps> = {
    platform: over.platform ?? 'darwin',
    findTool: () => (over.tool === undefined ? TOOL : over.tool),
    run: (async (file: string, args: string[]) => {
      calls.push({ file, args })
      const isDeep = file === TOOL || args.includes(TOOL)
      if (isDeep && !over.noOutput) {
        const outDir = args[args.indexOf('-o') + 1]!
        fs.mkdirSync(outDir, { recursive: true })
        fs.writeFileSync(path.join(outDir, 'voice-raw.wav'), 'wav')
      }
      if (file === 'ffmpeg' && args.some((a) => a.includes('print_format=json'))) return { stdout: '', stderr: `...\n${over.measure ?? LOUDNORM_JSON}\n` }
      if (file === 'ffmpeg' && args[args.length - 1]!.endsWith('.wav') && !args.includes('-i' + 'x')) fs.writeFileSync(args[args.length - 1]!, 'raw')
      return { stdout: '', stderr: '' }
    }) as VoiceDeps['run'],
  }
  return { calls, deps }
}

const input = () => ({ sourcePath: '/in/source.mp4', outPath: path.join(work, 'source-voice.mp4'), workDir: path.join(work, 'voice'), durationSec: 20.03 })

describe('enhanceVoice — 처리 순서', () => {
  test('소리 추출 → AI 소음 제거(네트워크 차단) → 크기 측정 → 영상은 복사하고 소리만 바꿔 합치기', async () => {
    const f = fake()
    const out = await enhanceVoice(input(), f.deps)
    expect(out).toBe(input().outPath)
    expect(f.calls).toHaveLength(4)

    const [extract, deep, measure, mux] = f.calls
    expect(extract!.file).toBe('ffmpeg')
    expect(extract!.args).toEqual(expect.arrayContaining(['-i', '/in/source.mp4', '-vn', '-ac', '2', '-ar', '48000']))

    // macOS: sandbox-exec 로 네트워크를 막고 실행 파일은 인자로 넘긴다. 소음 제거는 30dB 로 제한(쉬는 구간이 완전 무음이 되지 않게)
    expect(deep!.file).toBe('sandbox-exec')
    expect(deep!.args.join(' ')).toContain('(deny network*)')
    expect(deep!.args).toEqual(expect.arrayContaining([TOOL, '-D', '-a', '30']))

    // 1차 측정: 같은 필터 뒤에 loudnorm(-16 LUFS, -1.5 dBTP)
    const measureAf = measure!.args[measure!.args.indexOf('-af') + 1]!
    expect(measureAf.startsWith(VOICE_FILTER + ',')).toBe(true)
    expect(measureAf).toContain('loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json')

    // 합치기: 영상 스트림 복사(화질 손해 없음), 측정값으로 정확히 맞춘 loudnorm, 길이는 원본에 맞춤
    expect(mux!.args).toEqual(expect.arrayContaining(['-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-t', '20.03']))
    const muxAf = mux!.args[mux!.args.indexOf('-af') + 1]!
    expect(muxAf).toContain('measured_I=-24.30')
    expect(muxAf).toContain('measured_TP=-8.70')
    expect(muxAf).toContain('linear=true')
    expect(muxAf).toContain('apad=whole_dur=20.03')
    expect(mux!.args.at(-1)).toBe(input().outPath)
  })

  test('macOS 가 아니면 sandbox-exec 없이 deep-filter 를 직접 실행한다', async () => {
    const f = fake({ platform: 'linux' })
    await enhanceVoice(input(), f.deps)
    expect(f.calls[1]!.file).toBe(TOOL)
    expect(f.calls.some((c) => c.file === 'sandbox-exec')).toBe(false)
  })

  test('끝나면 임시 파일(추출한 소리·AI 결과)을 지운다', async () => {
    const f = fake()
    await enhanceVoice(input(), f.deps)
    const left = fs.existsSync(input().workDir) ? fs.readdirSync(input().workDir) : []
    expect(left).toEqual([])
  })

  test('소리가 거의 무음이라 측정값이 -inf 이면 측정값 없이 한 번에 맞추는 loudnorm 으로 끝낸다(실패하지 않는다)', async () => {
    const f = fake({ measure: JSON.stringify({ input_i: '-inf', input_tp: '-inf', input_lra: '0.00', input_thresh: '-70.00', target_offset: 'inf' }) })
    await enhanceVoice(input(), f.deps)
    const muxAf = f.calls[3]!.args[f.calls[3]!.args.indexOf('-af') + 1]!
    expect(muxAf).not.toContain('measured_I')
    expect(muxAf).toContain('loudnorm=I=-16')
  })
})

describe('enhanceVoice — 실패', () => {
  test('도구가 없으면 VoiceError(설치 안내)이고 아무것도 실행하지 않는다', async () => {
    const f = fake({ tool: null })
    const err = await enhanceVoice(input(), f.deps).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(VoiceError)
    expect((err as VoiceError).message).toBe(VOICE_TOOL_MISSING)
    expect(f.calls).toHaveLength(0)
  })

  test('AI 소음 제거가 결과 파일을 만들지 못하면 VoiceError', async () => {
    const f = fake({ noOutput: true })
    await expect(enhanceVoice(input(), f.deps)).rejects.toBeInstanceOf(VoiceError)
  })
})

describe('enhanceVoice — 실제 도구(INTEGRATION=1, deep-filter 설치 필요)', () => {
  test.skipIf(process.env.INTEGRATION !== '1' || !findDeepFilter())('길이·영상 스트림은 그대로, 소리는 있다', async () => {
    const f = await ensureFixtures()
    const out = await enhanceVoice({ sourcePath: f.landscape, outPath: path.join(work, 'real.mp4'), workDir: path.join(work, 'v'), durationSec: 5 })
    const [a, b] = [await probeVideo(f.landscape), await probeVideo(out)]
    expect(b.hasAudio).toBe(true)
    expect(Math.abs(b.durationSec - a.durationSec)).toBeLessThan(0.1)
    expect([b.width, b.height, b.videoCodec]).toEqual([a.width, a.height, a.videoCodec])
    await run('ffmpeg', ['-v', 'error', '-i', out, '-f', 'null', '-']) // 끝까지 읽힌다
  }, 120_000)
})
