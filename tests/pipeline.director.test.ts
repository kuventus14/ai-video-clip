import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import type { BuildInput } from '../src/core/compose.ts'
import { interpretRequest } from '../src/core/interpret.ts'
import { applyTranscriptEdits } from '../src/shared/captionReview.ts'
import { LlmError } from '../src/core/llm.ts'
import { analyzeInput, prepareEdit, produceEdit, type PipelineDeps, type Stage } from '../src/core/pipeline.ts'
import { noBalance, recipeOf } from './helpers/soundFakes.ts'
import type { QaInput, QaReport } from '../src/core/qa.ts'
import { emptyScript, type EditScript } from '../src/core/script.ts'
import { FEASIBILITY, type StyleSpec } from '../src/core/styleSpec.ts'
import type { Transcript, VideoInfo, Word } from '../src/core/types.ts'
import type { VideoSummary } from '../src/core/understand.ts'

const info = (over: Partial<VideoInfo> = {}): VideoInfo => ({ path: '/in/영상.mp4', durationSec: 45, width: 1920, height: 1080, fps: 30, hasAudio: true, videoBitrate: 2e6, videoCodec: 'h264', rotation: 0, ...over })
const word = (text: string, start: number): Word => ({ text, start, end: start + 0.4, confidence: 0.9 })
const TR: Transcript = { language: 'ko', durationSec: 45, hasSpeech: true, words: [word('안녕하세요', 1), word('롱아이언', 2), word('팁입니다', 30)], segments: [{ text: '안녕하세요 롱아이언', start: 1, end: 2.4 }] }
const SUMMARY: VideoSummary = { topic: '롱아이언', genre: '골프 레슨', oneLine: '롱아이언 팁', language: 'ko', hasPeople: true, hookTitle: '롱아이언 꿀팁', searchQueries: ['a', 'b', 'c'], source: 'analyzed' }
const SPEC: StyleSpec = {
  orientation: 'portrait', durationSec: 40, pacing: { shotCount: 9, avgShotLengthSec: 4.4, cutsPerMinute: 12 },
  hook: { endSec: 3, description: '훅' }, captions: { present: true, position: 'bottom', size: 'medium', color: '#FFFFFF', maxCharsPerLine: 14 },
  hookTitle: { present: true, text: '꿀팁' }, transitions: { dominant: 'hard-cut' }, music: { present: false, energy: 'low' }, structure: ['훅', '설명'], feasibility: { ...FEASIBILITY },
}
const PASS: QaReport = { passed: true, findings: [], corrections: [], checkedAt: '2026-10-22T00:00:00Z' }
const SCRIPT: EditScript = {
  ...emptyScript('프로님의 롱아이언 꿀팁'),
  hook: { sourceStart: 30, sourceEnd: 33, question: '왜 나만 안 맞을까?' },
  openingLines: ['롱아이언 실전편'],
  sections: [{ atSec: 5, label: '여기서 포인트!' }],
  questions: [{ atSec: 20, text: '질문?' }],
  reactions: [{ atSec: 40, text: '와!' }],
  emphasis: ['롱아이언'],
  speed: 1.1,
}

let work: string
beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'pipe-dir-'))
})

