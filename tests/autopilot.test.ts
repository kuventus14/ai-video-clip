import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { hashtagsOf, instagramCaption, titleFromReport, youtubeTitle } from '../src/autopilot/caption.ts'
import { CONFIG_FILE, ConfigError, ensureFolders, FOLDERS, loadConfig } from '../src/autopilot/config.ts'
import { listVideos, StabilityTracker, uniquePath } from '../src/autopilot/folders.ts'
import { launchdPlist } from '../src/autopilot/launchd.ts'
import { accept, listPending, redo, reject, ReviewError, setDefaultReference } from '../src/autopilot/review.ts'
import { pickReference, processVideo, sweep, type AutopilotDeps } from '../src/autopilot/run.ts'
import type { UploadSecrets } from '../src/autopilot/secrets.ts'
import type { EditOptions, EditResult } from '../src/core/pipeline.ts'

let root: string
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vae-autopilot-'))
  ensureFolders(root)
})

const put = (rel: string, body = 'x') => {
  const p = path.join(root, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, body)
  return p
}
const setConfig = (over: object) => {
  const cfg = loadConfig(root)
  fs.writeFileSync(path.join(root, CONFIG_FILE), JSON.stringify({ ...cfg, ...over }))
}

function fakes(o: { fail?: string; secrets?: UploadSecrets; ytFail?: string } = {}) {
  const calls = { edit: [] as EditOptions[], yt: [] as unknown[], ig: [] as unknown[], saved: [] as UploadSecrets[] }
  const deps: AutopilotDeps = {
    runEdit: async (opts) => {
      calls.edit.push(opts)
      if (o.fail) throw new Error(o.fail)
      const resultPath = path.join(opts.outDir, 'result.mp4')
      fs.writeFileSync(resultPath, 'edited')
      fs.writeFileSync(path.join(opts.outDir, 'report.json'), JSON.stringify({ script: { title: '롱아이언 꿀팁' } }))
      return { resultPath, qa: { passed: true, findings: [] } } as unknown as EditResult
    },
    uploadToYoutube: async (_s, u) => {
      calls.yt.push(u)
      if (o.ytFail) throw new Error(o.ytFail)
      return { id: 'v1', url: 'https://youtube.com/shorts/v1' }
    },
    uploadToInstagram: async (_s, u) => {
      calls.ig.push(u)
      return { id: 'ig1' }
    },
    refreshInstagram: async (s) => ({ ...s, accessToken: 'new' }),
    loadSecrets: () => o.secrets ?? {},
    saveSecrets: (s) => void calls.saved.push(s),
    log: () => {},
  }
  return { deps, calls }
}

describe('설정 파일', () => {
  test('없으면 기본값(세로 릴스, 업로드 꺼짐)으로 만든다', () => {
    const cfg = loadConfig(root)
    expect(cfg.edit.purpose).toBe('short')
    expect(cfg.upload.youtube.enabled).toBe(false)
    expect(cfg.upload.instagram.enabled).toBe(false)
    expect(fs.existsSync(path.join(root, CONFIG_FILE))).toBe(true)
  })

  test('일부만 적어도 나머지는 기본값으로 채운다', () => {
    fs.writeFileSync(path.join(root, CONFIG_FILE), JSON.stringify({ upload: { youtube: { enabled: true } } }))
    const cfg = loadConfig(root)
    expect(cfg.upload.youtube.enabled).toBe(true)
    expect(cfg.upload.youtube.privacy).toBe('private')
    expect(cfg.edit.audio).toBe('original')
  })

  test('잘못된 값은 어느 칸인지 알려 준다', () => {
    fs.writeFileSync(path.join(root, CONFIG_FILE), JSON.stringify({ edit: { purpose: 'tiktok' } }))
    expect(() => loadConfig(root)).toThrow(ConfigError)
    expect(() => loadConfig(root)).toThrow(/edit\.purpose/)
  })
})

