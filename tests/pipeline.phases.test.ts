import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { analyzeInput, prepareEdit, produceEdit, runEdit, type Analysis, type PipelineDeps, type Prepared, type Stage } from '../src/core/pipeline.ts'
import { interpretRequest } from '../src/core/interpret.ts'
import { ReferenceFetchError } from '../src/core/reference.ts'
import { FEASIBILITY, type StyleSpec } from '../src/core/styleSpec.ts'
import type { QaReport } from '../src/core/qa.ts'
import type { Transcript, VideoInfo, Word } from '../src/core/types.ts'
import type { VideoSummary } from '../src/core/understand.ts'

const info = (over: Partial<VideoInfo> = {}): VideoInfo => ({ path: '/in/영상.mp4', durationSec: 45, width: 1920, height: 1080, fps: 30, hasAudio: true, videoBitrate: 2e6, videoCodec: 'h264', rotation: 0, ...over })
const word = (text: string, start: number): Word => ({ text, start, end: start + 0.4, confidence: 0.9 })
const TR: Transcript = { language: 'ko', durationSec: 45, hasSpeech: true, words: [word('안녕하세요', 1), word('롱아이언', 2)], segments: [{ text: '안녕하세요 롱아이언', start: 1, end: 2.4 }] }
const SUMMARY: VideoSummary = { topic: '롱아이언', genre: '골프 레슨', oneLine: '롱아이언 팁', language: 'ko', hasPeople: true, hookTitle: '롱아이언 꿀팁', searchQueries: ['a', 'b', 'c'], source: 'analyzed' }
const SPEC: StyleSpec = {
  orientation: 'portrait', durationSec: 40, pacing: { shotCount: 9, avgShotLengthSec: 4.4, cutsPerMinute: 12 },
  hook: { endSec: 3, description: '훅' }, captions: { present: true, position: 'bottom', size: 'medium', color: '#FFFFFF', maxCharsPerLine: 14 },
  hookTitle: { present: true, text: '꿀팁' }, transitions: { dominant: 'hard-cut' }, music: { present: false, energy: 'low' }, structure: [], feasibility: { ...FEASIBILITY },
}
const PASS: QaReport = { passed: true, findings: [], corrections: [], checkedAt: '2026-10-21T00:00:00Z' }

let work: string
beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'phases-'))
})

function setup(over: Partial<PipelineDeps> = {}, videoInfo: VideoInfo = info()) {
  const stages: Stage[] = []
  const fetches: string[] = []
  let cleanups = 0
  const builds: { sourcePath: string; canvas: { width: number; height: number }; reframe: string }[] = []
  const deps: PipelineDeps = {
    probeVideo: async () => videoInfo,
    ensureH264: async (p, i) => ({ path: p, info: i, converted: false }),
    transcribe: async () => TR,
    detectSilences: async () => [],
    detectSceneCuts: async () => [],
    describeVideo: async () => SUMMARY,
    fetchReference: async (src) => {
      fetches.push(src)
      return { path: '/ref/reference.mp4', info: info({ width: 1080, height: 1920, durationSec: 30 }), origin: 'file', cleanup: async () => void cleanups++ }
    },
    analyzeReference: async () => SPEC,
    interpretRequest,
    trackPeople: async () => ({ width: 1920, height: 1080, samples: [] }),
    proofreadCues: async () => [],
    buildProject: async (b) => {
      builds.push({ sourcePath: b.sourcePath, canvas: b.canvas, reframe: b.reframe })
      return { projectDir: path.join(b.workDir, 'project'), durationSec: 1 }
    },
    renderProject: async (_d, r) => {
      fs.mkdirSync(path.dirname(r.outPath), { recursive: true })
      fs.writeFileSync(r.outPath, 'mp4')
      return { outPath: r.outPath, wallSec: 0.1 }
    },
    runQa: async () => PASS,
    ...over,
  }
  const onStage = (s: Stage) => stages.push(s)
  return { deps, stages, fetches, builds, cleanups: () => cleanups, onStage }
}

const roundTrip = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

