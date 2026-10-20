import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { JobStatus, Phase, Recommendation } from '../shared/types.ts'
import { canTransition, isRunning, PHASE_OF, QUEUED_STATUSES, QUEUED_TO_RUNNING, RUNNING_STATUSES, type QueuedStatus } from './status.ts'

export interface LogLine {
  t: string
  stage: string
  message: string
}

export interface Job {
  id: string
  ownerId: string
  createdAt: string
  updatedAt: string
  status: JobStatus
  stage: string | null
  errorMessage: string | null
  failedPhase: Phase | null
  parentJobId: string | null
  sourceName: string | null
  sourcePath: string | null
  sourceInfo: { durationSec: number; width: number; height: number } | null
  purposeGuess: { purpose: 'post' | 'short'; confidence: number; reasons: string[] } | null
  description: string
  purposeChoice: 'auto' | 'post' | 'short'
  purpose: 'post' | 'short' | null
  referenceSource: string | null
  referenceUploadPath: string | null
  requestText: string
  captionsMode: 'auto' | 'off'
  quality: 'draft' | 'looks' | 'delivery'
  recommendations: Recommendation[]
  summary: unknown | null
  plan: unknown | null
  planCard: string[] | null
  resultPath: string | null
  thumbPath: string | null
  report: unknown | null
  attempts: number
  log: LogLine[]
  confirmedAt: string | null
}

type Patch = Partial<Omit<Job, 'id' | 'createdAt'>>

type Kind = 'text' | 'json' | 'int'
/** Job 필드 → [컬럼, 종류]. JSON 필드는 TEXT 에 JSON 문자열로 저장한다. */
const FIELDS: Record<Exclude<keyof Job, 'id' | 'createdAt'>, [string, Kind]> = {
  ownerId: ['owner_id', 'text'],
  updatedAt: ['updated_at', 'text'],
  status: ['status', 'text'],
  stage: ['stage', 'text'],
  errorMessage: ['error_message', 'text'],
  failedPhase: ['failed_phase', 'text'],
  parentJobId: ['parent_job_id', 'text'],
  sourceName: ['source_name', 'text'],
  sourcePath: ['source_path', 'text'],
  sourceInfo: ['source_info', 'json'],
  purposeGuess: ['purpose_guess', 'json'],
  description: ['description', 'text'],
  purposeChoice: ['purpose_choice', 'text'],
  purpose: ['purpose', 'text'],
  referenceSource: ['reference_source', 'text'],
  referenceUploadPath: ['reference_upload_path', 'text'],
  requestText: ['request_text', 'text'],
  captionsMode: ['captions_mode', 'text'],
  quality: ['quality', 'text'],
  recommendations: ['recommendations', 'json'],
  summary: ['summary', 'json'],
  plan: ['plan', 'json'],
  planCard: ['plan_card', 'json'],
  resultPath: ['result_path', 'text'],
  thumbPath: ['thumb_path', 'text'],
  report: ['report', 'json'],
  attempts: ['attempts', 'int'],
  log: ['log', 'json'],
  confirmedAt: ['confirmed_at', 'text'],
}

const MAX_LOG = 200
const ID_RE = /^[a-f0-9]{10}$/
export const INTERRUPTED_MESSAGE = '작업이 중간에 멈췄어요 (프로그램이 종료됐거나 맥이 잠들었어요). 다시 시도해 주세요.'

type Row = Record<string, unknown>

function rowToJob(row: Row): Job {
  const job: Record<string, unknown> = { id: row.id, createdAt: row.created_at }
  for (const [key, [col, kind]] of Object.entries(FIELDS)) {
    const v = row[col]
    job[key] = v === null || v === undefined ? null : kind === 'json' ? JSON.parse(String(v)) : v
  }
  return job as unknown as Job
}

function toColumnValue(value: unknown, kind: Kind): string | number | null {
  if (value === null || value === undefined) return null
  if (kind === 'json') return JSON.stringify(value)
  return value as string | number
}

const now = () => new Date().toISOString()

export class Jobs {
  constructor(
    private db: DatabaseSync,
    private dataDir: string,
  ) {}

