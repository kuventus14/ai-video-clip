import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { run } from '../src/core/exec.ts'
import { probeVideo } from '../src/core/media.ts'
import { applySound, buildMixArgs, checkSoundFlags, measureAudio, mixSound, planSfx, type MixInput } from '../src/core/sound.ts'
import { SoundError, type BgmTrack, type Catalog, type SfxRole, type SfxTrack } from '../src/shared/sound.ts'
import { ensureFixtures, type Fixtures } from './helpers/fixtures.ts'

const sfx = (id: string, role: SfxRole): SfxTrack => ({
  kind: 'sfx', id, file: `sfx/${id}.mp3`, title: id, author: '작가', sourceUrl: 'https://mixkit.co/x',
  license: 'Mixkit Free License', durationSec: 1, lufs: null, peakDb: -3, role,
})
const WHOOSH = sfx('w1', 'whoosh')
const POP = sfx('p1', 'pop')
const span = (start: number, end: number) => ({ start, end })

describe('planSfx — 효과음을 어디에 넣을까', () => {
  test('남은 구간이 3개면 경계 두 곳(출력 시간 5초·9초)의 0.15초 앞에 whoosh', () => {
    const ev = planSfx({ kept: [span(0, 5), span(8, 12), span(15, 20)], hookTitle: false, sfx: [WHOOSH] })
    expect(ev.map((e) => e.role)).toEqual(['whoosh', 'whoosh'])
    expect(ev[0]!.atSec).toBeCloseTo(4.85, 5)
    expect(ev[1]!.atSec).toBeCloseTo(8.85, 5)
  })
  test('제목 카드가 있고 pop 파일이 있으면 0.1초에 pop 이 맨 앞', () => {
    const ev = planSfx({ kept: [span(0, 5), span(8, 12)], hookTitle: true, sfx: [WHOOSH, POP] })
    expect(ev[0]).toMatchObject({ role: 'pop', trackId: 'p1' })
    expect(ev[0]!.atSec).toBeCloseTo(0.1, 5)
    expect(ev[1]!.role).toBe('whoosh')
  })
  test('제목 카드가 없으면 pop 은 없다', () => {
    const ev = planSfx({ kept: [span(0, 5), span(8, 12)], hookTitle: false, sfx: [WHOOSH, POP] })
    expect(ev.map((e) => e.role)).toEqual(['whoosh'])
  })
  test('pop 파일이 없으면 제목 카드가 있어도 pop 은 없다', () => {
    const ev = planSfx({ kept: [span(0, 5)], hookTitle: true, sfx: [WHOOSH] })
    expect(ev).toEqual([])
  })
  test('whoosh 파일이 없으면 컷 경계에는 아무것도 넣지 않는다', () => {
    const ev = planSfx({ kept: [span(0, 5), span(8, 12), span(15, 20)], hookTitle: false, sfx: [POP] })
    expect(ev).toEqual([])
  })
  test('경계가 0.5초 간격으로 몰려 있으면 2초 간격 규칙으로 첫 번째만 남는다', () => {
    const ev = planSfx({ kept: [span(0, 0.5), span(1, 1.5), span(2, 2.5), span(3, 3.5)], hookTitle: false, sfx: [WHOOSH] })
    expect(ev).toHaveLength(1)
    expect(ev[0]!.atSec).toBeCloseTo(0.35, 5)
  })
  test('컷이 아주 많아도 이벤트 사이는 항상 2초 이상이다', () => {
    const kept = Array.from({ length: 200 }, (_, n) => span(n * 2, n * 2 + 0.7)) // 0.7초 조각 200개
    const ev = planSfx({ kept, hookTitle: true, sfx: [WHOOSH, POP] })
    expect(ev.length).toBeGreaterThan(5)
    for (let n = 1; n < ev.length; n++) expect(ev[n]!.atSec - ev[n - 1]!.atSec).toBeGreaterThanOrEqual(2 - 1e-6)
  })
  test('제목 pop 과 2초 안에 있는 첫 경계 whoosh 는 겹치지 않는다(pop 이 남는다)', () => {
    const ev = planSfx({ kept: [span(0, 1), span(3, 9)], hookTitle: true, sfx: [WHOOSH, POP] })
    expect(ev.map((e) => e.role)).toEqual(['pop'])
  })
  test('총 길이 끝 0.3초 안의 이벤트는 버린다', () => {
    const ev = planSfx({ kept: [span(0, 19.9), span(25, 25.1)], hookTitle: false, sfx: [WHOOSH] }) // 경계 19.9 → 19.75, 총 20
    expect(ev).toEqual([])
  })
  test('0초보다 앞(음수)이 되는 이벤트는 버린다', () => {
    const ev = planSfx({ kept: [span(0, 0.1), span(3, 9)], hookTitle: false, sfx: [WHOOSH] })
    expect(ev).toEqual([])
  })
  test('같은 역할의 파일이 여럿이면 이벤트 순서대로 번갈아 쓴다', () => {
    const w2 = sfx('w2', 'whoosh')
    const ev = planSfx({ kept: [span(0, 3), span(5, 8), span(10, 13), span(15, 18)], hookTitle: false, sfx: [WHOOSH, w2] })
    expect(ev.map((e) => e.trackId)).toEqual(['w1', 'w2', 'w1'])
  })
  test('같은 입력이면 늘 같은 결과', () => {
    const i = { kept: [span(0, 3), span(5, 8), span(10, 13)], hookTitle: true, sfx: [WHOOSH, POP] }
    expect(planSfx(i)).toEqual(planSfx(i))
  })
  test('남은 구간이 하나면 경계가 없어서 이벤트도 없다', () => {
    expect(planSfx({ kept: [span(0, 10)], hookTitle: false, sfx: [WHOOSH, POP] })).toEqual([])
  })
  test('남은 구간이 없어도 던지지 않는다', () => {
    expect(planSfx({ kept: [], hookTitle: true, sfx: [WHOOSH, POP] })).toEqual([])
  })
})