describe('analyzeInput', () => {
  test('probe → transcribe → purpose → understand 순서이고, 레퍼런스는 쓰지 않으며, JSON 으로 저장했다 읽어도 같다', async () => {
    const s = setup()
    const a = await analyzeInput({ videoPath: '/in/영상.mp4', workDir: work, description: '골프 레슨 영상입니다', onStage: s.onStage }, s.deps)
    expect(s.stages).toEqual(['probe', 'transcribe', 'purpose', 'understand'])
    expect(s.fetches).toEqual([])
    expect(a).toMatchObject({ version: 1, description: '골프 레슨 영상입니다', sourcePath: '/in/영상.mp4' })
    expect(a.purposeGuess.purpose).toBe('post') // 가로 45초: 점수 −3+2 → post
    expect(a.spec).toBeUndefined()
    expect(roundTrip(a)).toEqual(a)
  })
})

describe('prepareEdit', () => {
  const analyzed = async (s: ReturnType<typeof setup>, description?: string) => analyzeInput({ videoPath: '/in/영상.mp4', workDir: work, description }, s.deps)

  test('레퍼런스만 주면 reference → plan 단계, 한 번 받고 곧바로 cleanup, spec 과 referenceSource 가 채워진다', async () => {
    const s = setup()
    const a = await analyzed(s)
    const p = await prepareEdit({ analysis: a, workDir: work, reference: 'https://youtu.be/abc', purposeChoice: 'auto', onStage: s.onStage }, s.deps)
    expect(s.stages).toEqual(['reference', 'plan'])
    expect(s.fetches).toEqual(['https://youtu.be/abc'])
    expect(s.cleanups()).toBe(1)
    expect(p.referenceSource).toBe('https://youtu.be/abc')
    expect(p.spec).toEqual(SPEC)
    expect(p.planCard[0]).toContain('레퍼런스의 편집 스타일')
    expect(roundTrip(p)).toEqual(p)
  })

  test('knownSpec 을 주면 레퍼런스를 다시 받지 않는다', async () => {
    const s = setup()
    const a = await analyzed(s)
    const p = await prepareEdit({ analysis: a, workDir: work, reference: 'https://youtu.be/abc', knownSpec: SPEC, purposeChoice: 'auto', onStage: s.onStage }, s.deps)
    expect(s.fetches).toEqual([])
    expect(s.stages).toEqual(['plan'])
    expect(p.spec).toEqual(SPEC)
    expect(p.referenceSource).toBe('https://youtu.be/abc')
  })

  test('용도는 여기서 다시 정한다: 자동이면 세로 레퍼런스가 가로 45초 영상을 short 로 기울이고, 사용자가 post 를 고르면 post', async () => {
    const s = setup()
    const a = await analyzed(s)
    const auto = await prepareEdit({ analysis: a, workDir: work, reference: '/ref.mp4', purposeChoice: 'auto' }, s.deps)
    expect(auto.purpose).toBe('short')
    expect(auto.purposeChoice).toBe('auto')
    expect(auto.purposeGuess.purpose).toBe('short')
    const post = await prepareEdit({ analysis: a, workDir: work, reference: '/ref.mp4', purposeChoice: 'post' }, s.deps)
    expect(post.purpose).toBe('post')
    expect(post.purposeChoice).toBe('post')
  })

  test('knownSpec 만 있어도(레퍼런스 파일 정보 없이) 스펙의 방향으로 자동 용도를 판단한다', async () => {
    const s = setup()
    const a = await analyzed(s)
    const p = await prepareEdit({ analysis: a, workDir: work, reference: '/ref.mp4', knownSpec: SPEC, purposeChoice: 'auto' }, s.deps)
    expect(p.purpose).toBe('short')
  })

  test('레퍼런스도 요청도 없으면 카드는 기본 스타일을 말한다', async () => {
    const s = setup()
    const p = await prepareEdit({ analysis: await analyzed(s), workDir: work, purposeChoice: 'auto' }, s.deps)
    expect(p.planCard[0]).toContain('레퍼런스가 없어서 기본 스타일')
    expect(p.spec).toBeUndefined()
    expect(p.referenceSource).toBeUndefined()
  })

  test('analysis 에 spec 이 이미 있으면(runEdit 경로) 레퍼런스를 받지 않고 그것을 쓴다', async () => {
    const s = setup()
    const a: Analysis = { ...(await analyzed(s)), spec: SPEC, referenceInfo: info({ width: 1080, height: 1920 }) }
    const p = await prepareEdit({ analysis: a, workDir: work, purposeChoice: 'auto' }, s.deps)
    expect(s.fetches).toEqual([])
    expect(p.spec).toEqual(SPEC)
    expect(p.purpose).toBe('short')
  })

  test('레퍼런스를 못 받으면 ReferenceFetchError 를 그대로 던진다', async () => {
    const s = setup({
      fetchReference: async () => {
        throw new ReferenceFetchError('private', '비공개 영상이에요')
      },
    })
    const err = await prepareEdit({ analysis: await analyzed(s), workDir: work, reference: 'https://instagram.com/reel/x', purposeChoice: 'auto' }, s.deps).catch((e) => e)
    expect(err).toBeInstanceOf(ReferenceFetchError)
    expect((err as ReferenceFetchError).kind).toBe('private')
  })
})

