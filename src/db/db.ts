import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const MIGRATIONS: string[] = [
  `CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL DEFAULT 'local',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    status TEXT NOT NULL,
    stage TEXT,
    error_message TEXT,
    failed_phase TEXT,
    parent_job_id TEXT,
    source_name TEXT,
    source_path TEXT,
    source_info TEXT,
    purpose_guess TEXT,
    description TEXT NOT NULL DEFAULT '',
    purpose_choice TEXT NOT NULL DEFAULT 'auto',
    purpose TEXT,
    reference_source TEXT,
    reference_upload_path TEXT,
    request_text TEXT NOT NULL DEFAULT '',
    captions_mode TEXT NOT NULL DEFAULT 'auto',
    quality TEXT NOT NULL DEFAULT 'looks',
    recommendations TEXT NOT NULL DEFAULT '[]',
    summary TEXT,
    plan TEXT,
    plan_card TEXT,
    result_path TEXT,
    thumb_path TEXT,
    report TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    log TEXT NOT NULL DEFAULT '[]',
    confirmed_at TEXT
  );
  CREATE INDEX idx_jobs_status ON jobs(status, created_at);`,
]

/** <dataDir>/app.db 를 열고(없으면 만들고) 마이그레이션한다. 화면 서버와 워커가 같은 파일을 연다(WAL). */
export function openDb(dataDir: string): DatabaseSync {
  fs.mkdirSync(dataDir, { recursive: true })
  const db = new DatabaseSync(path.join(dataDir, 'app.db'))
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;')
  db.exec('CREATE TABLE IF NOT EXISTS meta (version INTEGER NOT NULL)')
  const row = db.prepare('SELECT version FROM meta').get() as { version: number } | undefined
  let version = row?.version ?? 0
  if (!row) db.prepare('INSERT INTO meta (version) VALUES (0)').run()
  for (; version < MIGRATIONS.length; version++) {
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec(MIGRATIONS[version]!)
      db.prepare('UPDATE meta SET version = ?').run(version + 1)
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
  return db
}
