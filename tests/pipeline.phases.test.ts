import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, test } from 'vitest'
import { analyzeInput, prepareEdit, produceEdit, runEdit, type Analysis, type PipelineDeps, type Prepared, type Stage } from '../src/core/pipeline.ts'
import { interpretRequest } from '../src/core/interpret.ts'
import { ReferenceFetchError } from '../src/core/reference.ts'
import { SoundError } from '../src/shared/sound.ts'
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
  const builds: { sourcePath: string; canvas: { width: number; height: number }; reframe: string; captionPosition: string }[] = []
  const voices: { sourcePath: string; outPath: string; durationSec: number }[] = []
  const sounds: Parameters<PipelineDeps['applySound']>[0][] = []
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
      builds.push({ sourcePath: b.sourcePath, canvas: b.canvas, reframe: b.reframe, captionPosition: b.style.captions.position })
      return { projectDir: path.join(b.workDir, 'project'), durationSec: 1 }
    },
    renderProject: async (_d, r) => {
      fs.mkdirSync(path.dirname(r.outPath), { recursive: true })
      fs.writeFileSync(r.outPath, 'mp4')
      return { outPath: r.outPath, wallSec: 0.1 }
    },
    runQa: async () => PASS,
    enhanceVoice: async (v) => {
      voices.push({ sourcePath: v.sourcePath, outPath: v.outPath, durationSec: v.durationSec })
      return v.outPath
    },
    applySound: async (a) => {
      sounds.push(a)
      fs.mkdirSync(path.dirname(a.outPath), { recursive: true })
      fs.writeFileSync(a.outPath, 'mixed')
      const bgm = a.choice.bgm ? { id: a.choice.bgm, title: '잔잔한 곡', author: '작가', license: 'CC0', sourceUrl: 'https://pixabay.com/x' } : undefined
      return { path: a.outPath, report: { ...(bgm ? { bgm } : {}), sfxCount: a.choice.sfx === 'on' ? 2 : 0 } }
    },
    ...over,
  }
  const onStage = (s: Stage) => stages.push(s)
  return { deps, stages, fetches, builds, voices, sounds, cleanups: () => cleanups, onStage }
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

  describe('소리 설정(audio)', () => {
    async function prepare(s: ReturnType<typeof setup>) {
      const analysis = await analyzeInput({ videoPath: '/in/영상.mp4', workDir: work }, s.deps)
      const prepared = await prepareEdit({ analysis, workDir: work, purposeChoice: 'short' }, s.deps)
      return { analysis, prepared }
    }

    test("'voice' 면 컷·추적 뒤 만들기 전에 목소리 보정을 한 번 하고, 만들 때는 보정한 영상을 쓴다(원본 소리는 쓰지 않는다)", async () => {
      const s = setup()
      const { analysis, prepared } = await prepare(s)
      await produceEdit({ analysis, prepared, outDir: path.join(work, 'v1'), audio: 'voice', onStage: s.onStage }, s.deps)
      expect(s.stages).toEqual(['cuts', 'track', 'voice', 'build', 'render', 'qa', 'done'])
      expect(s.voices).toHaveLength(1)
      expect(s.voices[0]).toMatchObject({ sourcePath: '/in/영상.mp4', durationSec: 45 })
      expect(s.builds[0]!.sourcePath).toBe(s.voices[0]!.outPath)
    })

    test("기본(생략)이거나 'original' 이면 보정하지 않고 원본 영상을 그대로 쓴다", async () => {
      for (const audio of [undefined, 'original' as const]) {
        const s = setup()
        const { analysis, prepared } = await prepare(s)
        await produceEdit({ analysis, prepared, outDir: path.join(work, `o-${audio}`), audio, onStage: s.onStage }, s.deps)
        expect(s.voices).toHaveLength(0)
        expect(s.stages).not.toContain('voice')
        expect(s.builds[0]!.sourcePath).toBe('/in/영상.mp4')
      }
    })

    test('원본에 소리가 없으면 voice 를 골라도 건너뛴다', async () => {
      const s = setup({}, info({ hasAudio: false }))
      const { analysis, prepared } = await prepare(s)
      await produceEdit({ analysis, prepared, outDir: path.join(work, 'noaudio'), audio: 'voice', onStage: s.onStage }, s.deps)
      expect(s.voices).toHaveLength(0)
      expect(s.builds[0]!.sourcePath).toBe('/in/영상.mp4')
    })

    test('검수 재작업으로 다시 만들어도 목소리 보정은 한 번만 하고 보정한 영상을 계속 쓴다', async () => {
      const queue: QaReport[] = [{ passed: false, findings: [{ id: 'low-bitrate', severity: 'high', message: '화질', fixHint: 'rerender-quality' }], corrections: [], checkedAt: 'x' }, PASS]
      const s = setup({ runQa: async () => queue.shift()! })
      const { analysis, prepared } = await prepare(s)
      const r = await produceEdit({ analysis, prepared, outDir: path.join(work, 'rework'), audio: 'voice', onStage: s.onStage }, s.deps)
      expect(r.attempts).toBe(2)
      expect(s.voices).toHaveLength(1)
      expect(s.builds.map((b) => b.sourcePath)).toEqual([s.voices[0]!.outPath, s.voices[0]!.outPath])
    })
  })

  describe('배경음악·효과음(bgm / sfx)', () => {
    async function prepare(s: ReturnType<typeof setup>, reference?: string) {
      const analysis = await analyzeInput({ videoPath: '/in/영상.mp4', workDir: work }, s.deps)
      const prepared = await prepareEdit({ analysis, workDir: work, purposeChoice: 'short', reference }, s.deps)
      return { analysis, prepared }
    }

    test('아무것도 고르지 않으면 소리 입히기를 부르지 않고 mix 단계도 없다', async () => {
      const s = setup()
      const { analysis, prepared } = await prepare(s)
      await produceEdit({ analysis, prepared, outDir: path.join(work, 'none'), onStage: s.onStage }, s.deps)
      expect(s.sounds).toHaveLength(0)
      expect(s.stages).not.toContain('mix')
      await produceEdit({ analysis, prepared, outDir: path.join(work, 'none2'), bgm: null, sfx: 'off', onStage: s.onStage }, s.deps)
      expect(s.sounds).toHaveLength(0)
    })

    test('배경음악을 고르면 렌더 다음·검수 앞에 mix 단계가 있고, 검수와 결과 영상이 섞은 파일을 쓴다', async () => {
      const qaPaths: string[] = []
      const s = setup({ runQa: async (q) => (qaPaths.push(q.outputPath), PASS) })
      const { analysis, prepared } = await prepare(s)
      const outDir = path.join(work, 'bgm')
      await produceEdit({ analysis, prepared, outDir, bgm: 'calm-1', onStage: s.onStage }, s.deps)
      expect(s.stages).toEqual(['cuts', 'track', 'build', 'render', 'mix', 'qa', 'done'])
      expect(s.sounds).toHaveLength(1)
      expect(qaPaths).toEqual([s.sounds[0]!.outPath])
      expect(fs.readFileSync(path.join(outDir, 'result.mp4'), 'utf8')).toBe('mixed')
    })

    test('입력: 고른 값·남은 구간·제목 카드 여부·영상 길이·소리 유무를 넘긴다', async () => {
      const s = setup()
      const { analysis, prepared } = await prepare(s, 'https://youtu.be/ref') // 레퍼런스에 제목 카드가 있다
      await produceEdit({ analysis, prepared, outDir: path.join(work, 'args'), bgm: 'calm-1', sfx: 'on', onStage: s.onStage }, s.deps)
      expect(s.sounds[0]).toMatchObject({ choice: { bgm: 'calm-1', sfx: 'on' }, hookTitle: true, durationSec: 1, hasAudio: true, kept: [{ start: 0, end: 45 }] })
      expect(path.basename(s.sounds[0]!.renderedPath)).toBe('render-1.mp4')
    })

    test('대본에 말이 있는지(transcript.hasSpeech)도 소리 입히기에 넘긴다 — 말이 없는 영상은 음악을 소음 크기에 맞추지 않게', async () => {
      const talk = setup()
      const a = await prepare(talk)
      await produceEdit({ analysis: a.analysis, prepared: a.prepared, outDir: path.join(work, 'speech'), bgm: 'calm-1', onStage: talk.onStage }, talk.deps)
      expect(talk.sounds[0]!.hasSpeech).toBe(true)

      const quiet = setup({ transcribe: async () => ({ ...TR, words: [], segments: [], hasSpeech: false }) })
      const b = await prepare(quiet)
      await produceEdit({ analysis: b.analysis, prepared: b.prepared, outDir: path.join(work, 'nospeech'), bgm: 'calm-1', onStage: quiet.onStage }, quiet.deps)
      expect(quiet.sounds[0]!.hasSpeech).toBe(false)
    })

    test('효과음만 켜도 섞는다(제목 카드가 없으면 hookTitle=false)', async () => {
      const s = setup({}, info({ hasAudio: false }))
      const { analysis, prepared } = await prepare(s)
      await produceEdit({ analysis, prepared, outDir: path.join(work, 'sfx'), sfx: 'on', onStage: s.onStage }, s.deps)
      expect(s.sounds[0]).toMatchObject({ choice: { bgm: null, sfx: 'on' }, hookTitle: false, hasAudio: false })
    })

    test('검수 재작업으로 다시 렌더하면 다시 섞는다(시도마다 다른 파일)', async () => {
      const queue: QaReport[] = [{ passed: false, findings: [{ id: 'low-bitrate', severity: 'high', message: '화질', fixHint: 'rerender-quality' }], corrections: [], checkedAt: 'x' }, PASS]
      const s = setup({ runQa: async () => queue.shift()! })
      const { analysis, prepared } = await prepare(s)
      const r = await produceEdit({ analysis, prepared, outDir: path.join(work, 'rework2'), bgm: 'calm-1', onStage: s.onStage }, s.deps)
      expect(r.attempts).toBe(2)
      expect(s.sounds.map((x) => path.basename(x.renderedPath))).toEqual(['render-1.mp4', 'render-2.mp4'])
      expect(new Set(s.sounds.map((x) => x.outPath)).size).toBe(2)
    })

    test('report.json 에 sound 가 남고, 확인하지 않은 항목에 귀로 듣는 확인이 들어간다', async () => {
      const s = setup()
      const { analysis, prepared } = await prepare(s)
      const outDir = path.join(work, 'report')
      await produceEdit({ analysis, prepared, outDir, bgm: 'calm-1', sfx: 'on', onStage: s.onStage }, s.deps)
      const report = JSON.parse(fs.readFileSync(path.join(outDir, 'report.json'), 'utf8'))
      expect(report.sound).toMatchObject({ bgm: { id: 'calm-1', title: '잔잔한 곡', license: 'CC0' }, sfxCount: 2 })
      expect(report.unchecked.join(' ')).toContain('배경음악')
    })

    test('고르지 않았다면 report.json 에 sound 가 없다', async () => {
      const s = setup()
      const { analysis, prepared } = await prepare(s)
      const outDir = path.join(work, 'report2')
      await produceEdit({ analysis, prepared, outDir, onStage: s.onStage }, s.deps)
      expect(JSON.parse(fs.readFileSync(path.join(outDir, 'report.json'), 'utf8')).sound).toBeUndefined()
    })

    test('효과음을 켰는데 넣을 곳(컷 경계·제목 카드)이 없어서 0개면 검수 결과에 알림(info)이 남는다', async () => {
      const s = setup({ applySound: async (a) => ({ path: a.renderedPath, report: { sfxCount: 0 } }) })
      const { analysis, prepared } = await prepare(s)
      const r = await produceEdit({ analysis, prepared, outDir: path.join(work, 'sfx0'), sfx: 'on', onStage: s.onStage }, s.deps)
      expect(r.qa.findings).toContainEqual(expect.objectContaining({ id: 'sfx-none', severity: 'info', fixHint: 'none' }))
    })

    test('효과음이 들어갔거나 꺼 두었으면 그 알림은 없다', async () => {
      const s = setup()
      const { analysis, prepared } = await prepare(s)
      const on = await produceEdit({ analysis, prepared, outDir: path.join(work, 'sfx2'), sfx: 'on', onStage: s.onStage }, s.deps)
      expect(on.qa.findings.map((f) => f.id)).not.toContain('sfx-none')
      const off = await produceEdit({ analysis, prepared, outDir: path.join(work, 'sfx-off'), bgm: 'calm-1', sfx: 'off', onStage: s.onStage }, s.deps)
      expect(off.qa.findings.map((f) => f.id)).not.toContain('sfx-none')
    })

    test('소리 입히기가 SoundError 로 실패하면 같은 오류로 멈추고 작업 폴더를 지운다', async () => {
      const s = setup({ applySound: async () => { throw new SoundError('고른 배경음악(x)을 찾을 수 없어요') } })
      const { analysis, prepared } = await prepare(s)
      const outDir = path.join(work, 'fail')
      await expect(produceEdit({ analysis, prepared, outDir, bgm: 'x', onStage: s.onStage }, s.deps)).rejects.toThrow(SoundError)
      expect(fs.readdirSync(outDir).filter((f) => f.startsWith('.vae-work-'))).toEqual([])
      expect(fs.existsSync(path.join(outDir, 'result.mp4'))).toBe(false)
    })
  })

  describe('자막 위치(captionPosition)', () => {
    test('계획이 정한 기본 위치를 돌려준다: 레퍼런스가 없으면 하단', async () => {
      const s = setup()
      const analysis = await analyzeInput({ videoPath: '/in/영상.mp4', workDir: work }, s.deps)
      const prepared = await prepareEdit({ analysis, workDir: work, purposeChoice: 'short' }, s.deps)
      expect(prepared.captionPosition).toBe('bottom')
    })
    test('레퍼런스의 자막이 위쪽이면 기본 위치도 상단(자막 스타일을 따라 하는 계획일 때)', async () => {
      const s = setup({ analyzeReference: async () => ({ ...SPEC, captions: { ...SPEC.captions, position: 'top' as const } }) })
      const analysis = await analyzeInput({ videoPath: '/in/영상.mp4', workDir: work }, s.deps)
      const prepared = await prepareEdit({ analysis, workDir: work, reference: 'https://youtu.be/ref', purposeChoice: 'short' }, s.deps)
      expect(prepared.captionPosition).toBe('top')
    })
    test('제작에 captionPosition 을 주면 레퍼런스·계획과 상관없이 그 위치로 만든다', async () => {
      const s = setup()
      const analysis = await analyzeInput({ videoPath: '/in/영상.mp4', workDir: work }, s.deps)
      const prepared = await prepareEdit({ analysis, workDir: work, purposeChoice: 'short' }, s.deps)
      await produceEdit({ analysis, prepared, outDir: path.join(work, 'pos-mid'), captionPosition: 'middle', onStage: s.onStage }, s.deps)
      await produceEdit({ analysis, prepared, outDir: path.join(work, 'pos-top'), captionPosition: 'top', onStage: s.onStage }, s.deps)
      await produceEdit({ analysis, prepared, outDir: path.join(work, 'pos-none'), onStage: s.onStage }, s.deps)
      expect(s.builds.map((b) => b.captionPosition)).toEqual(['middle', 'top', 'bottom'])
    })
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
