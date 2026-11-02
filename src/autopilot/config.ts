import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'

/** 자동 편집 폴더 기본 위치. 바탕화면은 맥이 백그라운드 프로그램의 접근을 막아서 홈 폴더에 두고, 설치할 때 바탕화면에 바로가기를 만든다 */
export const DEFAULT_ROOT = path.join(os.homedir(), '릴스 자동편집')

/** 폴더 안의 하위 폴더 이름. 사용자가 보는 폴더는 앞의 네 개이고, 점으로 시작하는 폴더는 숨김이다 */
export const FOLDERS = {
  /** 편집할 영상을 넣는 곳 */
  inbox: '편집할 영상',
  /** 따라 할 레퍼런스 영상(수락한 영상도 여기에 쌓인다) */
  reference: '레퍼런스',
  /** 편집이 끝나 검토를 기다리는 영상 */
  done: '완성',
  /** 수락한 영상(나중에 업로드할 영상) */
  accepted: '수락',
  /** 편집한 원본(다시 만들기에 쓴다) */
  originals: '.원본',
  /** 레퍼런스 폴더가 비었을 때 쓰는 기본 레퍼런스 */
  defaultReference: '.기본 레퍼런스',
  work: '.작업',
} as const

/** 예전 폴더 이름 → 지금 이름. 예전 폴더에 있던 영상은 처음 켤 때 옮긴다 */
export const LEGACY_FOLDERS: Record<string, string> = { 넣기: FOLDERS.inbox, 원본: FOLDERS.originals }

export const CONFIG_FILE = '설정.json'

const Config = z.object({
  /** 편집 옵션 — npm run edit 의 옵션과 같다 */
  edit: z
    .object({
      purpose: z.enum(['auto', 'post', 'short']).default('short'),
      quality: z.enum(['draft', 'looks', 'delivery']).default('looks'),
      captions: z.enum(['auto', 'off']).default('auto'),
      audio: z.enum(['original', 'voice']).default('original'),
      bgm: z.string().nullable().default(null),
      sfx: z.enum(['on', 'off']).default('off'),
      /** 영상이 어떤 영상인지 한 줄 설명(모든 영상에 같이 쓴다). 비우면 AI 가 영상마다 판단 */
      description: z.string().default(''),
      /** 레퍼런스에서 참고할 부분 */
      request: z.string().default(''),
      /** 레퍼런스 링크. 비우면 레퍼런스 폴더의 가장 최근 영상 → 기본 레퍼런스 순으로 쓴다 */
      reference: z.string().default(''),
    })
    .prefault({}),
  upload: z
    .object({
      /** 올리는 글. {title} 자리에 AI 가 지은 영상 제목이 들어간다 */
      caption: z.string().default('{title}\n\n#골프 #골프레슨 #골프스윙 #골프구조'),
      youtube: z
        .object({
          enabled: z.boolean().default(false),
          /** private(비공개) | unlisted(일부 공개) | public(공개). 구글 심사 전에는 public 으로 해도 비공개로 올라간다 */
          privacy: z.enum(['private', 'unlisted', 'public']).default('private'),
          /** 유튜브 제목. {title} 자리에 AI 가 지은 영상 제목이 들어간다 */
          title: z.string().default('{title} #shorts'),
        })
        .prefault({}),
      instagram: z
        .object({
          enabled: z.boolean().default(false),
          /** 릴스를 피드(프로필 격자)에도 보이게 */
          shareToFeed: z.boolean().default(true),
        })
        .prefault({}),
    })
    .prefault({}),
})
export type AutopilotConfig = z.infer<typeof Config>

export class ConfigError extends Error {
  override name = 'ConfigError'
}

/** 설정 파일을 읽는다. 없으면 기본값으로 새로 만든다. 빠진 칸은 기본값으로 채운다 */
export function loadConfig(root: string): AutopilotConfig {
  const file = path.join(root, CONFIG_FILE)
  if (!fs.existsSync(file)) {
    const cfg = Config.parse({})
    fs.mkdirSync(root, { recursive: true })
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n')
    return cfg
  }
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    throw new ConfigError(`${CONFIG_FILE} 을(를) 읽을 수 없어요(쉼표·따옴표를 확인해 주세요): ${(e as Error).message}`)
  }
  const r = Config.safeParse(raw)
  if (!r.success) throw new ConfigError(`${CONFIG_FILE} 에 잘못된 값이 있어요: ${r.error.issues.map((i) => `${i.path.join('.')} — ${i.message}`).join(', ')}`)
  return r.data
}

/** 폴더 구조를 만든다(이미 있으면 그대로). 예전 이름의 폴더(넣기·원본)에 영상이 있으면 새 폴더로 옮기고, 비면 지운다 */
export function ensureFolders(root: string): void {
  for (const name of Object.values(FOLDERS)) fs.mkdirSync(path.join(root, name), { recursive: true })
  for (const [old, now] of Object.entries(LEGACY_FOLDERS)) {
    const dir = path.join(root, old)
    if (!fs.existsSync(dir)) continue
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isFile() || e.name.startsWith('.')) continue
      const dest = path.join(root, now, e.name)
      if (!fs.existsSync(dest)) fs.renameSync(path.join(dir, e.name), dest)
    }
    try {
      for (const e of fs.readdirSync(dir)) if (e === '.DS_Store') fs.rmSync(path.join(dir, e))
      fs.rmdirSync(dir)
    } catch {
      // 옮기지 못한 파일이 남아 있으면 폴더를 그대로 둔다
    }
  }
}
