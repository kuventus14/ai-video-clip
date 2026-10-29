import { describe, expect, test } from 'vitest'
import type { askClaude } from '../src/core/llm.ts'
import { balanceSound, decideSoundBalance, speechRatio } from '../src/core/soundBalance.ts'
import type { BgmTrack, Catalog } from '../src/shared/sound.ts'
import type { VideoSummary } from '../src/core/understand.ts'
import type { Transcript } from '../src/core/types.ts'

const SUMMARY: VideoSummary = { topic: '자취방 정리', genre: '브이로그', oneLine: '작은 방을 정리한다', language: 'ko', hasPeople: true, hookTitle: '방 정리', searchQueries: ['a', 'b', 'c'], source: 'analyzed' }
const BGM = { title: '잔잔한 곡', mood: 'calm' }

/** 가짜 AI: 받은 요청을 기록하고, 정해 둔 글(또는 오류)로 답한다 */
function fakeAsk(reply: string | Error) {
  const calls: { prompt: string; effort?: string; timeoutMs?: number }[] = []
  const ask = (async (o: { prompt: string; effort?: string; timeoutMs?: number }) => {
    calls.push(o)
    if (reply instanceof Error) throw reply
    return reply
  }) as unknown as typeof askClaude
  return { ask, calls }
}
const input = (extra: Partial<Parameters<typeof decideSoundBalance>[0]> = {}) => ({ summary: SUMMARY, speechRatio: 0.7, bgm: BGM, sfxOn: true, ...extra })

describe('decideSoundBalance — AI 가 음악·효과음 크기 오프셋을 정한다', () => {
  test('AI 가 준 값을 그대로 쓰고 이유를 남긴다', async () => {
    const f = fakeAsk('{"bgmGainDb":-3,"sfxGainDb":1,"reason":"말이 많아요"}')
    expect(await decideSoundBalance(input(), { ask: f.ask })).toEqual({ bgmGainDb: -3, sfxGainDb: 1, reason: '말이 많아요' })
  })
  test('AI 범위(-6 ~ +4 dB)를 넘으면 잘라 낸다 — 유저 슬라이더 범위(-12 ~ +6)와 별개', async () => {
    const f = fakeAsk('{"bgmGainDb":99,"sfxGainDb":-99,"reason":"x"}')
    expect(await decideSoundBalance(input(), { ask: f.ask })).toMatchObject({ bgmGainDb: 4, sfxGainDb: -6 })
  })
  test('코드펜스·잡담 사이의 JSON 도 읽고, 0.5 dB 단위로 맞춘다', async () => {
    const f = fakeAsk('좋아요!\n```json\n{"bgmGainDb":1.74,"sfxGainDb":0,"reason":"ok"}\n```')
    expect(await decideSoundBalance(input(), { ask: f.ask })).toMatchObject({ bgmGainDb: 1.5, sfxGainDb: 0 })
  })
  test.each([
    ['글만 온다', '잘 모르겠어요'],
    ['JSON 이 깨졌다', '{"bgmGainDb":'],
    ['배열이다', '[1,2]'],
    ['숫자가 문자열이다', '{"bgmGainDb":"3","sfxGainDb":"2","reason":3}'],
  ])('%s → 오프셋 0, 이유 없음 (제작은 계속된다)', async (_n, reply) => {
    const f = fakeAsk(reply)
    expect(await decideSoundBalance(input(), { ask: f.ask })).toEqual({ bgmGainDb: 0, sfxGainDb: 0, reason: '' })
  })
  test('AI 호출이 던져도 오프셋 0 으로 돌아간다', async () => {
    const f = fakeAsk(new Error('claude 가 응답하지 않았어요'))
    expect(await decideSoundBalance(input(), { ask: f.ask })).toEqual({ bgmGainDb: 0, sfxGainDb: 0, reason: '' })
  })
  test('이유는 60자까지만', async () => {
    const f = fakeAsk(JSON.stringify({ bgmGainDb: 0, sfxGainDb: 0, reason: '가'.repeat(100) }))
    expect((await decideSoundBalance(input(), { ask: f.ask })).reason).toHaveLength(60)
  })
  test('음악을 안 쓰면 음악 오프셋은 AI 답과 상관없이 0, 효과음을 끄면 효과음 오프셋 0', async () => {
    const f = fakeAsk('{"bgmGainDb":3,"sfxGainDb":3,"reason":"x"}')
    expect(await decideSoundBalance(input({ bgm: undefined }), { ask: f.ask })).toMatchObject({ bgmGainDb: 0, sfxGainDb: 3 })
    expect(await decideSoundBalance(input({ sfxOn: false }), { ask: f.ask })).toMatchObject({ bgmGainDb: 3, sfxGainDb: 0 })
  })
  test('음악도 효과음도 없으면 AI 를 부르지 않는다', async () => {
    const f = fakeAsk('{"bgmGainDb":3,"sfxGainDb":3,"reason":"x"}')
    expect(await decideSoundBalance(input({ bgm: undefined, sfxOn: false }), { ask: f.ask })).toEqual({ bgmGainDb: 0, sfxGainDb: 0, reason: '' })
    expect(f.calls).toHaveLength(0)
  })
  test('프롬프트에 장르·말 비율·음악 분위기와 "기본 규칙 대비 dB 오프셋"이라는 기준이 있고 effort 는 low', async () => {
    const f = fakeAsk('{"bgmGainDb":0,"sfxGainDb":0,"reason":""}')
    await decideSoundBalance(input({ speechRatio: 0.7 }), { ask: f.ask })
    const p = f.calls[0]!.prompt
    expect(p).toContain('브이로그')
    expect(p).toContain('70%')
    expect(p).toContain('calm')
    expect(p).toContain('기본 규칙')
    expect(p).toContain('dB')
    expect(f.calls[0]!.effort).toBe('low')
  })
  test('AI 가 멈춰도 제작이 오래 서 있지 않게 60초 안에 포기한다(추천일 뿐이라 0 으로 돌아가면 된다)', async () => {
    const f = fakeAsk('{"bgmGainDb":0,"sfxGainDb":0,"reason":""}')
    await decideSoundBalance(input(), { ask: f.ask })
    expect(f.calls[0]!.timeoutMs).toBe(60_000)
  })
  test('음악을 안 쓰면 프롬프트에 음악 분위기를 묻지 않는다', async () => {
    const f = fakeAsk('{"bgmGainDb":0,"sfxGainDb":0,"reason":""}')
    await decideSoundBalance(input({ bgm: undefined }), { ask: f.ask })
    expect(f.calls[0]!.prompt).not.toContain('calm')
  })
})

