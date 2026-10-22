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
  // 지금 상태가 된 시각 — 진행 화면의 경과 시간. 이미 있는 행은 마지막 수정 시각으로 채운다.
  `ALTER TABLE jobs ADD COLUMN status_changed_at TEXT;
  UPDATE jobs SET status_changed_at = updated_at;`,
  // 소리 설정: 원본 그대로(original) / 목소리 또렷하게(voice). 이미 있는 작업은 원본 그대로.
  `ALTER TABLE jobs ADD COLUMN audio_mode TEXT NOT NULL DEFAULT 'original';`,
  // 배경음악(곡 id, 없으면 NULL)과 효과음(off / on). 이미 있는 작업은 둘 다 꺼짐.
  `ALTER TABLE jobs ADD COLUMN bgm_id TEXT;
  ALTER TABLE jobs ADD COLUMN sfx_mode TEXT NOT NULL DEFAULT 'off';`,
  // 자막 위치(top/middle/bottom). 계획을 만들 때 레퍼런스에 맞춰 정해 두고 승인 화면에서 바꾼다. 이미 있는 작업은 NULL(제작 때 계획의 기본값을 쓴다).
  `ALTER TABLE jobs ADD COLUMN caption_position TEXT;`,
  // 편집 감독의 대본(계획 단계에서 저장, JSON)과 사용자가 승인 전에 고친 문구(JSON). 이미 있는 작업은 NULL.
  `ALTER TABLE jobs ADD COLUMN script TEXT;
  ALTER TABLE jobs ADD COLUMN script_edits TEXT;`,
  // 자막 확인 화면에서 사용자가 고친 줄(JSON 배열 [{i, text}]). 이미 있는 작업은 NULL(고친 것 없음).
  `ALTER TABLE jobs ADD COLUMN transcript_edits TEXT;`,
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
