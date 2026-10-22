import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { ToolError } from '../src/core/exec.ts'
import { ReferenceFetchError } from '../src/core/reference.ts'
import { TempoError } from '../src/core/tempo.ts'
import { VoiceError } from '../src/core/voice.ts'
import { SoundError } from '../src/shared/sound.ts'
import { VOICE_TOOL_MISSING } from '../src/shared/voice.ts'
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
  captionPosition: 'top',
  script: { version: 1, title: '계획 제목', hook: { sourceStart: 10, sourceEnd: 13, question: '계획 질문?' }, openingLines: ['소개'], sections: [], questions: [], reactions: [], emphasis: [], speed: 1.1, drop: [] },
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

  test('영상이 아닌 파일이면 서버 경로가 없는 안내를 보이고, 도구의 원문은 진행 기록에만 남긴다', async () => {
    const j = job('queued_probe')
    const stderr = '[mov,mp4] moov atom not found /Users/someone/data/jobs/abc/source.mp4: Invalid data found'
    await runOnce(jobs, fakes({ probeVideo: async () => { throw new ToolError('ffprobe', 1, stderr) } }).deps)
    const after = jobs.get(j.id)!
    expect(after).toMatchObject({ status: 'failed', failedPhase: 'probe' })
    expect(after.errorMessage).toContain('읽을 수 없어요')
    expect(after.errorMessage).not.toContain('/Users/')
    expect(after.errorMessage).not.toContain('moov')
    expect(after.log.some((l) => l.message.includes('moov atom not found'))).toBe(true)
  })

  test('다른 도구(ffmpeg 등)의 실패도 원문(경로 포함)을 화면용 메시지에 싣지 않는다', async () => {
    const j = job('queued_produce')
    writeAnalysis(j.id)
    fs.writeFileSync(path.join(jobs.jobDir(j.id), 'prepared.json'), JSON.stringify(PREPARED))
    await runOnce(jobs, fakes({ produceEdit: async () => { throw new ToolError('ffmpeg', 1, 'Error opening /Users/someone/data/x.mp4: No such file') } }).deps)
    const after = jobs.get(j.id)!
    expect(after).toMatchObject({ status: 'failed', failedPhase: 'produce' })
    expect(after.errorMessage).toContain('ffmpeg')
    expect(after.errorMessage).not.toContain('/Users/')
    expect(after.log.some((l) => l.message.includes('No such file'))).toBe(true)
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
    expect(f.calls.search[0]).toEqual({ queries: ['골프 레슨'], purpose: 'short' }) // 세부 검색어(q1~q3)가 아니라 장르로 넓게
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
    expect(after.captionPosition).toBe('top') // 계획이 정한 자막 위치가 승인 화면의 기본값으로 저장된다
    expect(after.script).toEqual(PREPARED.script) // 편집 감독의 대본도 저장돼 승인 화면이 보여 준다
    expect(after.scriptEdits).toBeNull() // 계획을 다시 만들면 이전 문구 수정값은 지운다
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

  test('계획을 다시 만들면 이전 문구 수정값(scriptEdits)을 지운다', async () => {
    const j = job('queued_plan', { scriptEdits: { title: '예전에 고친 제목' } })
    writeAnalysis(j.id)
    await runOnce(jobs, fakes().deps)
    expect(jobs.get(j.id)!.scriptEdits).toBeNull()
  })

  test('제작은 사용자가 고친 문구를 계획 대본 위에 덮어서 엔진에 넘긴다', async () => {
    const j = job('queued_produce', { script: PREPARED.script, scriptEdits: { title: '내가 고친 제목', hookQuestion: '내 질문?', openingLines: [] } })
    writeAnalysis(j.id)
    fs.writeFileSync(path.join(jobs.jobDir(j.id), 'prepared.json'), JSON.stringify(PREPARED))
    const f = fakes()
    await runOnce(jobs, f.deps)
    const s = f.calls.produce[0]!.script!
    expect(s.title).toBe('내가 고친 제목')
    expect(s.hook?.question).toBe('내 질문?')
    expect(s.openingLines).toEqual([])
    expect(s.speed).toBe(1.1) // 고치지 않은 값은 그대로
  })

  test('수정값이 없으면 prepared.json 의 대본을 그대로(엔진은 prepared.script 를 쓴다), 대본이 없으면 넘기지 않는다', async () => {
    const a = job('queued_produce')
    writeAnalysis(a.id)
    fs.writeFileSync(path.join(jobs.jobDir(a.id), 'prepared.json'), JSON.stringify(PREPARED))
    const f = fakes()
    await runOnce(jobs, f.deps)
    expect(f.calls.produce[0]!.script).toBeUndefined() // job.scriptEdits 가 없으면 넘기지 않고 prepared.script 에 맡긴다
    const b = job('queued_produce', { scriptEdits: { title: 'x' } })
    writeAnalysis(b.id)
    fs.writeFileSync(path.join(jobs.jobDir(b.id), 'prepared.json'), JSON.stringify({ ...PREPARED, script: undefined }))
    const g = fakes()
    await runOnce(jobs, g.deps)
    expect(g.calls.produce[0]!.script).toBeUndefined() // 대본이 없는 작업에는 수정값이 있어도 넘기지 않는다
  })

  test('승인 화면에서 고른 자막 위치(captionPosition)를 엔진에 넘긴다 — 고르지 않았으면 넘기지 않는다', async () => {
    for (const [captionPosition, expected] of [['middle', 'middle'], [null, undefined]] as const) {
      const j = job('queued_produce', { captionPosition })
      writeAnalysis(j.id)
      fs.writeFileSync(path.join(jobs.jobDir(j.id), 'prepared.json'), JSON.stringify(PREPARED))
      const f = fakes()
      await runOnce(jobs, f.deps)
      expect(f.calls.produce[0]!.captionPosition).toBe(expected)
    }
  })

  test('소리 설정(audioMode)을 엔진에 넘긴다 — 기본은 original', async () => {
    for (const audioMode of ['voice', 'original'] as const) {
      const j = job('queued_produce', { audioMode })
      writeAnalysis(j.id)
      fs.writeFileSync(path.join(jobs.jobDir(j.id), 'prepared.json'), JSON.stringify(PREPARED))
      const f = fakes()
      await runOnce(jobs, f.deps)
      expect(f.calls.produce[0]).toMatchObject({ audio: audioMode })
    }
  })

  test('배경음악·효과음 선택(bgmId·sfxMode)을 엔진에 넘긴다 — 기본은 없음·끄기', async () => {
    for (const [patch, expected] of [
      [{ bgmId: 'calm-1', sfxMode: 'on' as const }, { bgm: 'calm-1', sfx: 'on' }],
      [{}, { bgm: null, sfx: 'off' }],
    ] as const) {
      const j = job('queued_produce', patch)
      writeAnalysis(j.id)
      fs.writeFileSync(path.join(jobs.jobDir(j.id), 'prepared.json'), JSON.stringify(PREPARED))
      const f = fakes()
      await runOnce(jobs, f.deps)
      expect(f.calls.produce[0]).toMatchObject(expected)
    }
  })

  test('음원 오류(SoundError)는 한국어 안내를 그대로 보여 주고 failed(produce) 로 둔다', async () => {
    const j = job('queued_produce', { bgmId: 'gone' })
    writeAnalysis(j.id)
    fs.writeFileSync(path.join(jobs.jobDir(j.id), 'prepared.json'), JSON.stringify(PREPARED))
    await runOnce(jobs, fakes({ produceEdit: async () => { throw new SoundError('음원 파일이 없어요: gone (bgm/gone.mp3)') } }).deps)
    const after = jobs.get(j.id)!
    expect(after).toMatchObject({ status: 'failed', failedPhase: 'produce', errorMessage: '음원 파일이 없어요: gone (bgm/gone.mp3)' })
  })

  test('속도 조정 오류(TempoError)도 한국어 안내를 그대로 보여 주고 failed(produce) 로 둔다', async () => {
    const j = job('queued_produce')
    writeAnalysis(j.id)
    fs.writeFileSync(path.join(jobs.jobDir(j.id), 'prepared.json'), JSON.stringify(PREPARED))
    await runOnce(jobs, fakes({ produceEdit: async () => { throw new TempoError('속도를 맞추지 못했어요: ffmpeg 가 실패했어요') } }).deps)
    expect(jobs.get(j.id)).toMatchObject({ status: 'failed', failedPhase: 'produce', errorMessage: '속도를 맞추지 못했어요: ffmpeg 가 실패했어요' })
  })

  test('목소리 보정 도구가 없어서 실패하면 설치 안내를 그대로 보여 주고 failed(produce) 로 둔다', async () => {
    const j = job('queued_produce', { audioMode: 'voice' })
    writeAnalysis(j.id)
    fs.writeFileSync(path.join(jobs.jobDir(j.id), 'prepared.json'), JSON.stringify(PREPARED))
    await runOnce(jobs, fakes({ produceEdit: async () => { throw new VoiceError(VOICE_TOOL_MISSING) } }).deps)
    const after = jobs.get(j.id)!
    expect(after).toMatchObject({ status: 'failed', failedPhase: 'produce' })
    expect(after.errorMessage).toBe(VOICE_TOOL_MISSING)
  })

  test('결과 영상을 직접 재서 길이·크기를 리포트에 남긴다 (목록의 길이 표시용)', async () => {
    const j = job('queued_produce')
    writeAnalysis(j.id)
    fs.writeFileSync(path.join(jobs.jobDir(j.id), 'prepared.json'), JSON.stringify(PREPARED))
    const probeVideo = async (p: string) => (p.endsWith('result.mp4') ? { ...INFO, durationSec: 44.2, width: 1080, height: 1920 } : INFO)
    await runOnce(jobs, fakes({ probeVideo }).deps)
    expect(jobs.get(j.id)!.report).toMatchObject({ qa: { passed: true }, output: { durationSec: 44.2, width: 1080, height: 1920 } })
  })

  test('결과를 재지 못해도 작업은 실패하지 않고 리포트는 그대로다', async () => {
    const j = job('queued_produce')
    writeAnalysis(j.id)
    fs.writeFileSync(path.join(jobs.jobDir(j.id), 'prepared.json'), JSON.stringify(PREPARED))
    await runOnce(jobs, fakes({ probeVideo: async () => { throw new Error('ffprobe 실패') } }).deps)
    const after = jobs.get(j.id)!
    expect(after.status).toBe('awaiting_confirm')
    expect(after.report).toMatchObject({ qa: { passed: true } })
    expect(after.report).not.toHaveProperty('output')
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