  create(init: { parentJobId?: string } = {}): Job {
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = randomBytes(5).toString('hex')
      const t = now()
      try {
        this.db.prepare('INSERT INTO jobs (id, created_at, updated_at, status, parent_job_id) VALUES (?, ?, ?, ?, ?)').run(id, t, t, 'created', init.parentJobId ?? null)
        return this.get(id)!
      } catch (e) {
        if (attempt === 4) throw e // id 가 겹치는 일은 사실상 없지만 겹치면 다시 뽑는다
      }
    }
    throw new Error('작업을 만들지 못했어요')
  }

  get(id: string): Job | undefined {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Row | undefined
    return row ? rowToJob(row) : undefined
  }

  /** 최신 순 */
  list(o: { statuses?: JobStatus[]; limit?: number } = {}): Job[] {
    const where = o.statuses?.length ? `WHERE status IN (${o.statuses.map(() => '?').join(',')})` : ''
    const limit = o.limit ? `LIMIT ${Math.floor(o.limit)}` : ''
    const rows = this.db.prepare(`SELECT * FROM jobs ${where} ORDER BY created_at DESC, rowid DESC ${limit}`).all(...(o.statuses ?? [])) as Row[]
    return rows.map(rowToJob)
  }

  update(id: string, patch: Patch): Job {
    const { sql, values } = this.setClause({ ...patch })
    const res = this.db.prepare(`UPDATE jobs SET ${sql} WHERE id = ?`).run(...values, id)
    if (res.changes === 0) throw new Error(`작업을 찾을 수 없어요: ${id}`)
    return this.get(id)!
  }

  /** 지금 상태가 from 중 하나일 때만 to 로 바꾼다(조건부 UPDATE). 아니면 null — 같은 동작을 두 번 보내도 한 번만 처리된다. */
  transition(id: string, from: JobStatus[], to: JobStatus, patch: Omit<Patch, 'status'> = {}): Job | null {
    for (const f of from) if (!canTransition(f, to)) throw new Error(`허용되지 않는 상태 전환이에요: ${f} → ${to}`)
    const { sql, values } = this.setClause({ ...patch, status: to })
    const res = this.db.prepare(`UPDATE jobs SET ${sql} WHERE id = ? AND status IN (${from.map(() => '?').join(',')})`).run(...values, id, ...from)
    return res.changes === 0 ? null : this.get(id)!
  }

  /** 가장 오래된 대기(queued_*) 작업을 실행 중 상태로 바꿔 집어 온다. 다른 연결이 먼저 집었으면 다음 것을 시도한다. */
  claimNext(): Job | null {
    const placeholders = QUEUED_STATUSES.map(() => '?').join(',')
    for (let i = 0; i < 5; i++) {
      const row = this.db.prepare(`SELECT id, status FROM jobs WHERE status IN (${placeholders}) ORDER BY created_at ASC, rowid ASC LIMIT 1`).get(...QUEUED_STATUSES) as { id: string; status: QueuedStatus } | undefined
      if (!row) return null
      const claimed = this.transition(row.id, [row.status], QUEUED_TO_RUNNING[row.status])
      if (claimed) return claimed
    }
    return null
  }

  /** 프로그램이 죽어서 실행 중으로 남은 작업을 실패(중단)로 바꾼다. 바꾼 개수를 돌려준다. */
  resetInterrupted(): number {
    let total = 0
    for (const status of RUNNING_STATUSES) {
      const res = this.db
        .prepare(`UPDATE jobs SET status = 'failed', failed_phase = ?, error_message = ?, updated_at = ? WHERE status = ?`)
        .run(PHASE_OF[status], INTERRUPTED_MESSAGE, now(), status)
      total += Number(res.changes)
    }
    return total
  }

  /** 진행 기록 한 줄을 덧붙인다(최대 200줄, 오래된 것부터 버림). */
  log(id: string, stage: string, message: string): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const row = this.db.prepare('SELECT log FROM jobs WHERE id = ?').get(id) as { log: string } | undefined
      if (!row) throw new Error(`작업을 찾을 수 없어요: ${id}`)
      const lines = (JSON.parse(row.log) as LogLine[]).concat({ t: now(), stage, message }).slice(-MAX_LOG)
      this.db.prepare('UPDATE jobs SET log = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(lines), now(), id)
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  /** <dataDir>/jobs/<id> — 없으면 만든다. id 형식이 틀리면 던진다(경로 이탈 방지). */
  jobDir(id: string): string {
    if (!ID_RE.test(id)) throw new Error(`잘못된 작업 id 예요: ${id}`)
    const dir = path.join(this.dataDir, 'jobs', id)
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  remove(id: string): void {
    const job = this.get(id)
    if (!job) return
    if (isRunning(job.status)) throw new Error('실행 중인 작업은 지울 수 없어요')
    this.db.prepare('DELETE FROM jobs WHERE id = ?').run(id)
    fs.rmSync(path.join(this.dataDir, 'jobs', id), { recursive: true, force: true })
  }

  private setClause(patch: Patch): { sql: string; values: (string | number | null)[] } {
    const entries = Object.entries({ ...patch, updatedAt: now() }) as [keyof typeof FIELDS, unknown][]
    const parts: string[] = []
    const values: (string | number | null)[] = []
    for (const [key, value] of entries) {
      const spec = FIELDS[key]
      if (!spec) throw new Error(`알 수 없는 필드예요: ${key}`)
      parts.push(`${spec[0]} = ?`)
      values.push(toColumnValue(value, spec[1]))
    }
    return { sql: parts.join(', '), values }
  }
}
