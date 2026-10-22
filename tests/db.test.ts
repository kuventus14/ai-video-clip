import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { openDb } from '../src/db/db.ts'
import { Jobs } from '../src/db/jobs.ts'
import { canTransition, PHASE_OF, QUEUED_OF, QUEUED_TO_RUNNING } from '../src/db/status.ts'
import type { JobStatus } from '../src/shared/types.ts'

let dir: string
let jobs: Jobs

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vae-db-'))
  jobs = new Jobs(openDb(dir), dir)
})

describe('Jobs — 만들기·읽기·수정', () => {
  test('create 는 기본값과 10자리 16진수 id 를 가진 작업을 만든다', () => {
    const j = jobs.create()
    expect(j.id).toMatch(/^[a-f0-9]{10}$/)
    expect(j).toMatchObject({
      ownerId: 'local',
      status: 'created',
      purposeChoice: 'auto',
      quality: 'looks',
      captionsMode: 'auto',
      audioMode: 'original',
      bgmId: null,
      sfxMode: 'off',
      captionPosition: null,
      script: null,
      scriptEdits: null,
      description: '',
      requestText: '',
      recommendations: [],
      attempts: 0,
      log: [],
      parentJobId: null,
      planCard: null,
      report: null,
    })
    expect(jobs.get(j.id)).toEqual(j)
  })

  test('JSON 필드(planCard·report·recommendations·sourceInfo)는 저장했다 읽어도 같다', () => {
    const j = jobs.create()
    const rec = { id: 'abc', url: 'https://youtu.be/abc', title: '제목', viewCount: 10, durationSec: 59, thumbnail: 'https://i.ytimg.com/vi/abc/hqdefault.jpg' }
    jobs.update(j.id, { planCard: ['이렇게 이해했어요'], report: { passed: true, n: [1, 2] }, recommendations: [rec], sourceInfo: { durationSec: 56.8, width: 1080, height: 1920 } })
    const back = jobs.get(j.id)!
    expect(back.planCard).toEqual(['이렇게 이해했어요'])
    expect(back.report).toEqual({ passed: true, n: [1, 2] })
    expect(back.recommendations).toEqual([rec])
    expect(back.sourceInfo).toEqual({ durationSec: 56.8, width: 1080, height: 1920 })
  })

  test('audioMode 는 기본이 original 이고 voice 로 바꿔 저장했다 읽어도 같다', () => {
    const j = jobs.create()
    expect(j.audioMode).toBe('original')
    jobs.update(j.id, { audioMode: 'voice' })
    expect(jobs.get(j.id)!.audioMode).toBe('voice')
  })

  test('bgmId 는 기본 null, sfxMode 는 기본 off 이고 저장했다 읽어도 같다', () => {
    const j = jobs.create()
    expect(j.bgmId).toBeNull()
    expect(j.sfxMode).toBe('off')
    jobs.update(j.id, { bgmId: 'calm-1', sfxMode: 'on' })
    expect(jobs.get(j.id)).toMatchObject({ bgmId: 'calm-1', sfxMode: 'on' })
    jobs.update(j.id, { bgmId: null })
    expect(jobs.get(j.id)!.bgmId).toBeNull()
  })

  test('captionPosition 은 기본이 null(계획이 정한 위치를 따른다)이고 top·middle·bottom 으로 저장했다 읽어도 같다', () => {
    const j = jobs.create()
    expect(j.captionPosition).toBeNull()
    for (const p of ['top', 'middle', 'bottom'] as const) {
      jobs.update(j.id, { captionPosition: p })
      expect(jobs.get(j.id)!.captionPosition).toBe(p)
    }
    jobs.update(j.id, { captionPosition: null })
    expect(jobs.get(j.id)!.captionPosition).toBeNull()
  })

  test('script·scriptEdits 는 기본이 null 이고 JSON 으로 저장했다 읽어도 같다', () => {
    const j = jobs.create()
    expect(j.script).toBeNull()
    expect(j.scriptEdits).toBeNull()
    const script = { version: 1, title: '제목', openingLines: ['a'], sections: [{ atSec: 3, label: 'L' }], questions: [], reactions: [], emphasis: ['단어'], speed: 1.1, drop: [] }
    jobs.update(j.id, { script, scriptEdits: { title: '고친 제목', openingLines: [] } })
    const back = jobs.get(j.id)!
    expect(back.script).toEqual(script)
    expect(back.scriptEdits).toEqual({ title: '고친 제목', openingLines: [] })
    jobs.update(j.id, { script: null, scriptEdits: null })
    expect(jobs.get(j.id)).toMatchObject({ script: null, scriptEdits: null })
  })

  test('고친 자막(transcriptEdits)도 JSON 으로 저장되고 복원된다', () => {
    const j = jobs.create()
    jobs.update(j.id, { transcriptEdits: [{ i: 0, text: '고친 글' }, { i: 3, text: null }] })
    expect(jobs.get(j.id)!.transcriptEdits).toEqual([{ i: 0, text: '고친 글' }, { i: 3, text: null }])
    jobs.update(j.id, { transcriptEdits: null })
    expect(jobs.get(j.id)!.transcriptEdits).toBeNull()
    expect(jobs.create().transcriptEdits).toBeNull()
  })

  test('버전 6 DB(자막 편집 칸 없음)를 열면 7 로 올라가고 기존 작업의 transcriptEdits 는 null', () => {
    const old = fs.mkdtempSync(path.join(os.tmpdir(), 'vae-db-v6-'))
    const db = openDb(old)
    const id = new Jobs(db, old).create().id
    db.exec('ALTER TABLE jobs DROP COLUMN transcript_edits; UPDATE meta SET version = 6')
    db.close()
    const reopened = openDb(old)
    expect((reopened.prepare('SELECT version FROM meta').get() as { version: number }).version).toBe(7)
    expect(new Jobs(reopened, old).get(id)).toMatchObject({ transcriptEdits: null })
    reopened.close()
    fs.rmSync(old, { recursive: true, force: true })
  })

  test('버전 3 DB 를 열면 최신(7)으로 올라가고, 이미 있던 작업은 bgmId null · sfxMode off · captionPosition null · script null', () => {
    const old = fs.mkdtempSync(path.join(os.tmpdir(), 'vae-db-old-'))
    const db = openDb(old)
    const id = new Jobs(db, old).create().id
    db.exec('ALTER TABLE jobs DROP COLUMN transcript_edits; ALTER TABLE jobs DROP COLUMN script; ALTER TABLE jobs DROP COLUMN script_edits; ALTER TABLE jobs DROP COLUMN caption_position; ALTER TABLE jobs DROP COLUMN bgm_id; ALTER TABLE jobs DROP COLUMN sfx_mode; UPDATE meta SET version = 3')
    db.close()

    const reopened = openDb(old)
    expect((reopened.prepare('SELECT version FROM meta').get() as { version: number }).version).toBe(7)
    expect(new Jobs(reopened, old).get(id)).toMatchObject({ bgmId: null, sfxMode: 'off', captionPosition: null, script: null, scriptEdits: null, audioMode: 'original' })
    reopened.close()
    fs.rmSync(old, { recursive: true, force: true })
  })

  test('update 는 updatedAt 을 갱신하고, 없는 작업은 던진다', () => {
    const j = jobs.create()
    const before = j.updatedAt
    const after = jobs.update(j.id, { description: '골프 레슨 영상입니다' })
    expect(after.description).toBe('골프 레슨 영상입니다')
    expect(after.updatedAt >= before).toBe(true)
    expect(() => jobs.update('0000000000', { stage: 'x' })).toThrow()
  })

  test('get 은 없는 id 에 undefined, list 는 최신 순이고 상태·개수로 거른다', () => {
    expect(jobs.get('0000000000')).toBeUndefined()
    const a = jobs.create()
    const b = jobs.create()
    const c = jobs.create()
    jobs.update(b.id, { status: 'confirmed' })
    expect(jobs.list().map((j) => j.id)).toEqual([c.id, b.id, a.id])
    expect(jobs.list({ statuses: ['confirmed'] }).map((j) => j.id)).toEqual([b.id])
    expect(jobs.list({ limit: 2 })).toHaveLength(2)
  })
})