function setup(over: Partial<PipelineDeps> = {}, videoInfo: VideoInfo = info()) {
  const stages: Stage[] = []
  const builds: BuildInput[] = []
  const qas: QaInput[] = []
  const tempos: { inputPath: string; outPath: string; speed: number; hasAudio: boolean }[] = []
  const sounds: Parameters<PipelineDeps['applySound']>[0][] = []
  const directs: Parameters<NonNullable<PipelineDeps['directEdit']>>[0][] = []
  const extracts: { refPath: string; outDir: string }[] = []
  const deps: PipelineDeps = {
    probeVideo: async () => videoInfo,
    ensureH264: async (p, i) => ({ path: p, info: i, converted: false }),
    transcribe: async () => TR,
    detectSilences: async () => [],
    detectSceneCuts: async () => [],
    describeVideo: async () => SUMMARY,
    fetchReference: async () => ({ path: '/ref/reference.mp4', info: info({ width: 1080, height: 1920, durationSec: 30 }), origin: 'file', cleanup: async () => {} }),
    analyzeReference: async () => SPEC,
    interpretRequest,
    trackPeople: async () => ({ width: 1920, height: 1080, samples: [] }),
    proofreadCues: async () => [],
    buildProject: async (b) => {
      builds.push(b)
      return { projectDir: path.join(b.workDir, 'project'), durationSec: b.kept.reduce((s, k) => s + k.end - k.start, 0) }
    },
    renderProject: async (_d, r) => {
      fs.mkdirSync(path.dirname(r.outPath), { recursive: true })
      fs.writeFileSync(r.outPath, 'mp4')
      return { outPath: r.outPath, wallSec: 0.1 }
    },
    runQa: async (q) => (qas.push(q), PASS),
    enhanceVoice: async (v) => v.outPath,
    applySound: async (a) => (sounds.push(a), fs.writeFileSync(a.outPath, 'mixed'), { path: a.outPath, report: { sfxCount: 0 }, recipe: recipeOf(a) }),
    balanceSound: noBalance,
    directEdit: async (x) => (directs.push(x), { script: SCRIPT, notes: [] }),
    extractReferenceFrames: async (refPath, _d, outDir) => {
      extracts.push({ refPath, outDir })
      fs.mkdirSync(outDir, { recursive: true })
      fs.writeFileSync(path.join(outDir, 'frame-00.jpg'), 'jpg')
      return [path.join(outDir, 'frame-00.jpg')]
    },
    applyTempo: async (t) => (tempos.push(t), fs.writeFileSync(t.outPath, 'fast'), t.outPath),
    detectContentRect: undefined, // 검은 띠 제거는 tests/pipeline.test.ts 에서 확인한다
    cropToContent: undefined,
    ...over,
  }
  return { deps, stages, builds, qas, tempos, sounds, directs, extracts, onStage: (s: Stage) => stages.push(s) }
}

async function prepare(s: ReturnType<typeof setup>, reference?: string) {
  const analysis = await analyzeInput({ videoPath: '/in/영상.mp4', workDir: work }, s.deps) // 앱처럼: 분석 때는 레퍼런스를 모른다
  const prepared = await prepareEdit({ analysis, workDir: work, purposeChoice: 'short', reference, onStage: s.onStage }, s.deps)
  return { analysis, prepared }
}

