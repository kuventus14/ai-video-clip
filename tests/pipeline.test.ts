import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { InputError, runEdit, type PipelineDeps, type Stage } from '../src/core/pipeline.ts'
import { ReferenceFetchError } from '../src/core/reference.ts'
import { interpretRequest } from '../src/core/interpret.ts'
import { FEASIBILITY, type StyleSpec } from '../src/core/styleSpec.ts'
import type { BuildInput } from '../src/core/compose.ts'
import type { QaInput, QaReport } from '../src/core/qa.ts'
import type { Finding } from '../src/core/qaChecks.ts'
import type { Transcript, VideoInfo, Word } from '../src/core/types.ts'
import type { VideoSummary } from '../src/core/understand.ts'
import type { PersonTrack } from '../src/core/person.ts'

const info = (over: Partial<VideoInfo> = {}): VideoInfo => ({ path: '/in/영상.mp4', durationSec: 56.8, width: 1080, height: 1920, fps: 30, hasAudio: true, videoBitrate: 2e6, videoCodec: 'h264', rotation: 0, ...over })
const word = (text: string, start: number, confidence = 0.9): Word => ({ text, start, end: start + 0.4, confidence })
const TR: Transcript = {
  language: 'ko',
  durationSec: 56.8,
  hasSpeech: true,
  words: [word('안녕하세요', 1), word('롱아이언', 2), word('팁입니다', 3)],
  segments: [{ text: '안녕하세요 롱아이언 팁입니다', start: 1, end: 3.4 }],
}
const SUMMARY: VideoSummary = { topic: '롱아이언', genre: '골프 레슨', oneLine: '롱아이언 팁', language: 'ko', hasPeople: true, hookTitle: '롱아이언 꿀팁', searchQueries: ['롱아이언 레슨', '백스윙 팁', '아이언 치는 법'], source: 'analyzed' }
const SPEC: StyleSpec = {
  orientation: 'portrait', durationSec: 40, pacing: { shotCount: 9, avgShotLengthSec: 4.4, cutsPerMinute: 12 },
  hook: { endSec: 3, description: '질문 훅' }, captions: { present: true, position: 'bottom', size: 'medium', color: '#FFFFFF', maxCharsPerLine: 14 },
  hookTitle: { present: true, text: '꿀팁' }, transitions: { dominant: 'hard-cut' }, music: { present: false, energy: 'low' }, structure: [], feasibility: { ...FEASIBILITY },
}
const PASS: QaReport = { passed: true, findings: [], corrections: [], checkedAt: '2026-10-20T00:00:00Z' }
const high = (id: string, fixHint: Finding['fixHint']): Finding => ({ id, severity: 'high', message: id, fixHint })
const failing = (...f: Finding[]): QaReport => ({ passed: false, findings: f, corrections: [], checkedAt: '2026-10-20T00:00:00Z' })

interface Rec {
  stages: Stage[]
  transcribeCalls: { prompt?: string }[]
  builds: BuildInput[]
  renders: { quality?: string }[]
  qas: QaInput[]
  trackCalls: string[]
  cleanups: number
}

let work: string
beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-'))
})

