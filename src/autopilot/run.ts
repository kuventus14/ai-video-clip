import fs from 'node:fs'
import path from 'node:path'
import type { EditOptions, EditResult } from '../core/pipeline.ts'
import { hashtagsOf, instagramCaption, titleFromReport, youtubeDescription, youtubeTitle } from './caption.ts'
import { FOLDERS, loadConfig, type AutopilotConfig } from './config.ts'
import { listVideos, moveInto, StabilityTracker, stemOf, uniquePath } from './folders.ts'
import { failureNotePath, takeRedoNote, writeRecord } from './records.ts'
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
  error?: string
}

/** 파일이 폴더에 들어온 시각(복사·이동하면 바뀌는 ctime 과 수정 시각 중 늦은 쪽) */
function arrivedAt(file: string): number {
  const st = fs.statSync(file)
  return Math.max(st.mtimeMs, st.ctimeMs)
}

/** 저장소에 같이 들어 있는 기본 레퍼런스(사용자가 기본 레퍼런스를 따로 정하지 않았을 때) */
export const BUNDLED_REFERENCE_DIR = path.resolve(import.meta.dirname, '..', '..', 'assets', 'default-reference')

/**
 * 레퍼런스: 설정의 링크 → 레퍼런스 폴더에서 가장 최근에 들어온 영상 → 내가 정한 기본 레퍼런스 → 저장소의 기본 레퍼런스
 * → 없음(앱 기본 스타일)
 */
export function pickReference(root: string, cfg: AutopilotConfig, bundledDir = BUNDLED_REFERENCE_DIR): string | undefined {
  if (cfg.edit.reference.trim()) return cfg.edit.reference.trim()
  const refs = listVideos(path.join(root, FOLDERS.reference))
  if (refs.length) return refs.map((f) => ({ f, t: arrivedAt(f) })).sort((a, b) => b.t - a.t || a.f.localeCompare(b.f))[0]!.f
  return listVideos(path.join(root, FOLDERS.defaultReference))[0] ?? listVideos(bundledDir)[0]
}

const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19)

/**
 * 영상 하나를 처리한다: 편집 → 완성 폴더에 결과(검토 기다림) → 원본은 숨김 원본 폴더로.
 * 업로드는 여기서 하지 않고, 사용자가 수락할 때 한다(review.ts).
 * 편집이 실패하면 원본은 원본 폴더에 두고 완성 폴더에 이유(_편집실패.txt)를 남긴다 — '다시 만들기'로 다시 시도할 수 있다.
 */
export async function processVideo(root: string, video: string, d: AutopilotDeps): Promise<ProcessOutcome> {
  const cfg = loadConfig(root)
  const stem = stemOf(video)
  const workDir = uniquePath(path.join(root, FOLDERS.work), stem)
  fs.mkdirSync(workDir, { recursive: true })
  const reference = pickReference(root, cfg)
  // 다시 만들기 때 사용자가 적은 고칠 점은 이번 편집 요청에 덧붙인다
  const note = takeRedoNote(root, path.basename(video))
  const request = [cfg.edit.request, note].filter((x) => x && x.trim()).join('\n') || undefined
  d.log(`[${now()}] ▶ 편집 시작: ${path.basename(video)}${reference ? ` (레퍼런스: ${path.basename(reference)})` : ''}${note ? ` (고칠 점: ${note})` : ''}`)

  let result: EditResult
  try {
    result = await d.runEdit({
      videoPath: video,
      outDir: workDir,
      reference,
      description: cfg.edit.description || undefined,
      request,
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
    const original = moveInto(video, path.join(root, FOLDERS.originals))
    const notePath = failureNotePath(root, stem)
    fs.writeFileSync(notePath, `편집하지 못했어요 (${now()})\n\n${error}\n\n원본은 보관해 두었어요. Claude Code 에서 "검토해 줘"라고 하거나 'npm run autopilot -- redo "${path.basename(notePath)}"' 로 다시 만들 수 있어요.\n`)
    writeRecord(root, path.basename(notePath), { original, createdAt: new Date().toISOString(), failed: error })
    d.log(`[${now()}] ✖ 편집 실패: ${path.basename(video)} — ${error}`)
    return { ok: false, error }
  }

  const resultPath = uniquePath(path.join(root, FOLDERS.done), `${stem}_릴스.mp4`)
  fs.copyFileSync(result.resultPath, resultPath)
  const original = moveInto(video, path.join(root, FOLDERS.originals))
  let report: unknown
  try {
    report = JSON.parse(fs.readFileSync(path.join(workDir, 'report.json'), 'utf8'))
  } catch {
    report = undefined
  }
  const title = titleFromReport(report, stem)
  const highs = result.qa.findings.filter((f) => f.severity === 'high')
  writeRecord(root, path.basename(resultPath), {
    original,
    createdAt: new Date().toISOString(),
    title,
    reference: reference ? path.basename(reference) : undefined,
    request,
    qaPassed: result.qa.passed,
    qaHigh: highs.map((f) => f.message),
  })
  d.log(`[${now()}] ✔ 편집 완료: ${path.basename(resultPath)} — 제목 "${title}"${highs.length ? ` (검수에서 중요 문제 ${highs.length}건)` : ''} — 검토를 기다려요`)
  return { ok: true, resultPath, title }
}

/** 켜 둔 곳(유튜브·인스타)에 올린다. 실패해도 던지지 않고 결과에 적는다 */
export async function uploadAll(cfg: AutopilotConfig, file: string, title: string, d: AutopilotDeps): Promise<UploadOutcome> {
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

/** 편집할 영상 폴더를 한 번 훑어 복사가 끝난 영상을 하나씩 처리한다. 처리한 개수를 돌려준다 */
export async function sweep(root: string, tracker: StabilityTracker, d: AutopilotDeps): Promise<number> {
  const ready = tracker.ready(listVideos(path.join(root, FOLDERS.inbox)))
  for (const v of ready) await processVideo(root, v, d)
  return ready.length
}

/** 편집할 영상 폴더를 계속 지켜본다. stop() 이 true 를 돌려주면 멈춘다 */
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