describe('produceEdit', () => {
  test('저장했다 읽은 analysis·prepared 로도 결과와 report.json 이 나오고, 리포트에 사용자의 용도 선택이 남는다', async () => {
    const s = setup()
    const analysis = roundTrip(await analyzeInput({ videoPath: '/in/영상.mp4', workDir: work }, s.deps))
    const prepared: Prepared = roundTrip(await prepareEdit({ analysis, workDir: work, purposeChoice: 'short' }, s.deps))
    const outDir = path.join(work, 'out')
    const r = await produceEdit({ analysis, prepared, outDir, onStage: s.onStage }, s.deps)
    expect(r).toMatchObject({ delivered: true, purpose: 'short', attempts: 1 })
    expect(fs.readFileSync(path.join(outDir, 'result.mp4'), 'utf8')).toBe('mp4')
    const report = JSON.parse(fs.readFileSync(path.join(outDir, 'report.json'), 'utf8'))
    expect(report.purpose).toMatchObject({ resolved: 'short', userChoice: 'short' })
    expect(report.planCard).toEqual(prepared.planCard)
    expect(s.stages).toEqual(['cuts', 'track', 'build', 'render', 'qa', 'done']) // 가로 원본 → 세로: track 단계 포함
    expect(s.builds[0]).toMatchObject({ sourcePath: '/in/영상.mp4', canvas: { width: 1080, height: 1920 }, reframe: 'track' })
  })

  test('workDir 을 주지 않으면 결과 폴더 안에 자기 작업 폴더를 만들고 끝나면 지운다', async () => {
    const s = setup()
    const analysis = await analyzeInput({ videoPath: '/in/영상.mp4', workDir: work }, s.deps)
    const prepared = await prepareEdit({ analysis, workDir: work, purposeChoice: 'post' }, s.deps)
    const outDir = path.join(work, 'out2')
    await produceEdit({ analysis, prepared, outDir }, s.deps)
    expect(fs.readdirSync(outDir).filter((f) => f.startsWith('.vae-work-'))).toEqual([])
  })
})

describe('runEdit 는 세 단계의 합성', () => {
  test('레퍼런스를 주면 reference 단계가 purpose 보다 먼저, 계획 카드 콜백은 렌더 전에 한 번', async () => {
    const s = setup()
    const cards: string[][] = []
    await runEdit({ videoPath: '/in/영상.mp4', outDir: path.join(work, 'out3'), reference: '/ref.mp4', onStage: s.onStage, onPlan: (c) => cards.push(c) }, s.deps)
    expect(s.stages).toEqual(['probe', 'transcribe', 'reference', 'purpose', 'understand', 'plan', 'cuts', 'track', 'build', 'render', 'qa', 'done'])
    expect(cards).toHaveLength(1)
    expect(cards[0]![0]).toContain('레퍼런스의 편집 스타일')
  })
})