function setup(over: Partial<PipelineDeps> = {}, o: { qaQueue?: QaReport[]; videoInfo?: VideoInfo; transcript?: Transcript } = {}) {
  const rec: Rec = { stages: [], transcribeCalls: [], builds: [], renders: [], qas: [], trackCalls: [], cleanups: 0 }
  const qaQueue = [...(o.qaQueue ?? [])]
  const emptyTrack: PersonTrack = { width: 1920, height: 1080, samples: Array.from({ length: 8 }, (_, i) => ({ t: i * 0.25, boxes: [] })) }
  const deps: PipelineDeps = {
    probeVideo: async () => o.videoInfo ?? info(),
    ensureH264: async (p, i) => ({ path: p, info: i, converted: false }),
    transcribe: async (_p, opts) => {
      rec.transcribeCalls.push({ prompt: opts?.prompt })
      return o.transcript ?? TR
    },
    detectSilences: async () => [],
    detectSceneCuts: async () => [],
    describeVideo: async () => SUMMARY,
    fetchReference: async () => ({
      path: '/ref/reference.mp4',
      info: info(),
      origin: 'file',
      cleanup: async () => {
        rec.cleanups++
      },
    }),
    analyzeReference: async () => SPEC,
    interpretRequest,
    trackPeople: async (p) => {
      rec.trackCalls.push(p)
      return emptyTrack
    },
    proofreadCues: async () => [],
    buildProject: async (b) => {
      rec.builds.push(b)
      return { projectDir: path.join(b.workDir, 'project'), durationSec: b.kept.reduce((s, k) => s + k.end - k.start, 0) }
    },
    renderProject: async (_dir, r) => {
      rec.renders.push({ quality: r.quality })
      fs.mkdirSync(path.dirname(r.outPath), { recursive: true })
      fs.writeFileSync(r.outPath, `render-${rec.renders.length}`)
      return { outPath: r.outPath, wallSec: 0.1 }
    },
    enhanceVoice: async (v) => v.outPath,
    runQa: async (q) => {
      rec.qas.push(q)
      return qaQueue.shift() ?? PASS
    },
    ...over,
  }
  const run = (opts: Partial<Parameters<typeof runEdit>[0]> = {}) =>
    runEdit({ videoPath: '/in/영상.mp4', outDir: path.join(work, 'out'), onStage: (s) => rec.stages.push(s), ...opts }, deps)
  return { rec, run, deps }
}

