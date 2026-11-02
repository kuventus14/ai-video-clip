import fs from 'node:fs'
import path from 'node:path'
import { FOLDERS, loadConfig } from './config.ts'
import { isVideo, moveInto, uniquePath } from './folders.ts'
import { readRecord, removeRecord, saveRedoNote, type ResultRecord } from './records.ts'
import { uploadAll, type AutopilotDeps, type UploadOutcome } from './run.ts'

/** 검토를 기다리는 결과 하나 */
export interface Pending extends ResultRecord {
  /** 완성 폴더의 파일 이름(영상 또는 _편집실패.txt) */
  name: string
  path: string
}

export class ReviewError extends Error {
  override name = 'ReviewError'
}

/** 완성 폴더에서 검토를 기다리는 결과(영상·편집 실패), 오래된 것부터 */
export function listPending(root: string): Pending[] {
  const dir = path.join(root, FOLDERS.done)
  if (!fs.existsSync(dir)) return []
  const out: Pending[] = []
  for (const name of fs.readdirSync(dir)) {
    if (!isVideo(name) && !name.endsWith('_편집실패.txt')) continue
    const rec = readRecord(root, name)
    if (!rec) continue
    out.push({ ...rec, name, path: path.join(dir, name) })
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name))
}

/** 이름이나 경로로 완성 폴더의 결과를 찾는다 */
function find(root: string, nameOrPath: string): Pending {
  const name = path.basename(nameOrPath.trim())
  const hit = listPending(root).find((p) => p.name === name)
  if (!hit) throw new ReviewError(`'${FOLDERS.done}' 폴더에서 검토를 기다리는 '${name}' 을(를) 찾지 못했어요`)
  return hit
}

/** 거절·다시 만들기로 치운 결과를 두는 곳(숨김). 바로 지우지 않아 실수로 골라도 되찾을 수 있다 */
const discardDir = (root: string) => path.join(root, FOLDERS.work, '치운 결과')

export interface AcceptOutcome {
  acceptedPath: string
  referencePath: string
  upload: UploadOutcome
}

/** 수락: 수락 폴더로 옮기고 레퍼런스 폴더에 복사한다(다음 편집부터 가장 최근 레퍼런스가 된다). 업로드를 켜 두었으면 올린다 */
export async function accept(root: string, nameOrPath: string, d: AutopilotDeps): Promise<AcceptOutcome> {
  const p = find(root, nameOrPath)
  if (p.failed) throw new ReviewError('편집에 실패한 항목이라 수락할 수 없어요. 다시 만들기나 거절을 골라 주세요')
  const acceptedPath = moveInto(p.path, path.join(root, FOLDERS.accepted))
  const referencePath = uniquePath(path.join(root, FOLDERS.reference), path.basename(acceptedPath))
  fs.copyFileSync(acceptedPath, referencePath)
  removeRecord(root, p.name)
  const upload = await uploadAll(loadConfig(root), acceptedPath, p.title ?? path.basename(acceptedPath, '.mp4'), d)
  return { acceptedPath, referencePath, upload }
}

/** 거절: 결과를 치운다. 원본은 보관한 채로 둔다 */
export function reject(root: string, nameOrPath: string): void {
  const p = find(root, nameOrPath)
  moveInto(p.path, discardDir(root))
  removeRecord(root, p.name)
}

/** 다시 만들기: 결과를 치우고 원본을 편집할 영상 폴더로 돌려놓는다. 고칠 점을 적으면 다음 편집 요청에 덧붙는다 */
export function redo(root: string, nameOrPath: string, note?: string): string {
  const p = find(root, nameOrPath)
  if (!fs.existsSync(p.original)) throw new ReviewError(`원본(${path.basename(p.original)})을 찾지 못해서 다시 만들 수 없어요`)
  const back = moveInto(p.original, path.join(root, FOLDERS.inbox))
  if (note?.trim()) saveRedoNote(root, path.basename(back), note)
  moveInto(p.path, discardDir(root))
  removeRecord(root, p.name)
  return back
}

/** 기본 레퍼런스를 바꾼다(레퍼런스 폴더가 비었을 때 쓴다) */
export function setDefaultReference(root: string, file: string): string {
  if (!fs.existsSync(file) || !isVideo(path.basename(file))) throw new ReviewError(`영상 파일을 찾지 못했어요: ${file}`)
  const dir = path.join(root, FOLDERS.defaultReference)
  fs.mkdirSync(dir, { recursive: true })
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true })
  const dest = path.join(dir, path.basename(file))
  fs.copyFileSync(file, dest)
  return dest
}
