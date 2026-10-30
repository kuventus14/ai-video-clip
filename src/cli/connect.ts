import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import { parseArgs } from 'node:util'
import { instagramWhoAmI } from '../autopilot/instagram.ts'
import { loadSecrets, saveSecrets, SECRETS_PATH } from '../autopilot/secrets.ts'
import { exchangeYoutubeCode, youtubeAccessToken, youtubeAuthUrl, youtubeChannelTitle } from '../autopilot/youtube.ts'

const USAGE = `업로드할 계정 연결 (자세한 준비 방법: docs/autopilot.md)
  npm run connect -- youtube --client <client_secret.json 경로>
  npm run connect -- instagram --token <인스타그램 액세스 토큰>
  npm run connect -- status
열쇠는 ${SECRETS_PATH} 에 나만 읽을 수 있게 저장돼요.
`

function fail(msg: string): never {
  console.error(`✖ ${msg}`)
  process.exit(1)
}

/** 구글 클라우드에서 받은 '데스크톱 앱' OAuth 클라이언트 파일 */
function readClientFile(file: string): { clientId: string; clientSecret: string } {
  if (!fs.existsSync(file)) fail(`파일을 찾을 수 없어요: ${file}`)
  const j = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, { client_id?: string; client_secret?: string }>
  const c = j.installed ?? j.web
  if (!c?.client_id || !c.client_secret) fail('client_secret.json 에서 client_id·client_secret 을 찾지 못했어요. "데스크톱 앱" 유형으로 만든 파일인지 확인해 주세요.')
  return { clientId: c.client_id, clientSecret: c.client_secret }
}

/** 브라우저로 구글 로그인 → 내 컴퓨터(127.0.0.1)로 돌아온 code 를 받는다 */
function waitForCode(authUrlFor: (redirect: string, state: string) => string): Promise<{ code: string; redirect: string }> {
  const state = crypto.randomBytes(16).toString('hex')
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const code = url.searchParams.get('code')
      if (url.searchParams.get('state') !== state || !code) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`연결하지 못했어요: ${url.searchParams.get('error') ?? '잘못된 응답'}`)
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<h2>유튜브 연결 완료! 이 창은 닫아도 돼요.</h2>')
      server.close()
      resolve({ code, redirect })
    })
    let redirect = ''
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      redirect = `http://127.0.0.1:${port}`
      const url = authUrlFor(redirect, state)
      console.log(`브라우저에서 구글 로그인 창을 열어요. 열리지 않으면 아래 주소를 직접 열어 주세요:\n${url}\n`)
      const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
      execFile(opener, [url], () => {})
    })
  })
}

async function connectYoutube(clientFile: string | undefined) {
  if (!clientFile) fail('--client <client_secret.json 경로> 가 필요해요')
  const { clientId, clientSecret } = readClientFile(clientFile)
  const { code, redirect } = await waitForCode((r, s) => youtubeAuthUrl(clientId, r, s))
  const refreshToken = await exchangeYoutubeCode({ clientId, clientSecret, code, redirectUri: redirect })
  const yt = { clientId, clientSecret, refreshToken }
  const channelTitle = await youtubeChannelTitle(await youtubeAccessToken(yt))
  saveSecrets({ ...loadSecrets(), youtube: { ...yt, channelTitle } })
  console.log(`✔ 유튜브 연결 완료${channelTitle ? `: ${channelTitle}` : ''}`)
  console.log('  설정.json 의 upload.youtube.enabled 를 true 로 바꾸면 편집이 끝난 영상을 바로 올려요.')
}

async function connectInstagram(token: string | undefined) {
  if (!token) fail('--token <인스타그램 액세스 토큰> 이 필요해요 (docs/autopilot.md 의 인스타그램 준비 참고)')
  const me = await instagramWhoAmI(token)
  saveSecrets({ ...loadSecrets(), instagram: { userId: me.userId, username: me.username, accessToken: token, refreshedAt: new Date().toISOString() } })
  console.log(`✔ 인스타그램 연결 완료${me.username ? `: @${me.username}` : ''}`)
  console.log('  설정.json 의 upload.instagram.enabled 를 true 로 바꾸면 편집이 끝난 영상을 바로 올려요.')
}

function status() {
  const s = loadSecrets()
  console.log(`유튜브: ${s.youtube ? `연결됨${s.youtube.channelTitle ? ` (${s.youtube.channelTitle})` : ''}` : '연결 안 됨'}`)
  console.log(`인스타그램: ${s.instagram ? `연결됨${s.instagram.username ? ` (@${s.instagram.username})` : ''}, 토큰 갱신 ${s.instagram.refreshedAt.slice(0, 10)}` : '연결 안 됨'}`)
}

async function main() {
  const { values: v, positionals } = parseArgs({ allowPositionals: true, options: { client: { type: 'string' }, token: { type: 'string' }, help: { type: 'boolean', short: 'h' } } })
  const which = positionals[0]
  if (which === 'youtube') return connectYoutube(v.client)
  if (which === 'instagram') return connectInstagram(v.token)
  if (which === 'status') return status()
  console.log(USAGE)
}

main().catch((e: unknown) => fail((e as Error).message ?? String(e)))