describe('runEdit — 흐름', () => {
  test('(a) 세로 영상(크롭 없음)의 단계 순서와 산출물', async () => {
    const { rec, run } = setup()
    const r = await run()
    expect(rec.stages).toEqual(['probe', 'transcribe', 'purpose', 'understand', 'plan', 'cuts', 'build', 'render', 'qa', 'done'])
    expect(r.delivered).toBe(true)
    expect(r.purpose).toBe('short')
    expect(r.attempts).toBe(1)
    expect(fs.readFileSync(r.resultPath, 'utf8')).toBe('render-1')
    expect(r.resultPath).toBe(path.join(work, 'out', 'result.mp4'))
    expect(rec.builds[0]!.canvas).toEqual({ width: 1080, height: 1920 })
    expect(rec.builds[0]!.reframe).toBe('none')
  })

  test('가로 원본 + 세로 용도는 사람 인식 단계(track)를 거친다', async () => {
    const { rec, run } = setup({}, { videoInfo: info({ width: 1920, height: 1080, durationSec: 30 }) })
    await run({ purpose: 'short' })
    expect(rec.stages).toEqual(['probe', 'transcribe', 'purpose', 'understand', 'plan', 'cuts', 'track', 'build', 'render', 'qa', 'done'])
    expect(rec.builds[0]!.reframe).toBe('track')
    expect(rec.trackCalls).toEqual(['/in/영상.mp4'])
    expect(rec.builds[0]!.crop?.length).toBeGreaterThan(0)
  })

  test('(g) purpose 를 post 로 정하면 자동 인식이 short 여도 1920x1080', async () => {
    const { rec, run } = setup()
    const r = await run({ purpose: 'post' })
    expect(r.purpose).toBe('post')
    expect(rec.builds[0]!.canvas).toEqual({ width: 1920, height: 1080 })
  })

  test('(n) 세로 원본을 가로로 만들면 blur-fill 이고 계획 카드에 블러 안내가 있다', async () => {
    const { rec, run } = setup()
    const r = await run({ purpose: 'post' })
    expect(rec.builds[0]!.reframe).toBe('blur-fill')
    expect(r.planCard.join('\n')).toContain('블러')
  })

  test('(m) 사람이 없는 가로 영상을 세로로 자르면 중앙 크롭 경고가 결과에 남는다', async () => {
    const { run } = setup({}, { videoInfo: info({ width: 1920, height: 1080, durationSec: 30 }) })
    const r = await run({ purpose: 'short' })
    expect(r.qa.findings.some((f) => f.id === 'crop-no-person')).toBe(true)
    expect(r.planCard.join('\n')).toMatch(/확대/)
  })

  test('onPlan 은 렌더 전에 "이렇게 이해했어요" 카드와 용도를 알려 준다', async () => {
    const seen: { card: string[]; purpose: string; before: Stage[] }[] = []
    const { rec, run } = setup()
    await run({ onPlan: (card, purpose) => seen.push({ card, purpose, before: [...rec.stages] }) })
    expect(seen).toHaveLength(1)
    expect(seen[0]!.card[0]).toContain('이렇게 이해했어요')
    expect(seen[0]!.purpose).toBe('short')
    expect(seen[0]!.before).not.toContain('build')
  })

  test('레퍼런스도 요청도 없으면 카드는 기본 스타일로 편집한다고 말하고 레퍼런스를 따른다고 하지 않는다', async () => {
    const { run } = setup()
    const r = await run()
    const card = r.planCard.join('\n')
    expect(r.planCard[0]).toContain('레퍼런스가 없어서 기본 스타일')
    expect(card).not.toContain('레퍼런스의 편집 스타일')
    expect(card).toMatch(/자막/)
    expect(card).toMatch(/컷/)
  })

  test('레퍼런스가 있으면 레퍼런스를 따른다는 카드가 나온다', async () => {
    const { run } = setup()
    const r = await run({ reference: '/ref.mp4' })
    expect(r.planCard[0]).toContain('레퍼런스의 편집 스타일')
  })

  test('(l) report.json 을 남긴다', async () => {
    const { run } = setup()
    const r = await run()
    const report = JSON.parse(fs.readFileSync(path.join(work, 'out', 'report.json'), 'utf8'))
    expect(report).toMatchObject({ purpose: { resolved: 'short' }, attempts: 1, reframe: 'none' })
    expect(report.planCard).toEqual(r.planCard)
    expect(report.qa.passed).toBe(true)
    expect(report.summary.genre).toBe('골프 레슨')
  })

  const workDirs = (dir: string) => fs.readdirSync(dir).filter((f) => f.startsWith('.vae-work-'))

  test('(p) 작업 폴더는 끝나면 지우고, keepWork 면 남긴다', async () => {
    await setup().run()
    expect(workDirs(path.join(work, 'out'))).toEqual([])
    const kept = setup()
    await kept.run({ outDir: path.join(work, 'out2'), keepWork: true })
    expect(workDirs(path.join(work, 'out2'))).toHaveLength(1)
  })

  test('(C1) --out 폴더에 원래 있던 work 폴더와 파일은 건드리지 않는다 (성공·실패 모두)', async () => {
    const out = path.join(work, 'out-existing')
    fs.mkdirSync(path.join(out, 'work'), { recursive: true })
    fs.writeFileSync(path.join(out, 'work', 'notes.txt'), '소중한 파일')
    await setup().run({ outDir: out })
    expect(fs.readFileSync(path.join(out, 'work', 'notes.txt'), 'utf8')).toBe('소중한 파일')
    await setup({}, { videoInfo: info({ durationSec: 700 }) }).run({ outDir: out }).catch(() => {})
    expect(fs.readFileSync(path.join(out, 'work', 'notes.txt'), 'utf8')).toBe('소중한 파일')
  })

  test('(I1) 장면 전환 감지는 원본 전체 길이를 본다 (기본 180초 한계에 걸리지 않게)', async () => {
    const calls: { maxSec?: number }[] = []
    const { run } = setup({ detectSceneCuts: async (_p, o) => (calls.push(o ?? {}), []) }, { videoInfo: info({ width: 1920, height: 1080, durationSec: 400 }) })
    await run({ purpose: 'short' })
    expect(calls[0]!.maxSec).toBeGreaterThanOrEqual(400)
  })

  test('(I8) 검수에 용도·원본 경로·남은 구간을 넘기고, report.json 에 검수하지 않은 항목을 남긴다', async () => {
    const { rec, run } = setup()
    await run()
    expect(rec.qas[0]!.purpose).toBe('short')
    expect(rec.qas[0]!.sourcePath).toBe('/in/영상.mp4')
    expect(rec.qas[0]!.kept).toEqual([{ start: 0, end: 56.8 }])
    const report = JSON.parse(fs.readFileSync(path.join(work, 'out', 'report.json'), 'utf8'))
    expect(report.unchecked.length).toBeGreaterThan(0)
    expect(report.unchecked.join(' ')).toContain('재전사')
  })

  test('(I8) 크롭이 계속 왔다 갔다 하면 crop-jitter 경고를 남긴다', async () => {
    const flip: PersonTrack = {
      width: 1920,
      height: 1080,
      samples: Array.from({ length: 60 }, (_, i) => ({ t: i * 0.25, boxes: [{ x: i % 2 ? 0.7 : 0.1, y: 0.2, w: 0.1, h: 0.5, confidence: 0.9, kind: 'human' as const }] })),
    }
    const { run } = setup({ trackPeople: async () => flip }, { videoInfo: info({ width: 1920, height: 1080, durationSec: 15 }) })
    const r = await run({ purpose: 'short' })
    expect(r.qa.findings.some((f) => f.id === 'crop-jitter')).toBe(true)
  })

  test('원본이 H.264 mp4 가 아니어서 변환되면 normalize 단계를 거치고 변환본으로 작업한다', async () => {
    const { rec, run } = setup({ ensureH264: async (_p, i) => ({ path: '/work/source-h264.mp4', info: { ...i, videoCodec: 'h264' }, converted: true }) })
    await run()
    expect(rec.stages.slice(0, 3)).toEqual(['probe', 'normalize', 'transcribe'])
    expect(rec.builds[0]!.sourcePath).toBe('/work/source-h264.mp4')
  })
})