const VOICE = { lufs: -20, peakDb: -3 }
const base = (extra: Partial<MixInput> = {}): MixInput => ({
  videoPath: '/v/in.mp4', outPath: '/v/out.mp4', durationSec: 10, hasAudio: true, voice: VOICE, sfx: [], ...extra,
})
/** 필터 그래프 문자열(-filter_complex 다음 인자) */
const graphOf = (args: string[]) => args[args.indexOf('-filter_complex') + 1]!

describe('buildMixArgs — ffmpeg 인자 (순수 함수)', () => {
  test('소리 없는 영상 + 배경음악: 무음 바탕(anullsrc)을 쓰고 목소리 줄임(sidechaincompress)은 없다', () => {
    const a = buildMixArgs(base({ hasAudio: false, voice: { lufs: null, peakDb: null }, bgm: { file: '/b.mp3', lufs: -14 } }))
    expect(a).toContain('-stream_loop')
    expect(a.join(' ')).toContain('anullsrc')
    expect(graphOf(a)).not.toContain('sidechaincompress')
  })
  test('목소리가 있으면 sidechaincompress 로 말할 때 음악을 줄인다', () => {
    const g = graphOf(buildMixArgs(base({ bgm: { file: '/b.mp3', lufs: -14 } })))
    expect(g).toContain('sidechaincompress')
  })
  test('소리는 있는데 거의 무음(측정값 없음)이면 줄임 없이 절대 음량(-22 LUFS)에 맞춘다', () => {
    const g = graphOf(buildMixArgs(base({ voice: { lufs: null, peakDb: null }, bgm: { file: '/b.mp3', lufs: -14 } })))
    expect(g).not.toContain('sidechaincompress')
    expect(g).toContain('volume=-8.00dB') // -22 - (-14)
  })
  test('배경음악 크기: 목소리 LUFS - 14 에 맞춘다', () => {
    const g = graphOf(buildMixArgs(base({ bgm: { file: '/b.mp3', lufs: -14 } }))) // 목소리 -20 → 목표 -34 → 곡이 -14 라서 -20dB
    expect(g).toContain('volume=-20.00dB')
  })
  test('효과음 3개 → adelay 3개, 밀리초로 반올림', () => {
    const a = buildMixArgs(base({ sfx: [{ file: '/s1.mp3', peakDb: -3, atSec: 1.2344 }, { file: '/s2.mp3', peakDb: -3, atSec: 3 }, { file: '/s3.mp3', peakDb: -3, atSec: 7.5 }] }))
    const g = graphOf(a)
    expect(g.match(/adelay=/g)).toHaveLength(3)
    expect(g).toContain('adelay=1234:all=1')
    expect(g).toContain('adelay=3000:all=1')
    expect(a).not.toContain('-stream_loop') // 음악이 없으면 반복 입력도 없다
  })
  test('효과음 크기: 목소리 최대치 -8dB(최대 -6dBFS)에 맞춘다', () => {
    const g = graphOf(buildMixArgs(base({ sfx: [{ file: '/s.mp3', peakDb: -3, atSec: 1 }] }))) // 목표 min(-6, -3-8=-11) = -11 → -11 - (-3) = -8
    expect(g).toContain('volume=-8.00dB')
  })
  test('음악 오프셋 +3dB 는 기본 -20.00dB 위에 더해져 -17.00dB, 오프셋 0·생략은 기본 그대로', () => {
    expect(graphOf(buildMixArgs(base({ bgm: { file: '/b.mp3', lufs: -14 }, bgmGainDb: 3 })))).toContain('volume=-17.00dB')
    expect(graphOf(buildMixArgs(base({ bgm: { file: '/b.mp3', lufs: -14 }, bgmGainDb: 0 })))).toContain('volume=-20.00dB')
  })
  test('효과음 오프셋 -2dB 는 기본 -8.00dB 위에 더해져 -10.00dB (음악 오프셋은 효과음에 영향 없음)', () => {
    const g = graphOf(buildMixArgs(base({ sfx: [{ file: '/s.mp3', peakDb: -3, atSec: 1 }], sfxGainDb: -2, bgmGainDb: 5 })))
    expect(g).toContain('volume=-10.00dB')
  })
  test('말 없는 영상의 음악(절대 크기 -22 LUFS)에도 음악 오프셋이 더해진다', () => {
    const g = graphOf(buildMixArgs(base({ hasAudio: false, voice: { lufs: null, peakDb: null }, bgm: { file: '/b.mp3', lufs: -14 }, bgmGainDb: -4 })))
    expect(g).toContain('volume=-12.00dB') // -22 - (-14) - 4
  })
  test('alimiter 가 마지막 필터이고 출력 이름은 [aout]', () => {
    const g = graphOf(buildMixArgs(base({ bgm: { file: '/b.mp3', lufs: -14 } })))
    expect(g).toMatch(/alimiter=limit=0\.8:level=disabled\[aout\]$/)
  })
  test('화면은 다시 인코딩하지 않고(-c:v copy) 길이는 영상 길이로 자른다', () => {
    const a = buildMixArgs(base({ bgm: { file: '/b.mp3', lufs: -14 }, durationSec: 12.5 }))
    expect(a.slice(a.indexOf('-c:v'), a.indexOf('-c:v') + 2)).toEqual(['-c:v', 'copy'])
    expect(a.slice(a.indexOf('-t'), a.indexOf('-t') + 2)).toEqual(['-t', '12.5'])
  })
  test('결과 파일 앞쪽에 색인(faststart)을 둔다 — 인스타 업로드 규격과 브라우저 미리보기가 요구한다', () => {
    const a = buildMixArgs(base({ bgm: { file: '/b.mp3', lufs: -14 } }))
    const k = a.indexOf('-movflags')
    expect(a.slice(k, k + 2)).toEqual(['-movflags', '+faststart'])
    expect(k).toBeLessThan(a.indexOf('/v/out.mp4'))
  })
  test('영상이 1.5초면 페이드가 길이의 1/4 로 줄고 NaN·음수가 없다', () => {
    const g = graphOf(buildMixArgs(base({ durationSec: 1.5, bgm: { file: '/b.mp3', lufs: -14 } })))
    expect(g).toContain('afade=t=in:st=0:d=0.375')
    expect(g).toContain('afade=t=out:st=1.125:d=0.375')
    expect(g).not.toMatch(/NaN|Infinity|st=-|d=-/)
  })
  test('영상이 길면 페이드는 앞 1초·뒤 2.5초가 상한', () => {
    const g = graphOf(buildMixArgs(base({ durationSec: 60, bgm: { file: '/b.mp3', lufs: -14 } })))
    expect(g).toContain('afade=t=in:st=0:d=1')
    expect(g).toContain('afade=t=out:st=57.5:d=2.5')
  })
})

