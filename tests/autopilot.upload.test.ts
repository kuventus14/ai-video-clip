import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { refreshInstagramIfNeeded, uploadToInstagram } from '../src/autopilot/instagram.ts'
import { uploadToYoutube, type Fetch } from '../src/autopilot/youtube.ts'

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vae-up-')), 'r.mp4')
fs.writeFileSync(file, 'video-bytes')

type Call = { url: string; init?: RequestInit }
function fakeFetch(responses: ((c: Call) => Response)[]): { f: Fetch; calls: Call[] } {
  const calls: Call[] = []
  const f = (async (url: string | URL, init?: RequestInit) => {
    const c = { url: String(url), init }
    calls.push(c)
    const next = responses.shift()
    if (!next) throw new Error(`예상하지 못한 요청: ${url}`)
    return next(c)
  }) as Fetch
  return { f, calls }
}
const json = (body: unknown, init: ResponseInit = {}) => () => new Response(JSON.stringify(body), { status: 200, ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } })

describe('유튜브 업로드', () => {
  test('토큰 갱신 → 업로드 시작(제목·공개 범위) → 영상 보내기', async () => {
    const { f, calls } = fakeFetch([json({ access_token: 'at' }), json({}, { headers: { location: 'https://upload/session' } }), json({ id: 'vid' })])
    const r = await uploadToYoutube({ clientId: 'c', clientSecret: 's', refreshToken: 'r' }, { file, title: '제목 #shorts', description: 'd', tags: ['골프'], privacy: 'private' }, f)
    expect(r).toEqual({ id: 'vid', url: 'https://youtube.com/shorts/vid' })
    const meta = JSON.parse(String(calls[1]!.init!.body))
    expect(meta).toMatchObject({ snippet: { title: '제목 #shorts', tags: ['골프'] }, status: { privacyStatus: 'private', selfDeclaredMadeForKids: false } })
    expect((calls[1]!.init!.headers as Record<string, string>).Authorization).toBe('Bearer at')
    expect(calls[2]!.url).toBe('https://upload/session')
    expect(calls[2]!.init!.method).toBe('PUT')
  })

  test('로그인이 풀리면 다시 연결하라고 알려 준다', async () => {
    const { f } = fakeFetch([() => new Response('invalid_grant', { status: 400 })])
    await expect(uploadToYoutube({ clientId: 'c', clientSecret: 's', refreshToken: 'r' }, { file, title: 't', description: '', tags: [], privacy: 'private' }, f)).rejects.toThrow(/connect -- youtube/)
  })
})

describe('인스타그램 릴스 업로드', () => {
  const ig = { userId: '17', accessToken: 'tok', refreshedAt: new Date().toISOString() }

  test('그릇 만들기 → 영상 보내기 → 처리 기다리기 → 게시', async () => {
    const { f, calls } = fakeFetch([json({ id: 'c1' }), json({ success: true }), json({ status_code: 'IN_PROGRESS' }), json({ status_code: 'FINISHED' }), json({ id: 'm1' })])
    const r = await uploadToInstagram(ig, { file, caption: '글 #골프', shareToFeed: true }, f, { pollMs: 1 })
    expect(r).toEqual({ id: 'm1' })
    const create = new URLSearchParams(String(calls[0]!.init!.body))
    expect(calls[0]!.url).toBe('https://graph.instagram.com/v23.0/17/media')
    expect(Object.fromEntries(create)).toMatchObject({ media_type: 'REELS', upload_type: 'resumable', caption: '글 #골프', share_to_feed: 'true' })
    expect(calls[1]!.url).toBe('https://rupload.facebook.com/ig-api-upload/v23.0/c1')
    expect(calls[1]!.init!.headers).toMatchObject({ Authorization: 'OAuth tok', offset: '0', file_size: String(fs.statSync(file).size) })
    expect(calls[4]!.url).toBe('https://graph.instagram.com/v23.0/17/media_publish')
    expect(new URLSearchParams(String(calls[4]!.init!.body)).get('creation_id')).toBe('c1')
  })

  test('인스타가 처리에 실패하면 이유를 알려 준다', async () => {
    const { f } = fakeFetch([json({ id: 'c1' }), json({ success: true }), json({ status_code: 'ERROR', status: '비율이 맞지 않아요' })])
    await expect(uploadToInstagram(ig, { file, caption: '', shareToFeed: true }, f, { pollMs: 1 })).rejects.toThrow(/비율이 맞지 않아요/)
  })

  test('토큰은 30일이 지나면 연장하고, 그 전에는 그대로 쓴다', async () => {
    const now = Date.parse('2026-10-30T00:00:00Z')
    const fresh = { ...ig, refreshedAt: '2026-10-20T00:00:00Z' }
    expect(await refreshInstagramIfNeeded(fresh, now, fakeFetch([]).f)).toBe(fresh)
    const { f, calls } = fakeFetch([json({ access_token: 'new', expires_in: 5184000 })])
    const r = await refreshInstagramIfNeeded({ ...ig, refreshedAt: '2026-09-01T00:00:00Z' }, now, f)
    expect(r.accessToken).toBe('new')
    expect(r.refreshedAt).toBe('2026-10-30T00:00:00.000Z')
    expect(calls[0]!.url).toContain('graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token')
  })
})