describe('runEdit — 입력 검증', () => {
  test('(f) 700초는 too-long, 0.5초는 too-short, 못 읽으면 unreadable', async () => {
    const long = await setup({}, { videoInfo: info({ durationSec: 700 }) }).run().catch((e) => e)
    expect(long).toBeInstanceOf(InputError)
    expect((long as InputError).kind).toBe('too-long')
    const short = await setup({}, { videoInfo: info({ durationSec: 0.5 }) }).run().catch((e) => e)
    expect((short as InputError).kind).toBe('too-short')
    const bad = await setup({ probeVideo: async () => { throw new Error('ffprobe 실패') } }).run().catch((e) => e)
    expect((bad as InputError).kind).toBe('unreadable')
  })
})

describe('runEdit — 레퍼런스', () => {
  test('(d) 분석이 끝나면 곧바로 cleanup, 이후 단계에서는 레퍼런스 파일이 없다', async () => {
    const order: string[] = []
    const { rec, run } = setup({
      fetchReference: async () => ({ path: '/r/reference.mp4', info: info(), origin: 'file', cleanup: async () => void order.push('cleanup') }),
      analyzeReference: async () => (order.push('analyze'), SPEC),
      interpretRequest: async (i) => (order.push('plan'), interpretRequest(i)),
    })
    await run({ reference: '/some/ref.mp4' })
    expect(order).toEqual(['analyze', 'cleanup', 'plan'])
    expect(rec.stages).toContain('reference')
  })

  test('분석 중 오류가 나도 cleanup 한다', async () => {
    const { rec, run } = setup({ analyzeReference: async () => { throw new Error('분석 실패') } })
    await expect(run({ reference: '/r.mp4' })).rejects.toThrow('분석 실패')
    expect(rec.cleanups).toBe(1)
  })

  test('(e) 레퍼런스를 못 받으면 같은 오류로 중단하고 편집은 시작하지 않는다', async () => {
    const { rec, run } = setup({ fetchReference: async () => { throw new ReferenceFetchError('private', '비공개 영상이에요') } })
    const err = await run({ reference: 'https://www.instagram.com/reel/x/' }).catch((e) => e)
    expect(err).toBeInstanceOf(ReferenceFetchError)
    expect((err as ReferenceFetchError).kind).toBe('private')
    expect(rec.builds).toHaveLength(0)
  })

  test('레퍼런스가 세로면 가로 영상도 short 로 기운다 (용도 인식에 레퍼런스 사용)', async () => {
    const { run } = setup({}, { videoInfo: info({ width: 1920, height: 1080, durationSec: 45 }) })
    const r = await run({ reference: '/ref.mp4' })
    expect(r.purpose).toBe('short')
  })
})