describe('Jobs.transition — 조건부 상태 변경 (Review Focus 2)', () => {
  test('상태가 맞을 때만 바꾸고 patch 를 함께 적용한다', () => {
    const j = jobs.create()
    jobs.update(j.id, { status: 'ready' })
    const t = jobs.transition(j.id, ['ready'], 'queued_analysis', { description: '설명', purposeChoice: 'short' })
    expect(t).toMatchObject({ status: 'queued_analysis', description: '설명', purposeChoice: 'short' })
  })

  test('같은 전환을 두 번 호출하면 한 번만 성공한다', () => {
    const j = jobs.create()
    jobs.update(j.id, { status: 'awaiting_plan' })
    const first = jobs.transition(j.id, ['awaiting_plan'], 'queued_produce')
    const second = jobs.transition(j.id, ['awaiting_plan'], 'queued_produce')
    expect(first).not.toBeNull()
    expect(second).toBeNull()
    expect(jobs.get(j.id)!.status).toBe('queued_produce')
  })

  test('허용되지 않는 전환(canTransition 이 거짓)은 던진다', () => {
    const j = jobs.create()
    expect(() => jobs.transition(j.id, ['created'], 'producing')).toThrow()
  })
})

describe('statusChangedAt — 지금 상태가 된 시각 (진행 화면의 경과 시간)', () => {
  afterEach(() => vi.useRealTimers())

  test('create 는 만든 시각으로 시작하고, 상태가 바뀔 때만 갱신된다 (log·다른 필드 수정은 그대로)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-20T10:00:00.000Z'))
    const j = jobs.create()
    expect(j.statusChangedAt).toBe('2026-10-20T10:00:00.000Z')

    vi.setSystemTime(new Date('2026-10-20T10:00:05.000Z'))
    jobs.log(j.id, 'x', '로그')
    jobs.update(j.id, { description: '설명' })
    expect(jobs.get(j.id)!.statusChangedAt).toBe('2026-10-20T10:00:00.000Z')
    expect(jobs.get(j.id)!.updatedAt).toBe('2026-10-20T10:00:05.000Z')

    vi.setSystemTime(new Date('2026-10-20T10:00:09.000Z'))
    jobs.transition(j.id, ['created'], 'queued_probe')
    expect(jobs.get(j.id)!.statusChangedAt).toBe('2026-10-20T10:00:09.000Z')

    vi.setSystemTime(new Date('2026-10-20T10:00:12.000Z'))
    jobs.update(j.id, { status: 'ready' })
    expect(jobs.get(j.id)!.statusChangedAt).toBe('2026-10-20T10:00:12.000Z')
  })

  test('claimNext·resetInterrupted 가 바꾼 상태도 시각이 갱신된다', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-20T11:00:00.000Z'))
    const j = jobs.create()
    jobs.transition(j.id, ['created'], 'queued_probe')
    vi.setSystemTime(new Date('2026-10-20T11:01:00.000Z'))
    expect(jobs.claimNext()!.statusChangedAt).toBe('2026-10-20T11:01:00.000Z')
    vi.setSystemTime(new Date('2026-10-20T11:02:00.000Z'))
    jobs.resetInterrupted()
    expect(jobs.get(j.id)!.statusChangedAt).toBe('2026-10-20T11:02:00.000Z')
  })
})

