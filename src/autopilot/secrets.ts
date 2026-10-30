import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 업로드용 열쇠(토큰)를 두는 곳. 저장소·자동편집 폴더 밖에 두고 나만 읽을 수 있게 한다 */
export const SECRETS_PATH = path.join(os.homedir(), '.config', 'autoframes', 'upload.json')

export interface YoutubeSecrets {
  clientId: string
  clientSecret: string
  refreshToken: string
  channelTitle?: string
}

export interface InstagramSecrets {
  userId: string
  username?: string
  accessToken: string
  /** 토큰을 받거나 연장한 시각(ISO) — 60일이 지나면 만료되므로 30일마다 연장한다 */
  refreshedAt: string
}

export interface UploadSecrets {
  youtube?: YoutubeSecrets
  instagram?: InstagramSecrets
}

export function loadSecrets(file = SECRETS_PATH): UploadSecrets {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as UploadSecrets
  } catch {
    return {}
  }
}

export function saveSecrets(s: UploadSecrets, file = SECRETS_PATH): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n', { mode: 0o600 })
  fs.chmodSync(file, 0o600)
}