describe('폴더', () => {
  test('영상 파일만 고르고 숨김 파일은 뺀다', () => {
    put(`${FOLDERS.inbox}/a.MOV`)
    put(`${FOLDERS.inbox}/b.mp4`)
    put(`${FOLDERS.inbox}/.c.mp4`)
    put(`${FOLDERS.inbox}/memo.txt`)
    expect(listVideos(path.join(root, FOLDERS.inbox)).map((f) => path.basename(f))).toEqual(['a.MOV', 'b.mp4'])
  })

  test('복사 중(크기가 바뀌는) 파일은 두 번 연속 같아야 준비됨으로 본다', () => {
    const f = put(`${FOLDERS.inbox}/a.mp4`, 'abc')
    const t = new StabilityTracker(5000)
    const later = Date.now() + 10_000
    expect(t.ready([f], later)).toEqual([])
    expect(t.ready([f], later)).toEqual([f])
    fs.appendFileSync(f, 'more')
    expect(t.ready([f], later)).toEqual([])
    expect(t.ready([f], Date.now())).toEqual([]) // 방금 바뀐 파일은 5초가 지나야 한다
  })

  test('겹치는 이름에는 번호를 붙인다', () => {
    put(`${FOLDERS.done}/a_릴스.mp4`)
    expect(path.basename(uniquePath(path.join(root, FOLDERS.done), 'a_릴스.mp4'))).toBe('a_릴스 (2).mp4')
  })
})

describe('글·제목', () => {
  test('{title} 을 채우고 유튜브 제목은 100자로 자른다', () => {
    expect(youtubeTitle('{title} #shorts', '롱아이언 꿀팁')).toBe('롱아이언 꿀팁 #shorts')
    expect([...youtubeTitle('{title}', '가'.repeat(150))].length).toBe(100)
  })
  test('인스타 해시태그는 30개까지만 남긴다', () => {
    const tags = Array.from({ length: 35 }, (_, i) => `#t${i}`).join(' ')
    expect(hashtagsOf(instagramCaption(`{title} ${tags}`, '제목'))).toHaveLength(30)
  })
  test('제목은 AI 화면 제목 → 첫머리 제목 → 파일 이름 순으로 고른다', () => {
    expect(titleFromReport({ script: { title: 'A' }, summary: { hookTitle: 'B' } }, 'f')).toBe('A')
    expect(titleFromReport({ summary: { hookTitle: 'B' } }, 'f')).toBe('B')
    expect(titleFromReport(undefined, 'f')).toBe('f')
  })
})

