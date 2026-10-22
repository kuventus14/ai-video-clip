import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { run } from '../src/core/exec.ts'
import { buildManifest, writeManifest } from '../src/core/soundManifest.ts'
import { loadCatalog, SoundError } from '../src/shared/sound.ts'

let dir: string
const ff = (args: string[]) => run('ffmpeg', ['-v', 'error', '-nostdin', '-y', ...args])
const common = { author: '작가', sourceUrl: 'https://mixkit.co/free-stock-music/x-1/', license: 'Mixkit Free License' }
const BGM = { kind: 'bgm', id: 'calm-a', file: 'bgm/calm-a.wav', title: '잔잔한 곡', mood: 'calm', ...common }
const SFX = { kind: 'sfx', id: 'whoosh-a', file: 'sfx/whoosh-a.wav', title: '휙', role: 'whoosh', ...common }

const writeSources = (tracks: unknown[]) => fs.writeFileSync(path.join(dir, 'sources.json'), JSON.stringify({ version: 1, tracks }))

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vae-sound-manifest-'))
  fs.mkdirSync(path.join(dir, 'bgm'))
  fs.mkdirSync(path.join(dir, 'sfx'))
  await ff(['-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.3:duration=2:sample_rate=48000', '-ac', '2', path.join(dir, 'bgm/calm-a.wav')])
  await ff(['-f', 'lavfi', '-i', 'sine=frequency=800:duration=0.3', '-ac', '2', '-ar', '48000', path.join(dir, 'sfx/whoosh-a.wav')])
  await ff(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '1', path.join(dir, 'bgm/mute.wav')])
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('buildManifest — sources.json 에 길이·음량·최대치를 재어 붙인다', () => {
  test('곡마다 durationSec·lufs·peakDb 를 재서 채운다. 아주 짧은 효과음은 lufs 가 null', async () => {
    writeSources([BGM, SFX])
    const { manifest } = await buildManifest(dir)
    const [bgm, sfx] = manifest.tracks
    expect(bgm).toMatchObject({ kind: 'bgm', id: 'calm-a', mood: 'calm', title: '잔잔한 곡' })
    expect(bgm!.durationSec).toBeGreaterThan(1.9)
    expect(bgm!.durationSec).toBeLessThan(2.1)
    expect(bgm!.lufs).toBeLessThan(0)
    expect(bgm!.peakDb).toBeLessThan(0)
    expect(sfx).toMatchObject({ kind: 'sfx', role: 'whoosh', lufs: null })
    expect(sfx!.peakDb).toBeLessThan(0)
  })

  test('writeManifest 가 manifest.json·CREDITS.md 를 쓰고, loadCatalog 가 그대로 읽는다', async () => {
    writeSources([BGM, SFX])
    await writeManifest(dir)
    const c = loadCatalog(dir)
    expect(c.bgm.map((t) => t.id)).toEqual(['calm-a'])
    expect(c.sfx.map((t) => t.id)).toEqual(['whoosh-a'])
    const credits = fs.readFileSync(path.join(dir, 'CREDITS.md'), 'utf8')
    for (const s of ['calm-a', 'whoosh-a', '잔잔한 곡', '작가', 'Mixkit Free License', 'https://mixkit.co/free-stock-music/x-1/']) expect(credits).toContain(s)
  })

  test('같은 입력으로 두 번 만들면 manifest.json 이 같다', async () => {
    writeSources([BGM, SFX])
    await writeManifest(dir)
    const first = fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')
    await writeManifest(dir)
    expect(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).toBe(first)
  })

  test('sources.json 이 없으면 SoundError(만드는 법을 알려 준다)', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'vae-sound-empty-'))
    await expect(buildManifest(empty)).rejects.toThrow(SoundError)
    await expect(buildManifest(empty)).rejects.toThrow(/sources\.json/)
    fs.rmSync(empty, { recursive: true, force: true })
  })

  test('파일이 없으면 그 id 를 말하며 SoundError', async () => {
    writeSources([{ ...BGM, id: 'calm-gone', file: 'bgm/gone.wav' }])
    await expect(buildManifest(dir)).rejects.toThrow(/calm-gone/)
  })

  test('허용하지 않는 라이선스는 SoundError', async () => {
    writeSources([{ ...BGM, license: 'CC BY 4.0' }])
    await expect(buildManifest(dir)).rejects.toThrow(SoundError)
  })

  test('배경음악이 무음이라 음량을 잴 수 없으면 그 id 를 말하며 SoundError', async () => {
    writeSources([{ ...BGM, id: 'calm-mute', file: 'bgm/mute.wav' }])
    await expect(buildManifest(dir)).rejects.toThrow(/calm-mute/)
  })

  test('id 가 겹치면 SoundError', async () => {
    writeSources([BGM, { ...BGM, file: 'bgm/calm-a.wav' }])
    await expect(buildManifest(dir)).rejects.toThrow(/calm-a/)
  })
})