describe('runEdit — 재작업', () => {
  test('(b) 1차 검수가 high+recaption(교정 제안 포함)이면 교정을 반영해 한 번 더 만들고 통과한다', async () => {
    const q1: QaReport = { ...failing(high('cue-overlap', 'recaption')), corrections: [{ index: 0, text: '안녕하세요 롱아이언', reason: 'term' }] }
    const { rec, run } = setup({}, { qaQueue: [q1, PASS] })
    const r = await run()
    expect(r.attempts).toBe(2)
    expect(rec.builds).toHaveLength(2)
    expect(rec.builds[0]!.cues[0]!.text).not.toBe('안녕하세요 롱아이언')
    expect(rec.builds[1]!.cues[0]!.text).toBe('안녕하세요 롱아이언')
    expect(rec.stages).toContain('rework')
    expect(r.qa.passed).toBe(true)
  })

  test('(c) 계속 high(조치 가능)이면 최초 + 재작업 2회에서 멈추고 문제를 남긴 채 전달한다', async () => {
    const bad = failing(high('cue-overlap', 'recaption'))
    const { rec, run } = setup({}, { qaQueue: [bad, bad, bad, bad] })
    const r = await run()
    expect(r.attempts).toBe(3)
    expect(r.delivered).toBe(true)
    expect(r.qa.passed).toBe(false)
    expect(rec.builds).toHaveLength(3)
    expect(fs.readFileSync(r.resultPath, 'utf8')).toBe('render-3')
  })

  test('(I4) 화질 재작업은 looks → delivery 로 한 번 올리고, 이미 최고 화질이면 더 하지 않는다', async () => {
    const bad = failing(high('black-frames', 'rerender-quality'))
    const up = setup({}, { qaQueue: [bad, bad, bad] })
    const r = await up.run()
    expect(up.rec.renders.map((x) => x.quality)).toEqual(['looks', 'delivery'])
    expect(r.attempts).toBe(2)
    const max = setup({}, { qaQueue: [bad] })
    const r2 = await max.run({ quality: 'delivery', outDir: path.join(work, 'out-max') })
    expect(r2.attempts).toBe(1)
    expect(max.rec.renders).toHaveLength(1)
  })

  test('(I5) 원문과 너무 다른 교정은 자동 적용하지 않고 제안으로만 남긴다', async () => {
    const wild = { index: 0, text: '완전히 다른 문장이에요 정말로 그래요', reason: 'typo' as const }
    const { rec, run } = setup({ proofreadCues: async () => [wild] })
    const r = await run()
    expect(rec.builds[0]!.cues[0]!.text).toBe('안녕하세요 롱아이언 팁입니다')
    expect(r.appliedCorrections).toEqual([])
    expect(r.suggestions).toEqual([{ ...wild, original: '안녕하세요 롱아이언 팁입니다' }])
    expect(r.qa.findings.some((f) => f.id === 'caption-suggestion' && f.severity === 'info')).toBe(true)
    const report = JSON.parse(fs.readFileSync(path.join(work, 'out', 'report.json'), 'utf8'))
    expect(report.suggestions).toEqual([{ ...wild, original: '안녕하세요 롱아이언 팁입니다' }])
  })

  test('(I5) 검수가 매번 교정을 내놓아도 교정 때문에 도는 재작업은 1회뿐이다', async () => {
    const mk = (text: string): QaReport => ({ passed: true, findings: [], corrections: [{ index: 0, text, reason: 'spacing' }], checkedAt: 'x' })
    const c2 = mk('안녕하세요 롱아이언 팁입니다?')
    const { rec, run } = setup({}, { qaQueue: [mk('안녕하세요 롱아이언 팁입니다!'), c2, PASS] })
    const r = await run()
    expect(r.attempts).toBe(2)
    expect(rec.builds).toHaveLength(2)
    expect(r.suggestions).toContainEqual({ ...c2.corrections[0]!, original: expect.any(String) })
  })

  test('(M4) 렌더 전 교정 호출이 실패해도 편집은 계속하고 리포트에 알린다', async () => {
    const { run } = setup({ proofreadCues: async () => { throw new Error('사용량 제한') } })
    const r = await run()
    expect(r.delivered).toBe(true)
    expect(r.qa.findings.some((f) => f.id === 'proofread-failed' && f.severity === 'info')).toBe(true)
  })

  test('(M3) 이미 교정을 적용했다면 recaption 재묶기로 그 교정을 되돌리지 않는다', async () => {
    const fix = { index: 0, text: '안녕하세요 롱아이언 팁입니다!', reason: 'spacing' as const }
    const { rec, run } = setup({ proofreadCues: async () => [fix] }, { qaQueue: [failing(high('cue-overlap', 'recaption'))] })
    const r = await run()
    expect(r.attempts).toBe(1)
    expect(rec.builds[0]!.cues[0]!.text).toBe('안녕하세요 롱아이언 팁입니다!')
    expect(r.appliedCorrections).toEqual([{ ...fix, original: '안녕하세요 롱아이언 팁입니다' }])
  })

  test('(I6) 요청 해석에는 레퍼런스가 있는지 알린다', async () => {
    const seen: (boolean | undefined)[] = []
    const empty = { mode: 'targeted' as const, take: [], skip: [], adjust: [], unsupported: [] }
    const { run } = setup({ interpretRequest: async (i) => (seen.push(i.hasReference), empty) })
    await run({ request: '컷을 더 빠르게' })
    await run({ request: '컷을 더 빠르게', reference: '/ref.mp4', outDir: path.join(work, 'out-ref') })
    expect(seen).toEqual([false, true])
  })

  test('조치할 수 없는 high(fixHint none)만 있으면 재작업 없이 그대로 전달한다', async () => {
    const { rec, run } = setup({}, { qaQueue: [failing(high('upscale', 'none'))] })
    const r = await run()
    expect(r.attempts).toBe(1)
    expect(rec.builds).toHaveLength(1)
    expect(r.qa.passed).toBe(false)
  })

  test('recrop 이면 평활을 강하게 해 크롭을 다시 계산한다 (키프레임이 달라진다)', async () => {
    const wobble: PersonTrack = { width: 1920, height: 1080, samples: Array.from({ length: 40 }, (_, i) => ({ t: i * 0.25, boxes: [{ x: i < 20 ? 0.2 : 0.6, y: 0.2, w: 0.1, h: 0.5, confidence: 0.9, kind: 'human' as const }] })) }
    const { rec, run } = setup({ trackPeople: async () => wobble }, { videoInfo: info({ width: 1920, height: 1080, durationSec: 10 }), qaQueue: [failing(high('framing', 'recrop')), PASS] })
    await run({ purpose: 'short' })
    expect(rec.builds).toHaveLength(2)
    expect(JSON.stringify(rec.builds[1]!.crop)).not.toBe(JSON.stringify(rec.builds[0]!.crop))
  })

  test('재작업에서 교정만 남아 있어도(high 없음) 교정을 적용해 다시 만든다', async () => {
    const fix = { index: 0, text: '안녕하세요 롱아이언 팁입니다!', reason: 'typo' as const }
    const q1: QaReport = { passed: true, findings: [], corrections: [fix], checkedAt: 'x' }
    const { rec, run } = setup({}, { qaQueue: [q1, PASS] })
    const r = await run()
    expect(r.attempts).toBe(2)
    expect(rec.builds[1]!.cues[0]!.text).toBe('안녕하세요 롱아이언 팁입니다!')
    expect(r.appliedCorrections).toContainEqual({ ...fix, original: '안녕하세요 롱아이언 팁입니다' })
  })
})

