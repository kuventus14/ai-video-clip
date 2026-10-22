import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { GET as previewGet } from '../app/api/sound/[id]/route.ts'
import { GET as listGet } from '../app/api/sound/route.ts'
import type { SoundListDto } from '../src/shared/types.ts'
import { contentTypeOf } from '../src/web/media.ts'

const HOST = 'localhost:4848'
const saved = process.env.VAE_SOUND_DIR
let dir: string

const common = { author: '작가', sourceUrl: 'https://pixabay.com/x', license: 'Pixabay License', durationSec: 125, peakDb: -2 }
const TRACKS = [
  { kind: 'bgm', id: 'calm-1', file: 'bgm/calm-1.mp3', title: '잔잔한 곡', lufs: -14, mood: 'calm', ...common },
  { kind: 'bgm', id: 'bright-1', file: 'bgm/bright-1.mp3', title: '밝은 곡', lufs: -13, mood: 'bright', ...common },
  { kind: 'sfx', id: 'whoosh-1', file: 'sfx/whoosh-1.mp3', title: '휙', lufs: null, role: 'whoosh', ...common },
]

function writeCatalog(tracks: Record<string, unknown>[] = TRACKS) {
  for (const t of tracks) {
    const f = path.join(dir, String(t.file))
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, Buffer.from('0123456789abcdef')) // 16바이트
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version: 1, tracks }))
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vae-api-sound-'))
  process.env.VAE_SOUND_DIR = dir
})
afterEach(() => {
  if (saved === undefined) delete process.env.VAE_SOUND_DIR
  else process.env.VAE_SOUND_DIR = saved
  fs.rmSync(dir, { recursive: true, force: true })
})

const get = (p: string, headers: Record<string, string> = {}, host = HOST) => new Request(`http://${host}${p}`, { headers: { host, ...headers } })
const idParams = (id: string) => ({ params: Promise.resolve({ id }) })

describe('GET /api/sound — 음원 목록', () => {
  test('배경음악은 곡마다, 효과음은 개수만 돌려준다(파일 경로·출처 주소는 내보내지 않는다)', async () => {
    writeCatalog()
    const res = await listGet(get('/api/sound'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as SoundListDto
    expect(body.sfxCount).toBe(1)
    expect(body.bgm).toEqual([
      { id: 'calm-1', title: '잔잔한 곡', author: '작가', mood: 'calm', durationSec: 125, license: 'Pixabay License' },
      { id: 'bright-1', title: '밝은 곡', author: '작가', mood: 'bright', durationSec: 125, license: 'Pixabay License' },
    ])
    expect(JSON.stringify(body)).not.toContain('manifest')
    expect(JSON.stringify(body)).not.toContain(dir)
  })
  test('음원이 하나도 없으면 빈 목록', async () => {
    expect(await (await listGet(get('/api/sound'))).json()).toEqual({ bgm: [], sfxCount: 0 })
  })
  test('목록이 깨졌으면 500 과 한국어 안내', async () => {
    fs.writeFileSync(path.join(dir, 'manifest.json'), '{ broken')
    const res = await listGet(get('/api/sound'))
    expect(res.status).toBe(500)
    expect(((await res.json()) as { error: string }).error).toContain('manifest.json')
  })
  test('이 컴퓨터가 아닌 호스트에서는 403', async () => {
    expect((await listGet(get('/api/sound', {}, 'evil.example.com'))).status).toBe(403)
  })
})

describe('GET /api/sound/<id> — 미리듣기', () => {
  test('음원 파일을 audio/mpeg 로 스트리밍한다', async () => {
    writeCatalog()
    const res = await previewGet(get('/api/sound/calm-1'), idParams('calm-1'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('audio/mpeg')
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('0123456789abcdef')
  })
  test('Range 요청은 206 으로 그 구간만', async () => {
    writeCatalog()
    const res = await previewGet(get('/api/sound/calm-1', { range: 'bytes=0-9' }), idParams('calm-1'))
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 0-9/16')
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('0123456789')
  })
  test('효과음 id 도 들어 볼 수 있다', async () => {
    writeCatalog()
    expect((await previewGet(get('/api/sound/whoosh-1'), idParams('whoosh-1'))).status).toBe(200)
  })
  test('목록에 없는 id 와 경로를 흉내 낸 id 는 404', async () => {
    writeCatalog()
    for (const id of ['nope', '../manifest.json', '..%2Fmanifest.json', 'bgm/calm-1.mp3']) {
      expect((await previewGet(get(`/api/sound/${id}`), idParams(id))).status).toBe(404)
    }
  })
  test('목록이 깨졌으면 500', async () => {
    fs.writeFileSync(path.join(dir, 'manifest.json'), '{ broken')
    expect((await previewGet(get('/api/sound/x'), idParams('x'))).status).toBe(500)
  })
  test('이 컴퓨터가 아닌 호스트에서는 403', async () => {
    writeCatalog()
    expect((await previewGet(get('/api/sound/calm-1', {}, 'evil.example.com'), idParams('calm-1'))).status).toBe(403)
  })
})

describe('contentTypeOf — 오디오 형식', () => {
  test.each([
    ['a.mp3', 'audio/mpeg'],
    ['a.m4a', 'audio/mp4'],
    ['a.wav', 'audio/wav'],
    ['a.ogg', 'audio/ogg'],
    ['A.MP3', 'audio/mpeg'],
  ])('%s → %s', (file, type) => expect(contentTypeOf(file)).toBe(type))
})
