import fs from 'node:fs'
import path from 'node:path'
import type { EditOptions, EditResult } from '../core/pipeline.ts'
import { hashtagsOf, instagramCaption, titleFromReport, youtubeDescription, youtubeTitle } from './caption.ts'
import { FOLDERS, loadConfig, type AutopilotConfig } from './config.ts'
import { listVideos, moveInto, StabilityTracker, stemOf, uniquePath } from './folders.ts'
import { refreshInstagramIfNeeded, uploadToInstagram } from './instagram.ts'
import { loadSecrets, saveSecrets, type UploadSecrets } from './secrets.ts'
import { uploadToYoutube } from './youtube.ts'

/** 바깥 일(편집·업로드·열쇠 읽고 쓰기)을 하는 함수들. 시험에서 가짜로 바꿔 끼운다 */
export interface AutopilotDeps {
  runEdit: (o: EditOptions) => Promise<EditResult>
  uploadToYoutube: typeof uploadToYoutube
  uploadToInstagram: typeof uploadToInstagram
  refreshInstagram: (s: NonNullable<UploadSecrets['instagram']>) => Promise<NonNullable<UploadSecrets['instagram']>>
  loadSecrets: () => UploadSecrets
  saveSecrets: (s: UploadSecrets) => void
  log: (line: string) => void
}

export function defaultDeps(runEdit: AutopilotDeps['runEdit'], log: AutopilotDeps['log'] = console.log): AutopilotDeps {
  return {
    runEdit,
    uploadToYoutube: (s, u) => uploadToYoutube(s, u),
    uploadToInstagram: (s, u) => uploadToInstagram(s, u),
    refreshInstagram: (s) => refreshInstagramIfNeeded(s),
    loadSecrets: () => loadSecrets(),
    saveSecrets: (s) => saveSecrets(s),
    log,
  }
}

export interface UploadOutcome {
  youtube?: { ok: true; url: string } | { ok: false; error: string }
  instagram?: { ok: true; id: string } | { ok: false; error: string }
}

export interface ProcessOutcome {
  ok: boolean
  /** 완성 폴더에 놓인 결과 영상 */
  resultPath?: string
  title?: string
  upload?: UploadOutcome
  error?: string
}

/** 레퍼런스: 설정의 링크 → 레퍼런스 폴더의 첫 영상 → 없음 */
export function pickReference(root: string, cfg: AutopilotConfig): string | undefined {
  if (cfg.edit.reference.trim()) return cfg.edit.reference.trim()
  return listVideos(path.join(root, FOLDERS.reference))[0]
}

const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19)

/**
 * 영상 하나를 처리한다: 편집 → 완성 폴더에 결과 → 원본은 원본 폴더로 → (켜 두었으면) 유튜브·인스타 업로드.
 * 편집이 실패하면 원본과 오류 설명을 실패 폴더에 둔다. 업로드가 실패해도 편집 결과는 그대로 두고 기록만 남긴다.
 */
export async function processVideo(root: string, video: string, d: AutopilotDeps): Promise<ProcessOutcome> {
  const cfg = loadConfig(root)
  const stem = stemOf(video)
  const workDir = uniquePath(path.join(root, FOLDERS.work), stem)
  fs.mkdirSync(workDir, { recursive: true })
  d.log(`[${now()}] ▶ 편집 시작: ${path.basename(video)}`)

  let result: EditResult
  try {
    result = await d.runEdit({
      videoPath: video,
      outDir: workDir,
      reference: pickReference(root, cfg),
      description: cfg.edit.description || undefined,
      request: cfg.edit.request || undefined,
      purpose: cfg.edit.purpose,
      quality: cfg.edit.quality,
      captions: cfg.edit.captions,
      audio: cfg.edit.audio,
      bgm: cfg.edit.bgm,
      sfx: cfg.edit.sfx,
      onStage: (s, detail) => d.log(`   · ${s}${detail ? ` — ${detail}` : ''}`),
    })
  } catch (e) {
    const error = (e as Error).message || String(e)
    const failedDir = path.join(root, FOLDERS.failed)
    const moved = moveInto(video, failedDir)
    fs.writeFileSync(path.join(failedDir, `${stemOf(moved)}_오류.txt`), `편집하지 못했어요 (${now()})\n\n${error}\n\n고친 뒤 영상을 다시 '${FOLDERS.inbox}' 폴더에 넣으면 다시 편집해요.\n`)
    d.log(`[${now()}] ✖ 편집 실패: ${path.basename(video)} — ${error}`)
    return { ok: false, error }
  }

  const resultPath = uniquePath(path.join(root, FOLDERS.done), `${stem}_릴스.mp4`)
  fs.copyFileSync(result.resultPath, resultPath)
  moveInto(video, path.join(root, FOLDERS.originals))
  let report: unknown
  try {
    report = JSON.parse(fs.readFileSync(path.join(workDir, 'report.json'), 'utf8'))
  } catch {
    report = undefined
  }
  const title = titleFromReport(report, stem)
  const highs = result.qa.findings.filter((f) => f.severity === 'high')
  d.log(`[${now()}] ✔ 편집 완료: ${path.basename(resultPath)} — 제목 "${title}"${highs.length ? ` (검수에서 중요 문제 ${highs.length}건)` : ''}`)

  const upload = await uploadAll(cfg, resultPath, title, d)
  const record = { createdAt: new Date().toISOString(), source: path.basename(video), result: resultPath, title, qaPassed: result.qa.passed, upload }
  fs.writeFileSync(path.join(workDir, 'autopilot.json'), JSON.stringify(record, null, 2))
  const failures = Object.entries(upload).filter(([, v]) => v && !v.ok)
  if (failures.length) {
    fs.writeFileSync(
      resultPath.replace(/\.mp4$/, '_업로드실패.txt'),
      failures.map(([k, v]) => `${k === 'youtube' ? '유튜브' : '인스타그램'}: ${(v as { error: string }).error}`).join('\n\n') + '\n',
    )
  }
  return { ok: true, resultPath, title, upload }
}