describe('runEdit — 자막과 음성', () => {
  test('(h) 오디오가 없는 입력도 전달되고 자막 큐는 0개, 검수에는 빈 단어가 간다', async () => {
    const silentTr: Transcript = { language: 'ko', durationSec: 10, words: [], segments: [], hasSpeech: false }
    const { rec, run } = setup({}, { videoInfo: info({ hasAudio: false, durationSec: 10 }), transcript: silentTr })
    const r = await run()
    expect(r.delivered).toBe(true)
    expect(rec.builds[0]!.cues).toEqual([])
    expect(rec.qas[0]!.words).toEqual([])
    expect(rec.builds[0]!.kept).toEqual([{ start: 0, end: 10 }])
  })

  test('(i) captions off 면 큐를 만들지 않고 검수에 skipCaptions 를 알린다', async () => {
    const { rec, run } = setup()
    await run({ captions: 'off' })
    expect(rec.builds[0]!.cues).toEqual([])
    expect(rec.qas[0]!.skipCaptions).toBe(true)
  })

  test('(j) 렌더 전에 자막을 교정하고, 적용한 교정을 결과에 남긴다', async () => {
    const { rec, run } = setup({ proofreadCues: async () => [{ index: 0, text: '안녕하세요 롱아이언', reason: 'term' }] })
    const r = await run()
    expect(rec.builds[0]!.cues[0]!.text).toBe('안녕하세요 롱아이언')
    expect(r.appliedCorrections).toEqual([{ index: 0, text: '안녕하세요 롱아이언', reason: 'term', original: '안녕하세요 롱아이언 팁입니다' }])
  })

  test('컷 이후의 출력 시간으로 자막과 구간이 넘어간다 (무음 제거)', async () => {
    const { rec, run } = setup({ detectSilences: async () => [{ start: 10, end: 20 }] })
    await run()
    const b = rec.builds[0]!
    expect(b.kept).toHaveLength(2)
    expect(b.kept[0]!.end).toBeCloseTo(10.2, 2) // 레퍼런스 없는 기본 스타일(분당 12컷)의 여백은 0.2초
    expect(b.kept[1]!.start).toBeCloseTo(19.8, 2)
    expect(b.cues[0]!.start).toBeCloseTo(1, 2)
  })
})

