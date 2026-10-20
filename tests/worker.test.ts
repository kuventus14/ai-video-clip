import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { ReferenceFetchError } from '../src/core/reference.ts'
import type { Analysis, Prepared } from '../src/core/pipeline.ts'
import { openDb } from '../src/db/db.ts'
import { Jobs } from '../src/db/jobs.ts'
import type { JobStatus, Recommendation } from '../src/shared/types.ts'
import { runOnce, startWorker, type WorkerDeps } from '../src/worker/worker.ts'

let dir: string
let jobs: Jobs

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vae-worker-'))
  jobs = new Jobs(openDb(dir), dir)
})

const INFO = { path: '/x/source.mp4', durationSec: 56.8, width: 1080, height: 1920, fps: 30, hasAudio: true, videoBitrate: 2e6 }
const ANALYSIS: Analysis = {
  version: 1,
  sourcePath: '/x/source.mp4',
  info: INFO,
  transcript: { language: 'ko', durationSec: 56.8, words: [], segments: [], hasSpeech: true },
  summary: { topic: '롱아이언', genre: '골프 레슨', oneLine: '롱아이언 팁', language: 'ko', hasPeople: true, hookTitle: '롱아이언 꿀팁', searchQueries: ['q1', 'q2', 'q3'], source: 'analyzed' },
  purposeGuess: { purpose: 'short', confidence: 0.8, reasons: ['세로 비율'] },
}
const SPEC = { orientation: 'portrait' } as never
const PREPARED: Prepared = {
  purpose: 'short',
  purposeChoice: 'auto',
  purposeGuess: ANALYSIS.purposeGuess,
  plan: { mode: 'full-reference', take: ['pacing'], skip: [], adjust: [], unsupported: [] },
  planCard: ['이렇게 이해했어요: …'],
  reframe: 'none',
  referenceSource: 'https://youtu.be/abc',
  spec: SPEC,
}
const REC: Recommendation = { id: 'abc', url: 'https://www.youtube.com/watch?v=abc', title: '추천 영상', viewCount: 1000, durationSec: 59, thumbnail: 'https://i.ytimg.com/vi/abc/hqdefault.jpg' }

interface Calls {
  analyze: Parameters<WorkerDeps['analyzeInput']>[0][]
  prepare: Parameters<WorkerDeps['prepareEdit']>[0][]
  produce: Parameters<WorkerDeps['produceEdit']>[0][]
  search: Parameters<WorkerDeps['searchReferences']>[0][]
}

function fakes(over: Partial<WorkerDeps> = {}) {
  const calls: Calls = { analyze: [], prepare: [], produce: [], search: [] }
  const deps: WorkerDeps = {
    probeVideo: async () => INFO,
    detectPurpose: (i) => ({ purpose: i.info.height > i.info.width ? 'short' : 'post', confidence: 0.8, reasons: ['테스트'] }),
    analyzeInput: async (i) => {
      calls.analyze.push(i)
      i.onStage?.('transcribe')
      return ANALYSIS
    },
    prepareEdit: async (i) => {
      calls.prepare.push(i)
      i.onStage?.('plan')
      return PREPARED
    },
    produceEdit: async (i) => {
      calls.produce.push(i)
      fs.mkdirSync(i.outDir, { recursive: true })
      fs.writeFileSync(path.join(i.outDir, 'result.mp4'), 'mp4')
      fs.writeFileSync(path.join(i.outDir, 'report.json'), JSON.stringify({ qa: { passed: true, findings: [] }, unchecked: ['싱크'] }))
      i.onStage?.('render', 'looks 화질')
      return { resultPath: path.join(i.outDir, 'result.mp4'), purpose: 'short', attempts: 2, delivered: true } as never
    },
    searchReferences: async (i) => {
      calls.search.push(i)
      return [REC]
    },
    makeThumbnail: async (_video, out) => {
      fs.writeFileSync(out, 'jpg')
    },
    ...over,
  }
  return { deps, calls }
}