const tr = (segments: [number, number][], hasSpeech = true): Transcript => ({
  language: 'ko', durationSec: 10, hasSpeech, words: [], segments: segments.map(([start, end]) => ({ text: 'x', start, end })),
})

describe('speechRatio — 길이 중 말하는 구간의 비율', () => {
  test('말 구간 합 / 길이', () => {
    expect(speechRatio(tr([[0, 2], [5, 8]]), 10)).toBeCloseTo(0.5, 5)
  })
  test('말이 없는 대본·빈 구간·길이 0 은 0', () => {
    expect(speechRatio(tr([], false), 10)).toBe(0)
    expect(speechRatio(tr([[0, 5]], false), 10)).toBe(0)
    expect(speechRatio(tr([]), 10)).toBe(0)
    expect(speechRatio(tr([[0, 5]]), 0)).toBe(0)
  })
  test('겹친 구간은 한 번만 세고 1 을 넘지 않는다', () => {
    expect(speechRatio(tr([[0, 6], [4, 9]]), 10)).toBeCloseTo(0.9, 5)
    expect(speechRatio(tr([[-2, 20]]), 10)).toBe(1)
  })
})

const TRACK: BgmTrack = { kind: 'bgm', id: 'calm-1', file: 'bgm/calm-1.mp3', title: '잔잔한 곡', author: '작가', sourceUrl: 'https://pixabay.com/music/x', license: 'Pixabay License', durationSec: 90, lufs: -14, peakDb: -1, mood: 'calm' }
const CATALOG: Catalog = { dir: '/snd', bgm: [TRACK], sfx: [] }

describe('balanceSound — 음원 목록에서 곡 정보를 찾아 AI 에게 묻는다', () => {
  const REPLY = '{"bgmGainDb":2,"sfxGainDb":0,"reason":"활기찬 영상"}'
  test('곡 id 로 제목·분위기를 찾아 프롬프트에 넣는다', async () => {
    const f = fakeAsk(REPLY)
    const r = await balanceSound({ summary: SUMMARY, speechRatio: 0.3, bgmId: 'calm-1', sfxOn: false }, { ask: f.ask, catalog: () => CATALOG })
    expect(r).toMatchObject({ bgmGainDb: 2, sfxGainDb: 0 })
    expect(f.calls[0]!.prompt).toContain('잔잔한 곡')
    expect(f.calls[0]!.prompt).toContain('calm')
  })
  test('음원 목록을 못 읽어도(던짐) 오프셋 0 — 제작은 계속된다', async () => {
    const f = fakeAsk(REPLY)
    const r = await balanceSound({ summary: SUMMARY, speechRatio: 0.3, bgmId: 'calm-1', sfxOn: true }, { ask: f.ask, catalog: () => { throw new Error('manifest 깨짐') } })
    expect(r).toEqual({ bgmGainDb: 0, sfxGainDb: 0, reason: '' })
    expect(f.calls).toHaveLength(0)
  })
  test('효과음만 쓰면 음원 목록을 읽지 않는다', async () => {
    const f = fakeAsk(REPLY)
    const r = await balanceSound({ summary: SUMMARY, speechRatio: 0.3, bgmId: null, sfxOn: true }, { ask: f.ask, catalog: () => { throw new Error('안 불려야 함') } })
    expect(r.bgmGainDb).toBe(0)
    expect(f.calls).toHaveLength(1)
  })
})
