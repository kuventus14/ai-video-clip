import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, test } from 'vitest'
import { parseWhisperJson, transcribe } from '../src/core/transcribe.ts'
import { ensureFixtures, type Fixtures } from './helpers/fixtures.ts'

const SAMPLE = path.join(os.homedir(), 'Desktop/롱아이언_릴스_편집본.mp4')

const entry = (from: number, to: number, text: string, ps: number[] = [0.9]) => ({
  offsets: { from, to },
  text,
  tokens: ps.map((p) => ({ text, p })),
})

describe('parseWhisperJson', () => {
  const json = {
    transcription: [
      { offsets: { from: 0, to: 540 }, text: ' 안녕', tokens: [{ text: ' 안녕', p: 0.9 }, { text: '[_TT_27]', p: 0.01 }] },
      { offsets: { from: 600, to: 1100 }, text: ' 하세요.', tokens: [{ text: ' 하세요', p: 0.7 }, { text: '.', p: 0.9 }] },
      { offsets: { from: 1100, to: 1100 }, text: '[_BEG_]', tokens: [] },
    ],
  }

  test('단어·시간(초)·신뢰도를 뽑고 특수 토큰은 버린다', () => {
    const t = parseWhisperJson(json, 2)
    expect(t.words).toHaveLength(2)
    expect(t.words[0]).toMatchObject({ text: '안녕', start: 0, end: 0.54 })
    expect(t.words[0]!.confidence).toBeCloseTo(0.9, 5)
    expect(t.words[1]!.confidence).toBeCloseTo(0.8, 5)
    expect(t.hasSpeech).toBe(true)
    expect(t.durationSec).toBe(2)
  })

  test('간격이 짧고 문장이 안 끝났으면 한 세그먼트', () => {
    const t = parseWhisperJson(json, 2)
    expect(t.segments).toEqual([{ text: '안녕 하세요.', start: 0, end: 1.1 }])
  })

  test('공백 없이 이어지는 조각은 앞 단어에 붙인다 (한글 토큰 분리 대응)', () => {
    const t = parseWhisperJson({ transcription: [entry(0, 200, ' 안'), entry(200, 500, '녕'), entry(600, 900, ' 하세요'), entry(900, 950, '.')] }, 1)
    expect(t.words.map((w) => w.text)).toEqual(['안녕', '하세요.'])
    expect(t.words[0]).toMatchObject({ start: 0, end: 0.5 })
  })

  test('큰따옴표는 자막에 쓸모없는 인식 찌꺼기라 단어에서 뺀다(따옴표만 있는 조각은 단어로 세지 않는다)', () => {
    const t = parseWhisperJson({ transcription: [entry(0, 300, ' "이렇게'), entry(300, 600, ' 갖지"'), entry(600, 700, ' "'), entry(700, 1000, ' \u201c섀도우\u201d')] }, 2)
    expect(t.words.map((w) => w.text)).toEqual(['이렇게', '갖지', '섀도우'])
  })

  test('0.8초 넘게 쉬거나 문장부호로 끝나면 세그먼트를 나눈다', () => {
    const t = parseWhisperJson({ transcription: [entry(0, 500, ' 가'), entry(1500, 2000, ' 나'), entry(2100, 2600, ' 다?'), entry(2700, 3000, ' 라')] }, 4)
    expect(t.segments.map((s) => s.text)).toEqual(['가', '나 다?', '라'])
  })

  test('비어 있으면 hasSpeech=false', () => {
    const t = parseWhisperJson({ transcription: [] }, 3)
    expect(t.hasSpeech).toBe(false)
    expect(t.words).toEqual([])
    expect(t.segments).toEqual([])
  })

  test('언어는 결과에서 읽고, 없으면 ko', () => {
    expect(parseWhisperJson({ result: { language: 'en' }, transcription: [] }, 1).language).toBe('en')
    expect(parseWhisperJson({ transcription: [] }, 1).language).toBe('ko')
  })
})

describe('transcribe', () => {
  let fx: Fixtures
  beforeAll(async () => {
    fx = await ensureFixtures()
  })

  test('오디오가 없는 영상은 whisper 를 부르지 않고 빈 결과를 돌려준다', async () => {
    const calls: string[] = []
    const spy = async (file: string) => {
      calls.push(file)
      return { stdout: '', stderr: '' }
    }
    const t = await transcribe(fx.silent, { run: spy })
    expect(calls).toEqual([])
    expect(t.hasSpeech).toBe(false)
    expect(t.durationSec).toBeCloseTo(2, 0)
  })

  test('ffmpeg 로 16kHz 모노 wav 를 뽑고 whisper-cli 를 알맞은 옵션으로 부른다', async () => {
    const calls: { file: string; args: string[] }[] = []
    const fake = async (file: string, args: string[]) => {
      calls.push({ file, args })
      if (file === 'ffmpeg') fs.writeFileSync(args[args.length - 1]!, 'wav')
      if (file === 'whisper-cli') {
        const prefix = args[args.indexOf('-of') + 1]!
        fs.writeFileSync(`${prefix}.json`, JSON.stringify({ result: { language: 'ko' }, transcription: [entry(0, 500, ' 안녕')] }))
      }
      return { stdout: '', stderr: '' }
    }
    const t = await transcribe(fx.landscape, { run: fake, modelPath: '/models/ggml-small.bin' })
    expect(calls.map((c) => c.file)).toEqual(['ffmpeg', 'whisper-cli'])
    const ff = calls[0]!.args
    expect(ff).toEqual(expect.arrayContaining(['-ar', '16000', '-ac', '1']))
    const w = calls[1]!.args
    expect(w[w.indexOf('-m') + 1]).toBe('/models/ggml-small.bin')
    expect(w[w.indexOf('-l') + 1]).toBe('ko')
    expect(w).toEqual(expect.arrayContaining(['-ml', '1', '-sow', '-ojf']))
    expect(t.words.map((x) => x.text)).toEqual(['안녕'])
    expect(t.durationSec).toBeCloseTo(5, 0)
  })

  test('용어 힌트(prompt)를 주면 whisper-cli 에 --prompt 로 넘기고, 안 주면 넘기지 않는다', async () => {
    const argsOf: string[][] = []
    const fake = async (file: string, args: string[]) => {
      if (file === 'ffmpeg') fs.writeFileSync(args[args.length - 1]!, 'wav')
      if (file === 'whisper-cli') {
        argsOf.push(args)
        fs.writeFileSync(`${args[args.indexOf('-of') + 1]}.json`, JSON.stringify({ transcription: [entry(0, 500, ' 안녕')] }))
      }
      return { stdout: '', stderr: '' }
    }
    await transcribe(fx.landscape, { run: fake, prompt: '롱아이언, 백스윙, 골프 레슨' })
    await transcribe(fx.landscape, { run: fake })
    expect(argsOf[0]![argsOf[0]!.indexOf('--prompt') + 1]).toBe('롱아이언, 백스윙, 골프 레슨')
    expect(argsOf[1]).not.toContain('--prompt')
  })

  test.skipIf(process.env.INTEGRATION !== '1' || !fs.existsSync(SAMPLE))('실제 샘플 영상을 한국어로 인식한다', async () => {
    const t = await transcribe(SAMPLE)
    expect(t.language).toBe('ko')
    expect(t.words.length).toBeGreaterThan(20)
    for (const w of t.words) expect(w.start).toBeLessThan(w.end)
    for (let i = 1; i < t.words.length; i++) expect(t.words[i]!.start).toBeGreaterThanOrEqual(t.words[i - 1]!.start)
  })
})
