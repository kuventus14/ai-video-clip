import fs from 'node:fs'
import path from 'node:path'
import { FOLDERS } from './config.ts'
import { uniquePath } from './folders.ts'

/** 완성 폴더의 결과 하나에 대한 기록 — 검토(수락·거절·다시 만들기)에 쓴다 */
export interface ResultRecord {
  /** 숨김 원본 폴더에 보관한 원본 영상 */
  original: string
  createdAt: string
  title?: string
  /** 따라 한 레퍼런스 파일 이름 */
  reference?: string
  /** 이번 편집에 쓴 요청(설정 + 다시 만들기 때 적은 고칠 점) */
  request?: string
  qaPassed?: boolean
  /** 검수에서 나온 중요 문제 */
  qaHigh?: string[]
  /** 편집이 실패했으면 그 이유(이때 결과 파일은 _편집실패.txt) */
  failed?: string
}

const recordsDir = (root: string) => path.join(root, FOLDERS.work, '결과')
const recordPath = (root: string, resultName: string) => path.join(recordsDir(root), `${resultName}.json`)
const notesDir = (root: string) => path.join(root, FOLDERS.work, '다시 만들기')

export function writeRecord(root: string, resultName: string, r: ResultRecord): void {
  fs.mkdirSync(recordsDir(root), { recursive: true })
  fs.writeFileSync(recordPath(root, resultName), JSON.stringify(r, null, 2))
}

export function readRecord(root: string, resultName: string): ResultRecord | undefined {
  try {
    return JSON.parse(fs.readFileSync(recordPath(root, resultName), 'utf8')) as ResultRecord
  } catch {
    return undefined
  }
}

export function removeRecord(root: string, resultName: string): void {
  fs.rmSync(recordPath(root, resultName), { force: true })
}

/** 편집 실패 설명 파일 자리(완성 폴더) */
export function failureNotePath(root: string, stem: string): string {
  return uniquePath(path.join(root, FOLDERS.done), `${stem}_편집실패.txt`)
}

/** 다시 만들 원본에 붙일 고칠 점을 적어 둔다(편집할 때 한 번 읽고 지운다) */
export function saveRedoNote(root: string, originalName: string, note: string): void {
  fs.mkdirSync(notesDir(root), { recursive: true })
  fs.writeFileSync(path.join(notesDir(root), `${originalName}.txt`), note.trim())
}

export function takeRedoNote(root: string, originalName: string): string | undefined {
  const p = path.join(notesDir(root), `${originalName}.txt`)
  if (!fs.existsSync(p)) return undefined
  const note = fs.readFileSync(p, 'utf8').trim()
  fs.rmSync(p, { force: true })
  return note || undefined
}