/** 작업을 만들어 원하는 상태·필드로 만든다 */
function job(status: JobStatus, patch: Parameters<Jobs['update']>[1] = {}) {
  const j = jobs.create()
  const src = path.join(jobs.jobDir(j.id), 'source.mp4')
  fs.writeFileSync(src, 'video')
  return jobs.update(j.id, { status, sourcePath: src, sourceName: '내 영상.mp4', ...patch })
}

const writeAnalysis = (id: string) => fs.writeFileSync(path.join(jobs.jobDir(id), 'analysis.json'), JSON.stringify(ANALYSIS))

describe('probe 단계', () => {
  test('영상 정보·자동 인식 용도·썸네일을 채우고 ready 로 보낸다', async () => {
    const j = job('queued_probe')
    const f = fakes()
    expect(await runOnce(jobs, f.deps)).toBe('processed')
    const after = jobs.get(j.id)!
    expect(after.status).toBe('ready')
    expect(after.sourceInfo).toEqual({ durationSec: 56.8, width: 1080, height: 1920 })
    expect(after.purposeGuess).toMatchObject({ purpose: 'short' })
    expect(fs.existsSync(after.thumbPath!)).toBe(true)
  })

  test('썸네일을 못 만들어도 작업은 실패하지 않는다', async () => {
    const j = job('queued_probe')
    await runOnce(jobs, fakes({ makeThumbnail: async () => { throw new Error('ffmpeg 실패') } }).deps)
    const after = jobs.get(j.id)!
    expect(after.status).toBe('ready')
    expect(after.thumbPath).toBeNull()
  })

  test('10분을 넘는 영상은 올리자마자 failed(probe) 로 알린다', async () => {
    const j = job('queued_probe')
    await runOnce(jobs, fakes({ probeVideo: async () => ({ ...INFO, durationSec: 700 }) }).deps)
    const after = jobs.get(j.id)!
    expect(after).toMatchObject({ status: 'failed', failedPhase: 'probe' })
    expect(after.errorMessage).toContain('너무 길어요')
  })
})

describe('analysis 단계', () => {
  test('레퍼런스가 없으면 추천을 검색해 awaiting_reference 로 보내고 analysis.json 을 남긴다', async () => {
    const j = job('queued_analysis', { description: '골프 레슨 영상입니다' })
    const f = fakes()
    await runOnce(jobs, f.deps)
    const after = jobs.get(j.id)!
    expect(after.status).toBe('awaiting_reference')
    expect(after.summary).toMatchObject({ topic: '롱아이언', searchQueries: ['q1', 'q2', 'q3'] })
    expect(after.recommendations).toEqual([REC])
    expect(after.purposeGuess).toMatchObject({ purpose: 'short', confidence: 0.8 })
    expect(JSON.parse(fs.readFileSync(path.join(jobs.jobDir(j.id), 'analysis.json'), 'utf8')).version).toBe(1)
    expect(f.calls.analyze[0]).toMatchObject({ videoPath: j.sourcePath, workDir: jobs.jobDir(j.id), description: '골프 레슨 영상입니다' })
    expect(f.calls.analyze[0]!.reference).toBeUndefined() // 레퍼런스는 분석에서 받지 않는다
    expect(f.calls.search[0]).toEqual({ queries: ['q1', 'q2', 'q3'], purpose: 'short' })
  })

  test('사용자가 고른 용도로 검색한다 (자동 인식과 달라도)', async () => {
    job('queued_analysis', { purposeChoice: 'post' })
    const f = fakes()
    await runOnce(jobs, f.deps)
    expect(f.calls.search[0]!.purpose).toBe('post')
  })

  test('레퍼런스가 이미 있으면 검색하지 않고 곧바로 queued_plan', async () => {
    const j = job('queued_analysis', { referenceSource: 'https://youtu.be/abc' })
    const f = fakes()
    await runOnce(jobs, f.deps)
    expect(jobs.get(j.id)!.status).toBe('queued_plan')
    expect(f.calls.search).toHaveLength(0)
  })

  test('(Review Focus 4) 검색이 실패해도 작업은 awaiting_reference 로 가고 경고만 남긴다', async () => {
    const j = job('queued_analysis')
    await runOnce(jobs, fakes({ searchReferences: async () => { throw new Error('인터넷 없음') } }).deps)
    const after = jobs.get(j.id)!
    expect(after.status).toBe('awaiting_reference')
    expect(after.recommendations).toEqual([])
    expect(after.log.some((l) => l.stage === 'search' && /추천/.test(l.message))).toBe(true)
  })

  test('단계 진행은 stage 와 로그에 한국어로 남는다', async () => {
    const j = job('queued_analysis')
    await runOnce(jobs, fakes().deps)
    const after = jobs.get(j.id)!
    expect(after.log.some((l) => l.stage === 'transcribe' && l.message.includes('음성 인식'))).toBe(true)
    expect(after.stage).toBeNull() // 끝나면 비운다
  })
})

