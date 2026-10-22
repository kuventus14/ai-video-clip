import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, test } from 'vitest'
import { buildDirectorPrompt, directEdit, extractReferenceFrames, MAX_DIRECTOR_IMAGES, type DirectInput } from '../src/core/director.ts'
import { LlmError, type askClaude } from '../src/core/llm.ts'
import { FEASIBILITY, type StyleSpec } from '../src/core/styleSpec.ts'
import type { Transcript, VideoInfo } from '../src/core/types.ts'
import type { VideoSummary } from '../src/core/understand.ts'
import { ensureFixtures, type Fixtures } from './helpers/fixtures.ts'

const info = (over: Partial<VideoInfo> = {}): VideoInfo => ({ path: '/in/영상.mp4', durationSec: 60.8, width: 1920, height: 1080, fps: 30, hasAudio: true, videoBitrate: 2e6, ...over })
const TR: Transcript = {
  language: 'ko', durationSec: 60.8, hasSpeech: true,
  words: [],
  segments: [
    { text: '롱아이언 칠 때 이렇게 하면 나는 잘 맞더라', start: 2.4, end: 6.1 },
    { text: '백스윙 했을 때 왼쪽 티셔츠의 차이가 나더라', start: 14.2, end: 18.9 },
  ],
}
const SUMMARY: VideoSummary = { topic: '롱아이언 백스윙', genre: '골프 레슨', oneLine: '프로가 알려 주는 롱아이언 팁', language: 'ko', hasPeople: true, hookTitle: '롱아이언 꿀팁', searchQueries: ['a', 'b', 'c'], source: 'user' }
const SPEC: StyleSpec = {
  orientation: 'portrait', durationSec: 40, pacing: { shotCount: 9, avgShotLengthSec: 4.4, cutsPerMinute: 14 },
  hook: { endSec: 3, description: '하이파이브 장면으로 시작' }, captions: { present: true, position: 'bottom', size: 'medium', color: '#FFFFFF', highlightColor: '#FFD400', maxCharsPerLine: 14 },
  hookTitle: { present: true, text: '꿀팁' }, transitions: { dominant: 'hard-cut' }, music: { present: false, energy: 'low' }, structure: ['훅', '설명', '결과'], feasibility: { ...FEASIBILITY },
}
const times = (n: number) => Array.from({ length: n }, (_, i) => i * 5 + 1)
const base = { info: info(), transcript: TR, summary: SUMMARY, refCount: 0, frameTimes: times(8) }