describe('Jobs.claimNext', () => {
  const queued = (status: JobStatus) => {
    const j = jobs.create()
    jobs.update(j.id, { status })
    return j.id
  }

  test('가장 오래된 queued_* 를 대응하는 실행 중 상태로 바꿔 돌려준다', () => {
    const a = queued('queued_analysis')
    const b = queued('queued_produce')
    const first = jobs.claimNext()!
    expect(first).toMatchObject({ id: a, status: 'analyzing' })
    const second = jobs.claimNext()!
    expect(second).toMatchObject({ id: b, status: 'producing' })
  })

  test('대기 작업이 없으면 null', () => {
    queued('awaiting_reference')
    queued('confirmed')
    expect(jobs.claimNext()).toBeNull()
  })

  test('같은 db 파일을 연 두 번째 Jobs 인스턴스는 이미 집어 간 작업을 받지 못한다', () => {
    const id = queued('queued_plan')
    const other = new Jobs(openDb(dir), dir)
    expect(jobs.claimNext()).toMatchObject({ id, status: 'planning' })
    expect(other.claimNext()).toBeNull()
    expect(other.get(id)!.status).toBe('planning')
  })

  test('실행 중 상태 매핑 표', () => {
    expect(QUEUED_TO_RUNNING).toEqual({ queued_probe: 'probing', queued_analysis: 'analyzing', queued_plan: 'planning', queued_produce: 'producing' })
    expect(PHASE_OF).toEqual({ probing: 'probe', analyzing: 'analysis', planning: 'plan', producing: 'produce' })
    expect(QUEUED_OF).toEqual({ probe: 'queued_probe', analysis: 'queued_analysis', plan: 'queued_plan', produce: 'queued_produce' })
  })
})