describe('plan 단계', () => {
  test('분석 결과와 입력으로 prepareEdit 를 부르고 계획 카드를 저장해 awaiting_plan 으로 보낸다', async () => {
    const j = job('queued_plan', { requestText: '컷을 더 빠르게', purposeChoice: 'short', referenceSource: 'https://youtu.be/abc' })
    writeAnalysis(j.id)
    const f = fakes()
    await runOnce(jobs, f.deps)
    const after = jobs.get(j.id)!
    expect(after).toMatchObject({ status: 'awaiting_plan', purpose: 'short', planCard: ['이렇게 이해했어요: …'] })
    expect(after.plan).toEqual(PREPARED.plan)
    expect(fs.existsSync(path.join(jobs.jobDir(j.id), 'prepared.json'))).toBe(true)
    expect(f.calls.prepare[0]).toMatchObject({ request: '컷을 더 빠르게', purposeChoice: 'short', reference: 'https://youtu.be/abc' })
    expect(f.calls.prepare[0]!.analysis.summary.topic).toBe('롱아이언')
  })

  test('같은 레퍼런스로 다시 계획하면 이전에 분석한 스펙을 넘겨 다시 받지 않는다', async () => {
    const j = job('queued_plan', { referenceSource: 'https://youtu.be/abc' })
    writeAnalysis(j.id)
    fs.writeFileSync(path.join(jobs.jobDir(j.id), 'prepared.json'), JSON.stringify(PREPARED))
    const f = fakes()
    await runOnce(jobs, f.deps)
    expect(f.calls.prepare[0]!.knownSpec).toEqual(SPEC)
  })

  test('레퍼런스가 바뀌었으면 이전 스펙을 쓰지 않는다', async () => {
    const j = job('queued_plan', { referenceSource: 'https://youtu.be/다른것' })
    writeAnalysis(j.id)
    fs.writeFileSync(path.join(jobs.jobDir(j.id), 'prepared.json'), JSON.stringify(PREPARED))
    const f = fakes()
    await runOnce(jobs, f.deps)
    expect(f.calls.prepare[0]!.knownSpec).toBeUndefined()
  })

  test('레퍼런스를 못 받으면(비공개) failed(plan) 와 한국어 안내', async () => {
    const j = job('queued_plan', { referenceSource: 'https://www.instagram.com/reel/x/' })
    writeAnalysis(j.id)
    await runOnce(jobs, fakes({ prepareEdit: async () => { throw new ReferenceFetchError('private', '비공개이거나 로그인이 필요한 영상이에요.') } }).deps)
    const after = jobs.get(j.id)!
    expect(after).toMatchObject({ status: 'failed', failedPhase: 'plan' })
    expect(after.errorMessage).toContain('비공개')
  })
})

describe('produce 단계', () => {
  test('결과·리포트·썸네일을 저장하고 awaiting_confirm 으로 보낸다 (화질·자막 설정을 전달)', async () => {
    const j = job('queued_produce', { quality: 'delivery', captionsMode: 'off' })
    writeAnalysis(j.id)
    fs.writeFileSync(path.join(jobs.jobDir(j.id), 'prepared.json'), JSON.stringify(PREPARED))
    const f = fakes()
    await runOnce(jobs, f.deps)
    const after = jobs.get(j.id)!
    expect(after.status).toBe('awaiting_confirm')
    expect(after.resultPath).toBe(path.join(jobs.jobDir(j.id), 'out', 'result.mp4'))
    expect(after.report).toMatchObject({ qa: { passed: true } })
    expect(after.attempts).toBe(2)
    expect(fs.existsSync(after.thumbPath!)).toBe(true)
    expect(f.calls.produce[0]).toMatchObject({ quality: 'delivery', captions: 'off', outDir: path.join(jobs.jobDir(j.id), 'out') })
    expect(after.log.some((l) => l.message.includes('렌더링'))).toBe(true)
  })
})

