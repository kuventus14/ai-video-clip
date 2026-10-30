import fs from 'node:fs'
import type { YoutubeSecrets } from './secrets.ts'

export type Fetch = typeof fetch

export class UploadError extends Error {
  override name = 'UploadError'
}

export const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

async function failText(res: Response): Promise<string> {
  const body = await res.text().catch(() => '')
  return `${res.status} ${body.slice(0, 500)}`
}

/** 구글 로그인 화면 주소(한 번만 쓴다) */
export function youtubeAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: YOUTUBE_SCOPE, access_type: 'offline', prompt: 'consent', state })
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`
}

/** 로그인 뒤 받은 code 를 오래 쓰는 refresh token 으로 바꾼다 */
export async function exchangeYoutubeCode(o: { clientId: string; clientSecret: string; code: string; redirectUri: string }, f: Fetch = fetch): Promise<string> {
  const res = await f(TOKEN_URL, { method: 'POST', body: new URLSearchParams({ client_id: o.clientId, client_secret: o.clientSecret, code: o.code, redirect_uri: o.redirectUri, grant_type: 'authorization_code' }) })
  if (!res.ok) throw new UploadError(`유튜브 로그인을 마치지 못했어요: ${await failText(res)}`)
  const j = (await res.json()) as { refresh_token?: string }
  if (!j.refresh_token) throw new UploadError('유튜브가 갱신 토큰을 주지 않았어요. 구글 계정 설정에서 이 앱의 권한을 지운 뒤 다시 연결해 주세요.')
  return j.refresh_token
}

export async function youtubeAccessToken(s: YoutubeSecrets, f: Fetch = fetch): Promise<string> {
  const res = await f(TOKEN_URL, { method: 'POST', body: new URLSearchParams({ client_id: s.clientId, client_secret: s.clientSecret, refresh_token: s.refreshToken, grant_type: 'refresh_token' }) })
  if (!res.ok) throw new UploadError(`유튜브 로그인이 풀렸어요(npm run connect -- youtube 로 다시 연결): ${await failText(res)}`)
  return ((await res.json()) as { access_token: string }).access_token
}

/** 연결된 채널 이름 */
export async function youtubeChannelTitle(accessToken: string, f: Fetch = fetch): Promise<string | undefined> {
  const res = await f('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!res.ok) return undefined
  const j = (await res.json()) as { items?: { snippet?: { title?: string } }[] }
  return j.items?.[0]?.snippet?.title
}

export interface YoutubeUpload {
  file: string
  title: string
  description: string
  tags: string[]
  privacy: 'private' | 'unlisted' | 'public'
}

/** 영상을 올리고 영상 id 를 돌려준다. 세로·3분 이하 영상은 유튜브가 알아서 숏츠로 분류한다 */
export async function uploadToYoutube(s: YoutubeSecrets, u: YoutubeUpload, f: Fetch = fetch): Promise<{ id: string; url: string }> {
  const token = await youtubeAccessToken(s, f)
  const size = fs.statSync(u.file).size
  const meta = {
    snippet: { title: u.title, description: u.description, tags: u.tags.slice(0, 30), categoryId: '17' }, // 17 = 스포츠
    status: { privacyStatus: u.privacy, selfDeclaredMadeForKids: false },
  }
  const start = await f('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'video/mp4', 'X-Upload-Content-Length': String(size) },
    body: JSON.stringify(meta),
  })
  const location = start.headers.get('location')
  if (!start.ok || !location) throw new UploadError(`유튜브 업로드를 시작하지 못했어요: ${await failText(start)}`)
  const put = await f(location, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size) }, body: fs.readFileSync(u.file) })
  if (!put.ok) throw new UploadError(`유튜브에 영상을 보내지 못했어요: ${await failText(put)}`)
  const id = ((await put.json()) as { id: string }).id
  return { id, url: `https://youtube.com/shorts/${id}` }
}
