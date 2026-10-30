import fs from 'node:fs'
import type { InstagramSecrets } from './secrets.ts'
import { UploadError, type Fetch } from './youtube.ts'

const API = 'https://graph.instagram.com/v23.0'
const RUPLOAD = 'https://rupload.facebook.com/ig-api-upload/v23.0'
const DAY = 24 * 3600 * 1000
/** 토큰은 60일이면 만료된다. 30일이 지나면 연장한다(받은 지 하루가 안 된 토큰은 연장할 수 없다) */
export const REFRESH_AFTER_MS = 30 * DAY

async function failText(res: Response): Promise<string> {
  const body = await res.text().catch(() => '')
  return `${res.status} ${body.slice(0, 500)}`
}

/** 토큰으로 계정 id·이름을 확인한다(연결할 때 한 번) */
export async function instagramWhoAmI(accessToken: string, f: Fetch = fetch): Promise<{ userId: string; username?: string }> {
  const res = await f(`${API}/me?${new URLSearchParams({ fields: 'user_id,username', access_token: accessToken })}`)
  if (!res.ok) throw new UploadError(`인스타그램 토큰을 확인하지 못했어요: ${await failText(res)}`)
  const j = (await res.json()) as { user_id?: string; id?: string; username?: string }
  const userId = j.user_id ?? j.id
  if (!userId) throw new UploadError('인스타그램 계정 id 를 받지 못했어요')
  return { userId, username: j.username }
}

/** 오래된 토큰을 연장한다. 연장했으면 새 값을, 아니면 그대로 돌려준다 */
export async function refreshInstagramIfNeeded(s: InstagramSecrets, now = Date.now(), f: Fetch = fetch): Promise<InstagramSecrets> {
  if (now - Date.parse(s.refreshedAt) < REFRESH_AFTER_MS) return s
  const res = await f(`https://graph.instagram.com/refresh_access_token?${new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: s.accessToken })}`)
  if (!res.ok) throw new UploadError(`인스타그램 토큰을 연장하지 못했어요(npm run connect -- instagram 으로 다시 연결): ${await failText(res)}`)
  const j = (await res.json()) as { access_token: string }
  return { ...s, accessToken: j.access_token, refreshedAt: new Date(now).toISOString() }
}

export interface InstagramUpload {
  file: string
  caption: string
  shareToFeed: boolean
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 릴스로 올린다: 그릇(컨테이너) 만들기 → 영상 보내기 → 인스타가 처리를 마칠 때까지 기다리기 → 게시 */
export async function uploadToInstagram(s: InstagramSecrets, u: InstagramUpload, f: Fetch = fetch, o: { pollMs?: number; maxWaitMs?: number } = {}): Promise<{ id: string }> {
  const pollMs = o.pollMs ?? 5000
  const maxWaitMs = o.maxWaitMs ?? 10 * 60 * 1000
  const create = await f(`${API}/${s.userId}/media`, {
    method: 'POST',
    body: new URLSearchParams({ media_type: 'REELS', upload_type: 'resumable', caption: u.caption, share_to_feed: String(u.shareToFeed), access_token: s.accessToken }),
  })
  if (!create.ok) throw new UploadError(`인스타그램 업로드를 시작하지 못했어요: ${await failText(create)}`)
  const containerId = ((await create.json()) as { id: string }).id

  const size = fs.statSync(u.file).size
  const up = await f(`${RUPLOAD}/${containerId}`, { method: 'POST', headers: { Authorization: `OAuth ${s.accessToken}`, offset: '0', file_size: String(size) }, body: fs.readFileSync(u.file) })
  if (!up.ok) throw new UploadError(`인스타그램에 영상을 보내지 못했어요: ${await failText(up)}`)

  for (const t0 = Date.now(); ; ) {
    const st = await f(`${API}/${containerId}?${new URLSearchParams({ fields: 'status_code,status', access_token: s.accessToken })}`)
    if (!st.ok) throw new UploadError(`인스타그램 처리 상태를 확인하지 못했어요: ${await failText(st)}`)
    const j = (await st.json()) as { status_code?: string; status?: string }
    if (j.status_code === 'FINISHED') break
    if (j.status_code === 'ERROR' || j.status_code === 'EXPIRED') throw new UploadError(`인스타그램이 영상을 처리하지 못했어요: ${j.status ?? j.status_code}`)
    if (Date.now() - t0 > maxWaitMs) throw new UploadError('인스타그램 처리가 너무 오래 걸려요(10분 넘음)')
    await sleep(pollMs)
  }

  const pub = await f(`${API}/${s.userId}/media_publish`, { method: 'POST', body: new URLSearchParams({ creation_id: containerId, access_token: s.accessToken }) })
  if (!pub.ok) throw new UploadError(`인스타그램에 게시하지 못했어요: ${await failText(pub)}`)
  return { id: ((await pub.json()) as { id: string }).id }
}