describe('실패 처리와 순서', () => {
  test('예상하지 못한 오류는 일반 안내 + 로그에 상세, failedPhase 를 남긴다', async () => {
    const j = job('queued_analysis')
    await runOnce(jobs, fakes({ analyzeInput: async () => { throw new TypeError('undefined is not a function') } }).deps)
    const after = jobs.get(j.id)!
    expect(after).toMatchObject({ status: 'failed', failedPhase: 'analysis' })
    expect(after.errorMessage).toContain('예상하지 못한 오류')
    expect(after.log.some((l) => l.message.includes('undefined is not a function'))).toBe(true)
  })

  test('실패한 작업은 실패한 단계의 대기 상태로 다시 보낼 수 있다', async () => {
    const j = job('queued_produce')
    writeAnalysis(j.id)
    fs.writeFileSync(path.join(jobs.jobDir(j.id), 'prepared.json'), JSON.stringify(PREPARED))
    await runOnce(jobs, fakes({ produceEdit: async () => { throw new Error('렌더 실패') } }).deps)
    expect(jobs.get(j.id)!.failedPhase).toBe('produce')
    expect(jobs.transition(j.id, ['failed'], 'queued_produce', { errorMessage: null })).not.toBeNull()
    await runOnce(jobs, fakes().deps)
    expect(jobs.get(j.id)!.status).toBe('awaiting_confirm')
  })

  test('대기 작업이 없으면 idle, 둘이면 오래된 것부터 하나씩', async () => {
    expect(await runOnce(jobs, fakes().deps)).toBe('idle')
    const a = job('queued_probe')
    const b = job('queued_probe')
    const f = fakes()
    await runOnce(jobs, f.deps)
    expect(jobs.get(a.id)!.status).toBe('ready')
    expect(jobs.get(b.id)!.status).toBe('queued_probe')
    await runOnce(jobs, f.deps)
    expect(jobs.get(b.id)!.status).toBe('ready')
  })
})

describe('startWorker', () => {
  const waitFor = async (cond: () => boolean, ms = 4000) => {
    const t0 = Date.now()
    while (!cond()) {
      if (Date.now() - t0 > ms) throw new Error('시간 초과')
      await new Promise((r) => setTimeout(r, 15))
    }
  }

  test('(Review Focus 3) 시작할 때 실행 중이던 작업을 failed(중단)로 바꾸고, 이어서 대기 작업을 처리한다', async () => {
    const stuck = job('producing')
    const next = job('queued_probe')
    const w = startWorker({ dataDir: dir, pollMs: 20, deps: fakes().deps })
    await waitFor(() => jobs.get(next.id)!.status === 'ready')
    await w.stop()
    const after = jobs.get(stuck.id)!
    expect(after).toMatchObject({ status: 'failed', failedPhase: 'produce' })
    expect(after.errorMessage).toMatch(/멈췄어요/)
  })

  test('stop 은 진행 중이던 한 건을 끝낸 뒤 반환하고 그 뒤에는 더 집지 않는다', async () => {
    const a = job('queued_probe')
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const f = fakes({
      probeVideo: async () => {
        await gate
        return INFO
      },
    })
    const w = startWorker({ dataDir: dir, pollMs: 20, deps: f.deps })
    await waitFor(() => jobs.get(a.id)!.status === 'probing')
    const b = job('queued_probe')
    let stopped = false
    const stopping = w.stop().then(() => (stopped = true))
    await new Promise((r) => setTimeout(r, 60))
    expect(stopped).toBe(false) // 진행 중인 건이 끝나길 기다린다
    release()
    await stopping
    expect(jobs.get(a.id)!.status).toBe('ready')
    expect(jobs.get(b.id)!.status).toBe('queued_probe')
  })
})