describe('영상 하나 처리', () => {
  test('편집 결과는 완성 폴더에(검토 기다림), 원본은 숨김 원본 폴더로 옮기고 설정값으로 편집한다. 업로드는 하지 않는다', async () => {
    setConfig({ upload: { youtube: { enabled: true } } })
    const v = put(`${FOLDERS.inbox}/스윙.mp4`)
    const { deps, calls } = fakes()
    const r = await processVideo(root, v, deps)
    expect(r.ok).toBe(true)
    expect(r.title).toBe('롱아이언 꿀팁')
    expect(fs.readFileSync(path.join(root, FOLDERS.done, '스윙_릴스.mp4'), 'utf8')).toBe('edited')
    expect(fs.existsSync(path.join(root, FOLDERS.originals, '스윙.mp4'))).toBe(true)
    expect(fs.existsSync(v)).toBe(false)
    expect(calls.edit[0]).toMatchObject({ purpose: 'short', audio: 'original', reference: undefined })
    expect(calls.yt).toHaveLength(0) // 업로드는 수락할 때
    expect(listPending(root)).toMatchObject([{ name: '스윙_릴스.mp4', title: '롱아이언 꿀팁', original: path.join(root, FOLDERS.originals, '스윙.mp4') }])
  })

  test('편집이 실패하면 원본은 보관하고 완성 폴더에 이유를 남긴다 — 검토 목록에 실패로 나온다', async () => {
    const v = put(`${FOLDERS.inbox}/스윙.mp4`)
    const r = await processVideo(root, v, fakes({ fail: '음성 인식 모델이 없어요' }).deps)
    expect(r.ok).toBe(false)
    expect(fs.existsSync(path.join(root, FOLDERS.originals, '스윙.mp4'))).toBe(true)
    expect(fs.readFileSync(path.join(root, FOLDERS.done, '스윙_편집실패.txt'), 'utf8')).toContain('음성 인식 모델이 없어요')
    expect(listPending(root)).toMatchObject([{ name: '스윙_편집실패.txt', failed: '음성 인식 모델이 없어요' }])
  })

  test('레퍼런스: 설정의 링크 → 레퍼런스 폴더에서 가장 최근에 들어온 영상 → 기본 레퍼런스 → 없음', async () => {
    expect(pickReference(root, loadConfig(root))).toBeUndefined()
    const def = setDefaultReference(root, put('바탕화면/IMG_3725_릴스 (3).mp4'))
    expect(pickReference(root, loadConfig(root))).toBe(def)
    put(`${FOLDERS.reference}/b-예전.mp4`)
    await new Promise((r) => setTimeout(r, 50))
    // 수정 시각이 오래된 파일이어도(파인더로 복사하면 원래 수정 시각이 남는다) 폴더에 늦게 들어왔으면 최근 것으로 본다
    const src = put('바탕화면/a-최근.mp4')
    fs.utimesSync(src, new Date(Date.now() - 86_400_000), new Date(Date.now() - 86_400_000))
    const recent = path.join(root, FOLDERS.reference, 'a-최근.mp4')
    fs.renameSync(src, recent)
    expect(pickReference(root, loadConfig(root))).toBe(recent)
    setConfig({ edit: { reference: 'https://youtu.be/x' } })
    expect(pickReference(root, loadConfig(root))).toBe('https://youtu.be/x')
  })

  test('기본 레퍼런스를 다시 정하면 예전 것을 바꾼다', () => {
    setDefaultReference(root, put('a.mp4'))
    const d = setDefaultReference(root, put('b.mp4'))
    expect(fs.readdirSync(path.join(root, FOLDERS.defaultReference))).toEqual(['b.mp4'])
    expect(() => setDefaultReference(root, path.join(root, '없음.mp4'))).toThrow(ReviewError)
    expect(d).toBe(path.join(root, FOLDERS.defaultReference, 'b.mp4'))
  })

  test('sweep 은 복사가 끝난 영상만 처리한다', async () => {
    const f = put(`${FOLDERS.inbox}/a.mp4`)
    fs.utimesSync(f, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000))
    const { deps, calls } = fakes()
    const t = new StabilityTracker(0)
    expect(await sweep(root, t, deps)).toBe(0)
    expect(await sweep(root, t, deps)).toBe(1)
    expect(calls.edit).toHaveLength(1)
  })

  test('예전 폴더(넣기·원본)에 있던 영상은 새 폴더로 옮기고 빈 예전 폴더는 지운다', () => {
    put('넣기/새영상.mp4')
    put('원본/옛원본.mov')
    ensureFolders(root)
    expect(fs.existsSync(path.join(root, FOLDERS.inbox, '새영상.mp4'))).toBe(true)
    expect(fs.existsSync(path.join(root, FOLDERS.originals, '옛원본.mov'))).toBe(true)
    expect(fs.existsSync(path.join(root, '넣기'))).toBe(false)
    expect(fs.existsSync(path.join(root, '원본'))).toBe(false)
  })
})