describe('Jobs.resetInterrupted (Review Focus 3)', () => {
  test('실행 중이던 작업을 failed(+단계, 한국어 안내)로 바꾸고 개수를 돌려준다', () => {
    const ids = (['probing', 'analyzing', 'planning', 'producing', 'awaiting_plan'] as JobStatus[]).map((status) => {
      const j = jobs.create()
      jobs.update(j.id, { status })
      return j.id
    })
    expect(jobs.resetInterrupted()).toBe(4)
    const phases = ids.slice(0, 4).map((id) => jobs.get(id)!.failedPhase)
    expect(phases).toEqual(['probe', 'analysis', 'plan', 'produce'])
    for (const id of ids.slice(0, 4)) {
      const j = jobs.get(id)!
      expect(j.status).toBe('failed')
      expect(j.errorMessage).toMatch(/멈췄어요/)
    }
    expect(jobs.get(ids[4]!)!.status).toBe('awaiting_plan')
  })
})

describe('Jobs.log·jobDir·remove', () => {
  test('log 는 200줄을 넘으면 오래된 것부터 버린다', () => {
    const j = jobs.create()
    for (let i = 0; i < 205; i++) jobs.log(j.id, 'render', `줄 ${i}`)
    const log = jobs.get(j.id)!.log
    expect(log).toHaveLength(200)
    expect(log[0]!.message).toBe('줄 5')
    expect(log.at(-1)).toMatchObject({ stage: 'render', message: '줄 204' })
    expect(new Date(log[0]!.t).toString()).not.toBe('Invalid Date')
  })

  test('jobDir 은 <dataDir>/jobs/<id> 를 만들고, 이상한 id 는 던진다', () => {
    const j = jobs.create()
    const d = jobs.jobDir(j.id)
    expect(d).toBe(path.join(dir, 'jobs', j.id))
    expect(fs.statSync(d).isDirectory()).toBe(true)
    expect(() => jobs.jobDir('../etc')).toThrow()
  })

  test('remove 는 행과 폴더를 지우고, 실행 중이면 던진다', () => {
    const j = jobs.create()
    const d = jobs.jobDir(j.id)
    fs.writeFileSync(path.join(d, 'source.mp4'), 'x')
    jobs.remove(j.id)
    expect(jobs.get(j.id)).toBeUndefined()
    expect(fs.existsSync(d)).toBe(false)

    const running = jobs.create()
    jobs.update(running.id, { status: 'analyzing' })
    expect(() => jobs.remove(running.id)).toThrow(/실행 중/)
    expect(jobs.get(running.id)).toBeDefined()
  })
})

describe('canTransition', () => {
  test('흐름대로의 전환은 허용', () => {
    const ok: [JobStatus, JobStatus][] = [
      ['created', 'queued_probe'], ['queued_probe', 'probing'], ['probing', 'ready'], ['ready', 'queued_analysis'],
      ['queued_analysis', 'analyzing'], ['analyzing', 'awaiting_reference'], ['analyzing', 'queued_plan'], ['awaiting_reference', 'queued_plan'],
      ['queued_plan', 'planning'], ['planning', 'awaiting_plan'], ['awaiting_plan', 'queued_plan'], ['awaiting_plan', 'queued_produce'],
      ['queued_produce', 'producing'], ['producing', 'awaiting_confirm'], ['awaiting_confirm', 'confirmed'], ['awaiting_confirm', 'queued_plan'],
      ['probing', 'failed'], ['analyzing', 'failed'], ['planning', 'failed'], ['producing', 'failed'],
      ['failed', 'queued_probe'], ['failed', 'queued_analysis'], ['failed', 'queued_plan'], ['failed', 'queued_produce'],
    ]
    for (const [a, b] of ok) expect(canTransition(a, b), `${a} → ${b}`).toBe(true)
  })

  test('건너뛰기·되돌리기는 거부', () => {
    const bad: [JobStatus, JobStatus][] = [
      ['ready', 'producing'], ['created', 'ready'], ['awaiting_plan', 'confirmed'], ['confirmed', 'queued_plan'], ['confirmed', 'failed'],
      ['awaiting_reference', 'queued_produce'], ['producing', 'queued_produce'], ['ready', 'failed'], ['queued_plan', 'awaiting_plan'],
    ]
    for (const [a, b] of bad) expect(canTransition(a, b), `${a} → ${b}`).toBe(false)
  })
})