describe('prepareEdit — 편집 감독', () => {
  test('대본이 Prepared.script 로 저장되고, 계획 다음에 direct 단계가 있고, 카드에 편집 구성 줄이 생긴다', async () => {
    const s = setup()
    const { prepared } = await prepare(s)
    expect(prepared.script?.title).toBe('프로님의 롱아이언 꿀팁')
    expect(s.stages).toEqual(['plan', 'direct'])
    expect(prepared.planCard.join('\n')).toMatch(/• 후킹: 원본 30\.0초부터 3\.0초 장면을 맨 앞에/)
    expect(prepared.planCard.join('\n')).toContain('• 소제목: 여기서 포인트!')
  })

  test('레퍼런스를 주면 사진을 <작업 폴더>/ref-frames 에 남기고 감독에게 사진 경로를 준다(원본 레퍼런스는 지금처럼 지운다)', async () => {
    let cleaned = 0
    const s = setup({ fetchReference: async () => ({ path: '/ref/reference.mp4', info: info({ durationSec: 30 }), origin: 'file', cleanup: async () => void cleaned++ }) })
    await prepare(s, 'https://youtu.be/ref')
    expect(s.extracts).toEqual([{ refPath: '/ref/reference.mp4', outDir: path.join(work, 'ref-frames') }])
    expect(cleaned).toBe(1)
    expect(s.directs[0]!.refFrames).toEqual([path.join(work, 'ref-frames', 'frame-00.jpg')])
    expect(s.directs[0]!.spec).toBeDefined()
  })

  test('레퍼런스가 없으면 사진 없이 부른다(예전 레퍼런스 사진이 남아 있어도 쓰지 않는다)', async () => {
    fs.mkdirSync(path.join(work, 'ref-frames'))
    fs.writeFileSync(path.join(work, 'ref-frames', 'old.jpg'), 'x')
    const s = setup()
    await prepare(s)
    expect(s.directs[0]!.refFrames ?? []).toEqual([])
    expect(s.directs[0]!.spec).toBeUndefined()
  })

  test('사진 만들기가 실패해도 분석은 계속되고 감독은 사진 없이 돈다', async () => {
    const s = setup({ extractReferenceFrames: async () => { throw new Error('ffmpeg 오류') } })
    const { prepared } = await prepare(s, 'https://youtu.be/ref')
    expect(prepared.script).toBeDefined()
    expect(s.directs[0]!.refFrames ?? []).toEqual([])
  })

  test('감독이 LlmError 를 던지면 던지지 않고 대본 없이 계속하며 카드에 안내 줄이 생긴다(기본 방식으로 되돌아감)', async () => {
    const s = setup({ directEdit: async () => { throw new LlmError('timeout', '시간 초과') } })
    const { prepared } = await prepare(s)
    expect(prepared.script).toBeUndefined()
    expect(prepared.planCard.join('\n')).toContain('편집 구성을 AI가 짜지 못해서 기본 방식(컷+자막)으로 만들어요')
  })

  test('LlmError 가 아닌 오류도 마찬가지다', async () => {
    const s = setup({ directEdit: async () => { throw new TypeError('버그') } })
    const { prepared } = await prepare(s)
    expect(prepared.script).toBeUndefined()
  })

  test('감독 단계가 없으면(deps.directEdit 없음) 건너뛴다 — direct 단계도 카드 줄도 없다', async () => {
    const s = setup({ directEdit: undefined })
    const { prepared } = await prepare(s)
    expect(prepared.script).toBeUndefined()
    expect(s.stages).toEqual(['plan'])
    expect(prepared.planCard.join('\n')).not.toContain('편집 구성을 AI가')
  })

  test('영상이 10초 이하면 감독이 훅·소제목을 줘도 다시 정리해 제목만 남긴다 (Review Focus 2)', async () => {
    const s = setup({}, info({ durationSec: 8 }))
    const { prepared } = await prepare(s)
    expect(prepared.script?.hook).toBeUndefined()
    expect(prepared.script?.sections).toEqual([])
    expect(prepared.script?.title).toBe('프로님의 롱아이언 꿀팁')
  })

  test('감독이 엉터리 대본(범위 밖 시각)을 줘도 정리돼서 저장된다 (Review Focus 3)', async () => {
    const bad = { ...SCRIPT, hook: { sourceStart: 900, sourceEnd: 903, question: '?' }, sections: [{ atSec: 9999, label: 'x' }] } as EditScript
    const s = setup({ directEdit: async () => ({ script: bad, notes: [] }) })
    const { prepared } = await prepare(s)
    expect(prepared.script?.hook).toBeUndefined()
    expect(prepared.script?.sections).toEqual([])
  })

  test('대본이 없을 때 "영상 구성을 따라 해요" 줄은 빠진다(거짓 약속 방지)', async () => {
    const s = setup({ directEdit: async () => { throw new LlmError('timeout', 'x') } })
    const { prepared } = await prepare(s, 'https://youtu.be/ref')
    expect(prepared.planCard.join('\n')).not.toMatch(/영상 구성/)
  })
})

describe('prepareEdit — 지운 자막 구간을 감독에게 알린다', () => {
  test('deletedSpans 를 directEdit 에 그대로 넘긴다', async () => {
    const s = setup()
    const analysis = await analyzeInput({ videoPath: '/in/영상.mp4', workDir: work }, s.deps)
    await prepareEdit({ analysis, workDir: work, purposeChoice: 'short', deletedSpans: [{ start: 3, end: 5 }] }, s.deps)
    expect(s.directs[0]!.deletedSpans).toEqual([{ start: 3, end: 5 }])
  })
})