describe('측정과 섞기 — 실제 ffmpeg (합성 소리)', () => {
  let fx: Fixtures
  let tmp: string
  const f = (name: string) => path.join(tmp, name)
  const ff = (args: string[]) => run('ffmpeg', ['-v', 'error', '-nostdin', '-y', ...args])
  /** out 의 [from, from+len) 구간만 잘라 측정한다 */
  const levelOf = async (file: string, from: number, len: number) => {
    const win = f(`win-${from}-${len}.wav`)
    await ff(['-ss', String(from), '-t', String(len), '-i', file, '-vn', '-c:a', 'pcm_s16le', win])
    return measureAudio(win)
  }

  beforeAll(async () => {
    fx = await ensureFixtures()
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vae-sound-mix-'))
    await ff(['-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.3:duration=2:sample_rate=48000', '-ac', '2', f('bgm.wav')]) // 2초짜리 음악
    await ff(['-f', 'lavfi', '-i', 'anoisesrc=color=white:amplitude=0.5:duration=0.3:sample_rate=48000', '-ac', '2', f('hit.wav')]) // 0.3초 효과음
    // 앞 1.5초만 목소리(사인파)가 있고 4초까지 이어지는 영상
    await ff(['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.5',
      '-filter_complex', '[1:a]apad=whole_dur=4[a]', '-map', '0:v', '-map', '[a]', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', '4', f('talk-gap.mp4')])
  })
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

  test('measureAudio: 사인파는 LUFS·peak 가 숫자', async () => {
    const m = await measureAudio(fx.landscape)
    expect(m.lufs).toBeGreaterThan(-40)
    expect(m.lufs).toBeLessThan(-5)
    expect(m.peakDb).toBeLessThan(0)
  })
  test('measureAudio: 소리 트랙이 없는 영상 → null, null', async () => {
    expect(await measureAudio(fx.silent)).toEqual({ lufs: null, peakDb: null })
  })
  test('measureAudio: 0.4초보다 짧은 소리는 음량(lufs)은 null, 최대치(peakDb)는 숫자', async () => {
    await ff(['-f', 'lavfi', '-i', 'sine=frequency=1000:duration=0.2', '-ac', '2', '-ar', '48000', f('blip.wav')])
    const m = await measureAudio(f('blip.wav'))
    expect(m.lufs).toBeNull()
    expect(m.peakDb).toBeLessThan(0)
  })
  test('measureAudio: 완전한 무음 → null, null', async () => {
    await ff(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '1', f('mute.wav')])
    expect(await measureAudio(f('mute.wav'))).toEqual({ lufs: null, peakDb: null })
  })

  test('음악(2초)이 영상(5초)보다 짧아도 반복해서 영상 길이(5±0.1초)로 끝나고 소리가 있다', async () => {
    const voice = await measureAudio(fx.landscape)
    const bgm = { file: f('bgm.wav'), lufs: (await measureAudio(f('bgm.wav'))).lufs! }
    const out = await mixSound({ videoPath: fx.landscape, outPath: f('mix-a.mp4'), durationSec: 5, hasAudio: true, voice, bgm, sfx: [] })
    const info = await probeVideo(out)
    expect(info.durationSec).toBeGreaterThan(4.9)
    expect(info.durationSec).toBeLessThan(5.1)
    expect(info.hasAudio).toBe(true)
    expect(info.width).toBe(1920) // 화면은 그대로
  })
  test('섞은 결과 파일은 색인(moov)이 데이터(mdat)보다 앞에 있다', async () => {
    const voice = await measureAudio(fx.landscape)
    const out = await mixSound({ videoPath: fx.landscape, outPath: f('mix-fast.mp4'), durationSec: 5, hasAudio: true, voice, bgm: { file: f('bgm.wav'), lufs: (await measureAudio(f('bgm.wav'))).lufs! }, sfx: [] })
    const buf = fs.readFileSync(out)
    expect(buf.indexOf('moov')).toBeGreaterThan(-1)
    expect(buf.indexOf('moov')).toBeLessThan(buf.indexOf('mdat'))
  })
  test('소리 트랙은 있지만 말이 없는 영상(작은 주변 소음뿐)에 음악을 넣으면 음악이 들린다(약 -22 LUFS)', async () => {
    await ff(['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30:duration=3', '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.002:duration=3:sample_rate=48000', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', f('ambient.mp4')])
    const bgm = { file: f('bgm.wav'), lufs: (await measureAudio(f('bgm.wav'))).lufs! }
    const out = await mixSound({ videoPath: f('ambient.mp4'), outPath: f('mix-ambient.mp4'), durationSec: 3, hasAudio: true, voice: { lufs: null, peakDb: null }, bgm, sfx: [] })
    const lufs = (await measureAudio(out)).lufs
    expect(lufs).not.toBeNull()
    expect(Math.abs(lufs! - -22)).toBeLessThanOrEqual(3)
  })
  test('소리가 없는 영상(2초)에 음악을 넣으면 소리가 생기고 길이는 그대로', async () => {
    const bgm = { file: f('bgm.wav'), lufs: (await measureAudio(f('bgm.wav'))).lufs! }
    const out = await mixSound({ videoPath: fx.silent, outPath: f('mix-b.mp4'), durationSec: 2, hasAudio: false, voice: { lufs: null, peakDb: null }, bgm, sfx: [] })
    const info = await probeVideo(out)
    expect(info.hasAudio).toBe(true)
    expect(info.durationSec).toBeGreaterThan(1.9)
    expect(info.durationSec).toBeLessThan(2.1)
    expect((await measureAudio(out)).lufs).not.toBeNull()
  })
  test('음악이 너무 커도 한계(limiter)가 걸려 최대 음량이 -0.9 dBFS 를 넘지 않는다', async () => {
    const voice = await measureAudio(fx.landscape)
    // 곡의 LUFS 를 일부러 -60 이라 속여 +40dB 가까이 키우게 한다
    const out = await mixSound({ videoPath: fx.landscape, outPath: f('mix-hot.mp4'), durationSec: 5, hasAudio: true, voice, bgm: { file: f('bgm.wav'), lufs: -60 }, sfx: [] })
    expect((await measureAudio(out)).peakDb!).toBeLessThanOrEqual(-0.9)
  })
  test('목소리가 없는 구간의 음악 크기는 목소리 LUFS - 14 (±3 LU)', async () => {
    const voice = await measureAudio(f('talk-gap.mp4'))
    const bgm = { file: f('bgm.wav'), lufs: (await measureAudio(f('bgm.wav'))).lufs! }
    const out = await mixSound({ videoPath: f('talk-gap.mp4'), outPath: f('mix-gap.mp4'), durationSec: 4, hasAudio: true, voice, bgm, sfx: [] })
    const gap = await levelOf(out, 2.4, 0.6) // 목소리는 1.5초에 끝남 — 줄임이 풀리고 끝 페이드(3~4초) 전
    expect(gap.lufs).not.toBeNull()
    expect(Math.abs(gap.lufs! - (voice.lufs! - 14))).toBeLessThanOrEqual(3)
  })
  test('효과음은 정한 시각(1.0초)부터 들린다', async () => {
    const hit = { file: f('hit.wav'), peakDb: (await measureAudio(f('hit.wav'))).peakDb! }
    const out = await mixSound({ videoPath: fx.silent, outPath: f('mix-sfx.mp4'), durationSec: 2, hasAudio: false, voice: { lufs: null, peakDb: null }, sfx: [{ ...hit, atSec: 1 }] })
    expect((await levelOf(out, 0, 0.8)).peakDb ?? -120).toBeLessThan(-60) // 그 전은 조용하다
    expect((await levelOf(out, 1.05, 0.2)).peakDb ?? -120).toBeGreaterThan(-30)
  })
  test('ffmpeg 가 실패하면(음악 파일이 없음) 한국어 SoundError', async () => {
    const p = mixSound({ videoPath: fx.landscape, outPath: f('mix-fail.mp4'), durationSec: 5, hasAudio: true, voice: { lufs: -20, peakDb: -3 }, bgm: { file: f('nope.wav'), lufs: -14 }, sfx: [] })
    await expect(p).rejects.toThrow(SoundError)
    await expect(p).rejects.toThrow(/배경음악·효과음/)
  })
})

const BGM: BgmTrack = { kind: 'bgm', id: 'calm-1', file: 'bgm/calm-1.mp3', title: '잔잔한 곡', author: '작가', sourceUrl: 'https://pixabay.com/music/x', license: 'Pixabay License', durationSec: 90, lufs: -14, peakDb: -1, mood: 'calm' }
const CATALOG: Catalog = { dir: '/snd', bgm: [BGM], sfx: [WHOOSH, POP] }
const RENDERED = { renderedPath: '/w/render-1.mp4', outPath: '/w/mix-1.mp4', kept: [span(0, 5), span(8, 12)], hookTitle: true, durationSec: 9, hasAudio: true, hasSpeech: true }

describe('applySound — 고른 값으로 측정하고 섞는다', () => {
  const fakes = () => {
    const calls: { mix?: MixInput; measured: string[] } = { measured: [] }
    return {
      calls,
      deps: {
        catalog: CATALOG,
        measure: async (f: string) => (calls.measured.push(f), { lufs: -18, peakDb: -2 }),
        mix: async (m: MixInput) => ((calls.mix = m), m.outPath),
      },
    }
  }

  test('곡 id 가 목록에 없으면 SoundError(그 id 를 말한다)', async () => {
    const f = fakes()
    await expect(applySound({ ...RENDERED, choice: { bgm: 'nope', sfx: 'off' } }, f.deps)).rejects.toThrow(/nope/)
    await expect(applySound({ ...RENDERED, choice: { bgm: 'nope', sfx: 'off' } }, f.deps)).rejects.toThrow(SoundError)
  })
  test('효과음 id 를 배경음악으로 고르면 SoundError', async () => {
    await expect(applySound({ ...RENDERED, choice: { bgm: 'w1', sfx: 'off' } }, fakes().deps)).rejects.toThrow(SoundError)
  })
  test('효과음을 켰는데 효과음 파일이 없으면 SoundError', async () => {
    const f = fakes()
    await expect(applySound({ ...RENDERED, choice: { bgm: null, sfx: 'on' } }, { ...f.deps, catalog: { ...CATALOG, sfx: [] } })).rejects.toThrow(/효과음/)
  })
  test('곡·효과음 위치·목소리 측정값을 섞기에 넘기고, 곡 파일은 음원 폴더 기준 경로', async () => {
    const f = fakes()
    const r = await applySound({ ...RENDERED, choice: { bgm: 'calm-1', sfx: 'on' } }, f.deps)
    expect(r.path).toBe('/w/mix-1.mp4')
    expect(f.calls.measured).toEqual(['/w/render-1.mp4'])
    expect(f.calls.mix).toMatchObject({
      videoPath: '/w/render-1.mp4', outPath: '/w/mix-1.mp4', durationSec: 9, hasAudio: true, voice: { lufs: -18, peakDb: -2 },
      bgm: { file: '/snd/bgm/calm-1.mp3', lufs: -14 },
    })
    // 제목 pop 0.1초, 경계(출력 5초) whoosh 4.85초
    expect(f.calls.mix!.sfx.map((s) => [s.file, s.atSec])).toEqual([['/snd/sfx/p1.mp3', 0.1], ['/snd/sfx/w1.mp3', 4.85]])
    expect(r.report).toEqual({ bgm: { id: 'calm-1', title: '잔잔한 곡', author: '작가', license: 'Pixabay License', sourceUrl: 'https://pixabay.com/music/x' }, sfxCount: 2 })
  })
  test('속도(speed)를 주면 효과음 위치도 같은 배수로 앞당겨진다 — 4.85초 → 1.25배속에서 3.88초', async () => {
    const f = fakes()
    await applySound({ ...RENDERED, choice: { bgm: null, sfx: 'on' }, speed: 1.25 }, f.deps)
    const at = f.calls.mix!.sfx.map((s) => s.atSec)
    expect(at[0]).toBeCloseTo(0.1 / 1.25, 3) // 제목 pop
    expect(at[1]).toBeCloseTo(4.85 / 1.25, 3) // 컷 whoosh
  })
  test('gains 를 주면 음악·효과음 오프셋을 섞기에 넘기고, 안 주면 넘기지 않는다', async () => {
    const f = fakes()
    await applySound({ ...RENDERED, choice: { bgm: 'calm-1', sfx: 'on' }, gains: { bgmGainDb: 3, sfxGainDb: -2 } }, f.deps)
    expect(f.calls.mix).toMatchObject({ bgmGainDb: 3, sfxGainDb: -2 })
    const g = fakes()
    await applySound({ ...RENDERED, choice: { bgm: 'calm-1', sfx: 'on' } }, g.deps)
    expect(g.calls.mix!.bgmGainDb ?? 0).toBe(0)
    expect(g.calls.mix!.sfxGainDb ?? 0).toBe(0)
  })
  test('음악만 고르면 효과음은 비어 있고 sfxCount 0', async () => {
    const f = fakes()
    const r = await applySound({ ...RENDERED, choice: { bgm: 'calm-1', sfx: 'off' } }, f.deps)
    expect(f.calls.mix!.sfx).toEqual([])
    expect(r.report.sfxCount).toBe(0)
  })
  test('효과음만 켜면 bgm 은 없고 report 에도 bgm 이 없다', async () => {
    const f = fakes()
    const r = await applySound({ ...RENDERED, choice: { bgm: null, sfx: 'on' } }, f.deps)
    expect(f.calls.mix!.bgm).toBeUndefined()
    expect(r.report.bgm).toBeUndefined()
  })
  test('소리 트랙은 있지만 말이 없는 영상(주변 소음만)은 목소리로 재지 않는다 — 음악이 소음 크기에 맞춰져 안 들리는 일이 없게, 소음은 그대로 두고 음악은 절대 크기로', async () => {
    const f = fakes()
    await applySound({ ...RENDERED, hasSpeech: false, choice: { bgm: 'calm-1', sfx: 'on' } }, f.deps)
    expect(f.calls.measured).toEqual([])
    expect(f.calls.mix).toMatchObject({ hasAudio: true, voice: { lufs: null, peakDb: null } })
  })
  test('소리가 없는 영상은 측정하지 않고 hasAudio=false, 목소리 측정값 없음으로 넘긴다', async () => {
    const f = fakes()
    await applySound({ ...RENDERED, hasAudio: false, hasSpeech: false, choice: { bgm: 'calm-1', sfx: 'off' } }, f.deps)
    expect(f.calls.measured).toEqual([])
    expect(f.calls.mix).toMatchObject({ hasAudio: false, voice: { lufs: null, peakDb: null } })
  })
})

describe('checkSoundFlags — CLI 의 --bgm / --sfx 점검', () => {
  const cat = CATALOG
  test('아무것도 안 주면 없음·끄기', () => {
    expect(checkSoundFlags({}, cat)).toEqual({ ok: true, bgm: null, sfx: 'off' })
  })
  test('목록에 있는 곡과 on/off 를 받는다', () => {
    expect(checkSoundFlags({ bgm: 'calm-1', sfx: 'on' }, cat)).toEqual({ ok: true, bgm: 'calm-1', sfx: 'on' })
  })
  test('--bgm none 은 곡 없음', () => {
    expect(checkSoundFlags({ bgm: 'none' }, cat)).toMatchObject({ ok: true, bgm: null })
  })
  test('없는 곡이면 쓸 수 있는 id 목록을 알려 준다', () => {
    const r = checkSoundFlags({ bgm: 'nope' }, cat)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.message).toContain('calm-1')
  })
  test('--sfx 는 on 또는 off 만', () => {
    expect(checkSoundFlags({ sfx: 'loud' }, cat).ok).toBe(false)
  })
  test('효과음 파일이 없는데 --sfx on 이면 거절', () => {
    expect(checkSoundFlags({ sfx: 'on' }, { ...cat, sfx: [] }).ok).toBe(false)
  })
})
