import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { openDb } from '../db/db.ts'
import { Jobs } from '../db/jobs.ts'

export interface WebContext {
  jobs: Jobs
  dataDir: string
  db: DatabaseSync
}

// 개발 서버가 모듈을 다시 불러와도 DB 연결이 늘어나지 않도록 globalThis 에 둔다.
const g = globalThis as unknown as { __vaeWebContext?: WebContext }

/** 데이터 폴더(VAE_DATA_DIR, 기본 <실행 위치>/data)의 DB 연결과 작업 저장소. 서버 프로세스마다 하나. */
export function getContext(): WebContext {
  const dataDir = path.resolve(/*turbopackIgnore: true*/ process.env.VAE_DATA_DIR ?? path.join(process.cwd(), 'data'))
  const current = g.__vaeWebContext
  if (current?.dataDir === dataDir) return current
  current?.db.close()
  const db = openDb(dataDir)
  g.__vaeWebContext = { jobs: new Jobs(db, dataDir), dataDir, db }
  return g.__vaeWebContext
}

export function resetContextForTests(): void {
  g.__vaeWebContext?.db.close()
  delete g.__vaeWebContext
}