describe('produceEdit — 대본대로 만들기', () => {
  async function produce(s: ReturnType<typeof setup>, o: Partial<Parameters<typeof produceEdit>[0]> = {}, prepared?: Awaited<ReturnType<typeof prepare>>) {
    const p = prepared ?? (await prepare(s))
    return produceEdit({ analysis: p.analysis, prepared: p.prepared, outDir: path.join(work, `out-${Math.random().toString(36).slice(2)}`), onStage: s.onStage, ...o }, s.deps)
  }

  test('대본이 없으면 지금 동작 그대로: 훅·tempo 없음, kept 는 컷 결과 그대로', async () => {
    const s = setup({ directEdit: undefined })
    await produce(s)
    expect(s.builds[0]!.kept).toEqual([{ start: 0, end: 45 }])
    expect(s.builds[0]!.script).toBeUndefined()
    expect(s.tempos).toHaveLength(0)
    expect(s.stages).not.toContain('tempo')
  })

  test('훅이 있으면 buildProject 의 kept 앞에 훅 구간이 붙고, 자막은 훅 길이(3초)만큼 밀린다', async () => {
    const s = setup()
    await produce(s)
    expect(s.builds[0]!.kept).toEqual([{ start: 30, end: 33 }, { start: 0, end: 45 }])
    expect(s.builds[0]!.cues[0]!.start).toBeGreaterThanOrEqual(3) // 훅 구간(0~3초)에는 자막이 없다 (Review Focus 1)
    expect(s.builds[0]!.script?.hookSec).toBe(3)
    expect(s.builds[0]!.script?.hook?.question).toBe('왜 나만 안 맞을까?')
  })

  test('자막을 지워도(인식 단어가 빠져도) 컷은 원래 인식 결과 기준이다 — 지운 줄의 구간이 무음으로 잘려 나가지 않는다', async () => {
    const SILENT = [{ start: 29, end: 33 }] // 팁입니다(30~30.4초)가 있던 곳이 조용하다
    const covers = (kept: { start: number; end: number }[]) => kept.some((k) => k.start <= 30 && k.end >= 30.4)
    const edited = (s: ReturnType<typeof setup>, p: Awaited<ReturnType<typeof prepare>>) => ({ ...p, analysis: { ...p.analysis, transcript: { ...TR, words: TR.words.slice(0, 2) } } }) // 사용자가 마지막 줄을 지웠다

    const without = setup({ directEdit: undefined, detectSilences: async () => SILENT })
    await produce(without, {}, edited(without, await prepare(without)))
    expect(covers(without.builds[0]!.kept)).toBe(false) // (대조) 원래 기준이 아니면 그 구간이 잘린다

    const withOriginal = setup({ directEdit: undefined, detectSilences: async () => SILENT })
    await produce(withOriginal, { cutTranscript: TR }, edited(withOriginal, await prepare(withOriginal)))
    expect(covers(withOriginal.builds[0]!.kept)).toBe(true)
    // 자막은 고친(지운) 결과를 따른다: 지운 단어는 자막에 없다
    expect(withOriginal.builds[0]!.cues.map((c) => c.text).join(' ')).not.toContain('팁입니다')
  })

  test('(C2) 고친 줄 안의 쉬는 구간을 컷이 잘라도 고친 단어가 최종 자막에서 하나도 빠지지 않는다', async () => {
    // 한 줄(1~3.45초): 손목을(~1.9) 뒤 0.65초 쉬고 해네도(2.55~)가 이어진다
    const RAW: Transcript = { language: 'ko', durationSec: 45, hasSpeech: true, words: [word('그러니까', 1), word('손목을', 1.5), word('해네도', 2.55), word('하면', 3.05)], segments: [] }
    const EDIT = '그러니까 손목을 이렇게 펴서 백스윙 하면'
    const s = setup({ directEdit: undefined, detectSilences: async () => [{ start: 1.8, end: 2.65 }] }) // 말 사이 쉬는 구간(1.9~2.55)이 2.0~2.45 로 잘린다
    const p = await prepare(s)
    const edited = applyTranscriptEdits(RAW, [{ i: 0, text: EDIT }])
    await produce(s, { cutTranscript: RAW }, { ...p, analysis: { ...p.analysis, transcript: edited } })
    const cues = s.builds[0]!.cues.map((c) => c.text).join(' ')
    for (const token of EDIT.split(' ')) expect(cues, token).toContain(token)
  })

  test('(I1) 자막을 다 지워도(편집된 인식 결과에 말이 없어도) 배경음악은 원래 인식 결과로 말이 있는 영상으로 계산한다', async () => {
    const s = setup({ directEdit: undefined })
    const p = await prepare(s)
    const allDeleted = { ...p, analysis: { ...p.analysis, transcript: { ...TR, words: [], segments: [], hasSpeech: false } } }
    await produce(s, { cutTranscript: TR, bgm: 'calm-1' }, allDeleted)
    expect(s.sounds[0]!.hasSpeech).toBe(true)
  })

  test('훅이 영상 맨 앞(0.5~3.5초)에서 오면 같은 장면을 연달아 두 번 붙이지 않는다 — 질문은 본편 첫머리 위에 띄운다', async () => {
    const early: EditScript = { ...SCRIPT, hook: { sourceStart: 0.5, sourceEnd: 3.5, question: '왜 나만 안 맞을까?' } }
    const s = setup({ directEdit: async () => ({ script: early, notes: [] }) })
    await produce(s)
    expect(s.builds[0]!.kept).toEqual([{ start: 0, end: 45 }]) // 훅 구간이 앞에 붙지 않는다
    expect(s.builds[0]!.script?.hook).toMatchObject({ sec: 3, question: '왜 나만 안 맞을까?' }) // 질문은 남는다
    expect(s.builds[0]!.script?.sections[0]).toMatchObject({ start: 5 }) // 시각도 밀리지 않는다
    expect(s.builds[0]!.cues[0]!.start).toBeLessThan(3) // 자막도 밀리지 않는다
  })

  test('훅 구간과 겹치는 단어("팁입니다" 30초)가 본편에서만 자막이 된다 — 두 번 나오지 않는다 (Review Focus 1)', async () => {
    const s = setup()
    await produce(s)
    const texts = s.builds[0]!.cues.map((c) => c.text).join(' ')
    expect(texts.match(/팁입니다/g)).toHaveLength(1)
  })

  test('대본의 시각은 훅 길이만큼 밀려서 그림 대본이 된다(소제목 5초 → 8초)', async () => {
    const s = setup()
    await produce(s)
    expect(s.builds[0]!.script?.sections[0]).toMatchObject({ start: 8, label: '여기서 포인트!' })
    expect(s.builds[0]!.script?.questions[0]!.start).toBe(23)
  })

  test('옛 제목 카드(style.hookTitle)는 대본이 있으면 쓰지 않는다', async () => {
    const s = setup()
    await produce(s)
    expect(s.builds[0]!.style.hookTitle).toBeUndefined()
  })

  test('drop 구간은 남은 구간에서 빠진다(10~20초)', async () => {
    const s = setup({ directEdit: async () => ({ script: { ...SCRIPT, hook: undefined, drop: [{ start: 10, end: 20 }] }, notes: [] }) })
    await produce(s)
    expect(s.builds[0]!.kept).toEqual([{ start: 0, end: 10 }, { start: 20, end: 45 }])
  })

  test('drop 이 모든 구간을 지워 버리면 drop 을 쓰지 않는다(빈 영상 방지)', async () => {
    const s = setup({ directEdit: async () => ({ script: { ...SCRIPT, hook: undefined, drop: [{ start: 0, end: 45 }] }, notes: [] }) })
    await produce(s)
    expect(s.builds[0]!.kept.length).toBeGreaterThan(0)
  })

  test('speed 1.1 이면 렌더 다음·검수(소리) 앞에 tempo 단계가 있고 applyTempo 가 렌더 결과를 입력으로 받는다 (Review Focus 5)', async () => {
    const s = setup()
    await produce(s, { bgm: 'calm-1' })
    expect(s.stages.slice(s.stages.indexOf('cuts'))).toEqual(['cuts', 'build', 'render', 'tempo', 'mix', 'qa', 'done']) // 가로 원본 → 세로: 자르지 않으니 track 없음
    expect(s.tempos[0]).toMatchObject({ speed: 1.1, hasAudio: true })
    expect(path.basename(s.tempos[0]!.inputPath)).toBe('render-1.mp4')
  })

  test('검수에는 속도를 적용한 뒤의 시각을 준다: 자막 끝 ≤ 결과 길이(총 길이 / 1.1), 훅 길이 반영', async () => {
    const s = setup()
    await produce(s)
    const q = s.qas[0]!
    const total = (3 + 45) / 1.1 // 훅 3초 + 본편 45초
    expect(q.cues.length).toBeGreaterThan(0)
    for (const c of q.cues) expect(c.end).toBeLessThanOrEqual(total + 1e-6)
    expect(q.cues[0]!.start).toBeCloseTo((3 + 1) / 1.1, 1) // 본편 1초 자막 → (훅 3 + 1) / 1.1
    expect(path.basename(q.outputPath)).toBe('tempo-1.mp4')
  })

  test('speed 1 이면 applyTempo 를 부르지 않는다', async () => {
    const s = setup({ directEdit: async () => ({ script: { ...SCRIPT, speed: 1 }, notes: [] }) })
    await produce(s)
    expect(s.tempos).toHaveLength(0)
    expect(s.stages).not.toContain('tempo')
  })

  test('소리 입히기에는 훅이 앞에 붙은 구간·속도 적용 후 길이·속도를 넘긴다(효과음 위치가 어긋나지 않게)', async () => {
    const s = setup()
    await produce(s, { bgm: 'calm-1', sfx: 'on' })
    const a = s.sounds[0]!
    expect(a.kept).toEqual([{ start: 30, end: 33 }, { start: 0, end: 45 }])
    expect(a.speed).toBe(1.1)
    expect(a.durationSec).toBeCloseTo(48 / 1.1, 3)
    expect(a.hookTitle).toBe(true)
  })

  test('검수 재작업으로 다시 렌더하면 tempo 도 다시 한다(시도마다 다른 파일)', async () => {
    const queue: QaReport[] = [{ passed: false, findings: [{ id: 'low-bitrate', severity: 'high', message: '화질', fixHint: 'rerender-quality' }], corrections: [], checkedAt: 'x' }, PASS]
    const s = setup({ runQa: async () => queue.shift()! })
    await produce(s)
    expect(s.tempos.map((t) => path.basename(t.outPath))).toEqual(['tempo-1.mp4', 'tempo-2.mp4'])
  })

  test('사용자가 고친 대본(ProduceInput.script)이 prepared.script 보다 우선한다', async () => {
    const s = setup()
    await produce(s, { script: { ...SCRIPT, title: '내가 고친 제목', hook: undefined } })
    expect(s.builds[0]!.script?.title).toBe('내가 고친 제목')
    expect(s.builds[0]!.kept).toEqual([{ start: 0, end: 45 }])
  })

  test('report.json 에 최종 대본이 남고, 확인하지 않은 항목에 AI 문구 확인이 들어간다', async () => {
    const s = setup()
    const outDir = path.join(work, 'rep')
    const p = await prepare(s)
    await produceEdit({ analysis: p.analysis, prepared: p.prepared, outDir, onStage: s.onStage }, s.deps)
    const report = JSON.parse(fs.readFileSync(path.join(outDir, 'report.json'), 'utf8'))
    expect(report.script.title).toBe('프로님의 롱아이언 꿀팁')
    expect(report.unchecked.join(' ')).toContain('AI 가 쓴 문구')
  })

  test('대본이 없으면 report.json 에 script 도 AI 문구 확인 항목도 없다', async () => {
    const s = setup({ directEdit: undefined })
    const outDir = path.join(work, 'rep2')
    const p = await prepare(s)
    await produceEdit({ analysis: p.analysis, prepared: p.prepared, outDir, onStage: s.onStage }, s.deps)
    const report = JSON.parse(fs.readFileSync(path.join(outDir, 'report.json'), 'utf8'))
    expect(report.script).toBeUndefined()
    expect(report.unchecked.join(' ')).not.toContain('AI 가 쓴 문구')
  })
})