async function uploadAll(cfg: AutopilotConfig, file: string, title: string, d: AutopilotDeps): Promise<UploadOutcome> {
  const out: UploadOutcome = {}
  const { youtube, instagram } = cfg.upload
  if (!youtube.enabled && !instagram.enabled) return out
  const secrets = d.loadSecrets()

  if (youtube.enabled) {
    try {
      if (!secrets.youtube) throw new Error('유튜브가 아직 연결되지 않았어요 — npm run connect -- youtube')
      const desc = youtubeDescription(cfg.upload.caption, title)
      const r = await d.uploadToYoutube(secrets.youtube, { file, title: youtubeTitle(youtube.title, title), description: desc, tags: hashtagsOf(desc), privacy: youtube.privacy })
      out.youtube = { ok: true, url: r.url }
      d.log(`   ↑ 유튜브 업로드: ${r.url} (${youtube.privacy})`)
    } catch (e) {
      out.youtube = { ok: false, error: (e as Error).message }
      d.log(`   ✖ 유튜브 업로드 실패: ${(e as Error).message}`)
    }
  }

  if (instagram.enabled) {
    try {
      if (!secrets.instagram) throw new Error('인스타그램이 아직 연결되지 않았어요 — npm run connect -- instagram')
      const ig = await d.refreshInstagram(secrets.instagram)
      if (ig !== secrets.instagram) d.saveSecrets({ ...secrets, instagram: ig })
      const r = await d.uploadToInstagram(ig, { file, caption: instagramCaption(cfg.upload.caption, title), shareToFeed: instagram.shareToFeed })
      out.instagram = { ok: true, id: r.id }
      d.log(`   ↑ 인스타그램 릴스 게시: ${r.id}`)
    } catch (e) {
      out.instagram = { ok: false, error: (e as Error).message }
      d.log(`   ✖ 인스타그램 업로드 실패: ${(e as Error).message}`)
    }
  }
  return out
}

/** 넣기 폴더를 한 번 훑어 복사가 끝난 영상을 하나씩 처리한다. 처리한 개수를 돌려준다 */
export async function sweep(root: string, tracker: StabilityTracker, d: AutopilotDeps): Promise<number> {
  const ready = tracker.ready(listVideos(path.join(root, FOLDERS.inbox)))
  for (const v of ready) await processVideo(root, v, d)
  return ready.length
}

/** 넣기 폴더를 계속 지켜본다. stop() 이 true 를 돌려주면 멈춘다 */
export async function watch(root: string, d: AutopilotDeps, o: { intervalMs?: number; stop?: () => boolean; tracker?: StabilityTracker } = {}): Promise<void> {
  const tracker = o.tracker ?? new StabilityTracker()
  const intervalMs = o.intervalMs ?? 5000
  d.log(`[${now()}] 👀 '${path.join(root, FOLDERS.inbox)}' 폴더를 지켜보고 있어요. 영상을 넣으면 자동으로 편집해요.`)
  let lastError = ''
  while (!o.stop?.()) {
    try {
      await sweep(root, tracker, d)
      lastError = ''
    } catch (e) {
      // 설정 파일이 잘못된 경우처럼 고칠 때까지 계속 나는 오류는 한 번만 적는다
      const msg = (e as Error).message
      if (msg !== lastError) d.log(`[${now()}] ✖ 폴더를 확인하다 오류가 났어요: ${msg}`)
      lastError = msg
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}