describe('runEdit — 전사 용어 힌트', () => {
  const lowTr: Transcript = { ...TR, words: Array.from({ length: 8 }, (_, i) => word(`말${i}`, i, 0.2)), segments: [{ text: '말 말 말', start: 0, end: 8 }] }

  test('설명이 있으면 처음부터 설명을 용어 힌트로 한 번만 전사한다', async () => {
    const { rec, run } = setup()
    await run({ description: '골프 롱아이언 레슨 영상입니다' })
    expect(rec.transcribeCalls).toEqual([{ prompt: '골프 롱아이언 레슨 영상입니다' }])
  })

  test('설명이 없고 저신뢰 단어가 5개 이상이면 요약의 용어로 한 번 더 전사한다', async () => {
    const { rec, run } = setup({}, { transcript: lowTr })
    await run()
    expect(rec.transcribeCalls).toHaveLength(2)
    expect(rec.transcribeCalls[0]!.prompt).toBeUndefined()
    expect(rec.transcribeCalls[1]!.prompt).toContain('롱아이언')
    expect(rec.transcribeCalls[1]!.prompt).toContain('골프 레슨')
    expect(rec.stages.filter((s) => s === 'transcribe')).toHaveLength(2)
  })

  test('저신뢰 단어가 적으면 다시 전사하지 않는다', async () => {
    const { rec, run } = setup()
    await run()
    expect(rec.transcribeCalls).toHaveLength(1)
  })
})