describe('buildDirectorPrompt', () => {
  test('내 영상 대본이 시각과 함께 줄 단위로 들어간다', () => {
    const p = buildDirectorPrompt(base)
    expect(p).toContain('[2.4~6.1초] 롱아이언 칠 때 이렇게 하면 나는 잘 맞더라')
    expect(p).toContain('[14.2~18.9초] 백스윙 했을 때 왼쪽 티셔츠의 차이가 나더라')
  })
  test('내 영상 사진마다 시각이 적힌다(이미지 1 = 1.0초 …)', () => {
    const p = buildDirectorPrompt(base)
    expect(p).toContain('이미지 1 = 1.0초')
    expect(p).toContain('이미지 8 = 36.0초')
  })
  test('작성 규칙이 들어간다: 훅 1.5~4초·고정 제목·소제목·중간 질문·리액션·강조 단어·속도·빼도 되는 구간', () => {
    const p = buildDirectorPrompt(base)
    for (const s of ['1.5~4초', 'title', 'sections', 'questions', 'reactions', 'emphasis', '1.0~1.25', 'drop']) expect(p).toContain(s)
  })
  test('없는 사실을 만들지 말라는 규칙과, 글자 수 상한이 들어간다', () => {
    const p = buildDirectorPrompt(base)
    expect(p).toMatch(/지어내지/)
    expect(p).toContain('18자')
    expect(p).toContain('22자')
  })
  test('레퍼런스가 없으면 "레퍼런스 없음" 문구, 있으면 레퍼런스 이미지 번호 범위와 스타일 요약(훅 설명·자막 강조색)', () => {
    expect(buildDirectorPrompt(base)).toContain('레퍼런스 없음')
    const withRef = buildDirectorPrompt({ ...base, refCount: 6, spec: SPEC })
    expect(withRef).toContain('이미지 9~14')
    expect(withRef).toContain('하이파이브 장면으로 시작')
    expect(withRef).toContain('#FFD400')
    expect(withRef).not.toContain('레퍼런스 없음')
  })
  test('레퍼런스 사진이 없어도 측정한 스타일 요약이 있으면 쓴다(사진 만들기 실패·다른 버전 만들기) — "레퍼런스 없음"이라고 하지 않는다', () => {
    const p = buildDirectorPrompt({ ...base, refCount: 0, spec: SPEC })
    expect(p).not.toContain('레퍼런스 없음')
    expect(p).toContain('하이파이브 장면으로 시작')
    expect(p).toContain('#FFD400')
    expect(p).toMatch(/베끼지/)
    expect(p).not.toMatch(/이미지 \d+~\d+\(레퍼런스/) // 없는 사진을 가리키지 않는다
  })
  test('사용자가 자막에서 뺀 구간을 알려 주고, 그 구간은 훅·덜어내기로 고르지 말라고 한다(말이 있는 곳이다)', () => {
    const p = buildDirectorPrompt({ ...base, deletedSpans: [{ start: 14.57, end: 20 }] })
    expect(p).toContain('14.6~20.0초')
    expect(p).toMatch(/말은 있/)
    expect(p).toMatch(/hook·drop|훅|덜어/)
    expect(buildDirectorPrompt(base)).not.toMatch(/자막에서 뺀/)
    expect(buildDirectorPrompt({ ...base, deletedSpans: [] })).not.toMatch(/자막에서 뺀/)
  })
  test('레퍼런스의 문구·내용을 베끼지 말라는 규칙이 있다(스펙의 안티골)', () => {
    expect(buildDirectorPrompt({ ...base, refCount: 6, spec: SPEC })).toMatch(/베끼지/)
  })
  test('영상이 10초 이하면 훅·소제목 등을 비우라는 문구가 따로 들어간다', () => {
    expect(buildDirectorPrompt({ ...base, info: info({ durationSec: 8 }) })).toContain('10초 이하')
  })
  test('말이 없는 영상이면 대본 대신 "음성 없음"을 알린다', () => {
    const p = buildDirectorPrompt({ ...base, transcript: { ...TR, hasSpeech: false, segments: [] } })
    expect(p).toContain('음성 없음')
  })
  test('영상 길이와 원본 가로세로가 들어간다', () => {
    const p = buildDirectorPrompt(base)
    expect(p).toContain('60.8초')
    expect(p).toContain('1920x1080')
  })
})

describe('directEdit', () => {
  const dummyFrames = (n: number) => Array.from({ length: n }, (_, i) => `/frames/src-${i}.jpg`)
  const mk = (over: Partial<DirectInput> = {}): DirectInput => ({ info: info(), transcript: TR, summary: SUMMARY, sourcePath: '/in/영상.mp4', workDir: '/w', ...over })
  const deps = (reply: string | Error) => {
    const calls: { prompt: string; images?: string[]; effort?: string }[] = []
    const frameCalls: number[][] = []
    const ask = (async (o: { prompt: string; images?: string[]; effort?: string }) => {
      calls.push(o)
      if (reply instanceof Error) throw reply
      return reply
    }) as unknown as typeof askClaude
    const frames = async (_p: string, t: number[]) => (frameCalls.push(t), dummyFrames(t.length))
    return { calls, frameCalls, d: { ask, frames } }
  }
  const GOOD = JSON.stringify({
    version: 1, title: '프로님의 롱아이언 꿀팁', hook: { sourceStart: 54, sourceEnd: 57, question: '롱아이언, 왜 나만 안 맞을까?' },
    openingLines: ['롱아이언 실전편'], sections: [{ atSec: 10, label: '여기서 포인트!' }], questions: [], reactions: [], emphasis: ['백스윙'], speed: 1.1, drop: [],
  })

  test('정상 응답 → 정리된 대본과 notes', async () => {
    const t = deps('설명 ```json\n' + GOOD + '\n``` 끝')
    const r = await directEdit(mk(), t.d)
    expect(r.script.title).toBe('프로님의 롱아이언 꿀팁')
    expect(r.script.hook?.question).toBe('롱아이언, 왜 나만 안 맞을까?')
    expect(r.notes).toEqual([])
  })
  test('JSON 이 아닌 글·객체가 아닌 JSON → LlmError(invalid-json)로 던진다(부른 쪽이 기본 방식으로 되돌아간다)', async () => {
    for (const reply of ['죄송해요, 못 하겠어요', '[1,2,3]']) {
      const e = await directEdit(mk(), deps(reply).d).catch((x) => x)
      expect(e).toBeInstanceOf(LlmError)
      expect((e as LlmError).kind).toBe('invalid-json')
    }
  })
  test('객체지만 쓸 게 없으면 제목만 있는 대본 — 제목은 영상의 훅 제목(장르보다 먼저)', async () => {
    const r = await directEdit(mk(), deps('{ "title": 5, "hook": "x", "speed": "빨리" }').d)
    expect(r.script.title).toBe('롱아이언 꿀팁')
    expect(r.script.hook).toBeUndefined()
    expect(r.notes.length).toBeGreaterThan(0)
  })
  test('범위 밖 시간·긴 문구는 정리돼서 돌아온다', async () => {
    const reply = JSON.stringify({ title: '가'.repeat(30), hook: { sourceStart: 500, sourceEnd: 503, question: '?' }, sections: [{ atSec: 9999, label: 'x' }] })
    const r = await directEdit(mk(), deps(reply).d)
    expect(r.script.title).toBe('롱아이언 꿀팁')
    expect(r.script.hook).toBeUndefined()
    expect(r.script.sections).toEqual([])
  })
  test('ask 가 LlmError 를 던지면 그대로 던진다(호출한 쪽이 기본 방식으로 되돌아간다)', async () => {
    await expect(directEdit(mk(), deps(new LlmError('timeout', '시간 초과')).d)).rejects.toBeInstanceOf(LlmError)
  })
  test('이미지는 (내 영상 사진 → 레퍼런스 사진) 순서이고 effort 는 medium 이상', async () => {
    const t = deps(GOOD)
    await directEdit(mk({ refFrames: ['/ref/a.jpg', '/ref/b.jpg', '/ref/c.jpg'] }), t.d)
    const call = t.calls[0]!
    expect(call.images!.slice(-3)).toEqual(['/ref/a.jpg', '/ref/b.jpg', '/ref/c.jpg'])
    expect(call.images!.slice(0, -3).every((f) => f.startsWith('/frames/src-'))).toBe(true)
    expect(['medium', 'high']).toContain(call.effort)
  })
  test(`이미지 합계가 ${MAX_DIRECTOR_IMAGES}장을 넘지 않는다(레퍼런스 사진이 16장이어도, 30장을 줘도)`, async () => {
    for (const n of [16, 30]) {
      const t = deps(GOOD)
      await directEdit(mk({ refFrames: Array.from({ length: n }, (_, i) => `/ref/${i}.jpg`) }), t.d)
      expect(t.calls[0]!.images!.length).toBeLessThanOrEqual(MAX_DIRECTOR_IMAGES)
      expect(t.calls[0]!.images!.length).toBeGreaterThanOrEqual(10) // 내 영상 사진도 충분히 본다
    }
  })
  test('내 영상 사진 시각은 영상 길이 안에서 고르게 뽑고, 프롬프트에 같은 시각이 적힌다', async () => {
    const t = deps(GOOD)
    await directEdit(mk(), t.d)
    const ts = t.frameCalls[0]!
    expect(ts.length).toBeGreaterThanOrEqual(6)
    expect([...ts].sort((a, b) => a - b)).toEqual(ts)
    expect(ts.every((x) => x > 0 && x < 60.8)).toBe(true)
    expect(t.calls[0]!.prompt).toContain(`이미지 1 = ${ts[0]!.toFixed(1)}초`)
  })
  test('영상이 짧으면(5초) 사진도 적게, 시각은 모두 영상 안', async () => {
    const t = deps(GOOD)
    await directEdit(mk({ info: info({ durationSec: 5 }) }), t.d)
    expect(t.frameCalls[0]!.length).toBeLessThanOrEqual(8)
    expect(t.frameCalls[0]!.every((x) => x > 0 && x < 5)).toBe(true)
  })
})

describe('extractReferenceFrames — 실제 ffmpeg', () => {
  let fx: Fixtures
  let tmp: string
  beforeAll(async () => {
    fx = await ensureFixtures()
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vae-ref-frames-'))
  })
  test('훅 구간을 촘촘히 + 전체에서 골라 JPEG 로 남긴다(8~16장, 시각 중복 없음)', async () => {
    const out = path.join(tmp, 'a')
    const files = await extractReferenceFrames(fx.landscape, 5, out)
    expect(files.length).toBeGreaterThanOrEqual(6)
    expect(files.length).toBeLessThanOrEqual(16)
    for (const f of files) {
      expect(f.endsWith('.jpg')).toBe(true)
      expect(fs.statSync(f).size).toBeGreaterThan(500)
    }
  })
  test('긴 영상(합성 30초)은 16장', async () => {
    const long = path.join(tmp, 'long.mp4')
    const { run } = await import('../src/core/exec.ts')
    await run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=15:duration=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', long])
    expect((await extractReferenceFrames(long, 30, path.join(tmp, 'b'))).length).toBe(16)
  })
})