describe('검토: 수락·거절·다시 만들기', () => {
  const edited = async (deps = fakes().deps, name = '스윙.mp4') => (await processVideo(root, put(`${FOLDERS.inbox}/${name}`), deps)).resultPath!

  test('수락하면 수락 폴더로 옮기고 레퍼런스 폴더에 복사해, 다음 편집이 그것을 따라 한다', async () => {
    const res = await edited()
    const { deps, calls } = fakes()
    const r = await accept(root, path.basename(res), deps)
    expect(r.acceptedPath).toBe(path.join(root, FOLDERS.accepted, '스윙_릴스.mp4'))
    expect(fs.readFileSync(r.referencePath, 'utf8')).toBe('edited')
    expect(fs.existsSync(res)).toBe(false)
    expect(listPending(root)).toEqual([])
    expect(calls.yt).toHaveLength(0) // 업로드는 기본으로 꺼져 있다
    await processVideo(root, put(`${FOLDERS.inbox}/다음.mp4`), deps)
    expect(calls.edit[0]!.reference).toBe(r.referencePath)
  })

  test('업로드를 켜 두면 수락할 때 유튜브·인스타에 AI 제목으로 올리고, 오래된 인스타 토큰은 연장해 저장한다', async () => {
    const res = await edited()
    setConfig({ upload: { caption: '{title}\n\n#골프 #골프구조', youtube: { enabled: true }, instagram: { enabled: true } } })
    const secrets: UploadSecrets = { youtube: { clientId: 'c', clientSecret: 's', refreshToken: 'r' }, instagram: { userId: '1', accessToken: 'old', refreshedAt: '2026-01-01T00:00:00Z' } }
    const { deps, calls } = fakes({ secrets })
    const r = await accept(root, res, deps)
    expect(r.upload).toEqual({ youtube: { ok: true, url: 'https://youtube.com/shorts/v1' }, instagram: { ok: true, id: 'ig1' } })
    expect(calls.yt[0]).toMatchObject({ file: r.acceptedPath, title: '롱아이언 꿀팁 #shorts', tags: ['골프', '골프구조'], privacy: 'private' })
    expect(calls.ig[0]).toMatchObject({ caption: '롱아이언 꿀팁\n\n#골프 #골프구조', shareToFeed: true })
    expect(calls.saved[0]?.instagram?.accessToken).toBe('new')
  })

  test('업로드가 실패해도 수락은 되고, 연결하지 않은 계정은 실패로 알려 준다', async () => {
    const res = await edited()
    setConfig({ upload: { youtube: { enabled: true }, instagram: { enabled: true } } })
    const { deps } = fakes({ secrets: { youtube: { clientId: 'c', clientSecret: 's', refreshToken: 'r' } }, ytFail: '할당량 초과' })
    const r = await accept(root, res, deps)
    expect(fs.existsSync(r.acceptedPath)).toBe(true)
    expect(r.upload.youtube).toEqual({ ok: false, error: '할당량 초과' })
    expect(r.upload.instagram).toMatchObject({ ok: false, error: expect.stringContaining('npm run connect -- instagram') })
  })

  test('거절하면 결과를 치우고 원본은 보관한다', async () => {
    const res = await edited()
    reject(root, res)
    expect(fs.existsSync(res)).toBe(false)
    expect(fs.existsSync(path.join(root, FOLDERS.originals, '스윙.mp4'))).toBe(true)
    expect(listVideos(path.join(root, FOLDERS.reference))).toEqual([])
    expect(listPending(root)).toEqual([])
  })

  test('다시 만들기는 원본을 편집할 영상 폴더로 돌려놓고, 고칠 점을 다음 편집 요청에 한 번 덧붙인다', async () => {
    setConfig({ edit: { request: '자막 크게' } })
    const res = await edited()
    const back = redo(root, path.basename(res), '앞부분 설명을 살려 줘')
    expect(back).toBe(path.join(root, FOLDERS.inbox, '스윙.mp4'))
    expect(fs.existsSync(res)).toBe(false)
    const { deps, calls } = fakes()
    await processVideo(root, back, deps)
    expect(calls.edit[0]!.request).toBe('자막 크게\n앞부분 설명을 살려 줘')
    // 고칠 점은 한 번만 쓴다
    const again = redo(root, '스윙_릴스.mp4')
    await processVideo(root, again, deps)
    expect(calls.edit[1]!.request).toBe('자막 크게')
  })

  test('편집에 실패한 항목은 다시 만들 수 있지만 수락은 안 된다', async () => {
    await processVideo(root, put(`${FOLDERS.inbox}/스윙.mp4`), fakes({ fail: '오류' }).deps)
    await expect(accept(root, '스윙_편집실패.txt', fakes().deps)).rejects.toThrow(ReviewError)
    expect(redo(root, '스윙_편집실패.txt')).toBe(path.join(root, FOLDERS.inbox, '스윙.mp4'))
    expect(fs.existsSync(path.join(root, FOLDERS.done, '스윙_편집실패.txt'))).toBe(false)
  })

  test('없는 이름은 알아듣기 쉬운 오류로 알려 준다', () => {
    expect(() => reject(root, '없는영상_릴스.mp4')).toThrow(/찾지 못했어요/)
  })
})

test('launchd 설정은 로그인 때 켜지고, 꺼지면 다시 켜지며, PATH 를 넘긴다', () => {
  const xml = launchdPlist({ node: '/opt/homebrew/bin/node', repo: '/r', root: '/u/릴스 자동편집', path: '/opt/homebrew/bin:/usr/bin', home: '/u' })
  expect(xml).toContain('<string>/r/src/cli/autopilot.ts</string>')
  expect(xml).toContain('<string>/u/릴스 자동편집</string>')
  expect(xml).toContain('<key>KeepAlive</key><true/>')
  expect(xml).toContain('/opt/homebrew/bin:/usr/bin')
})
