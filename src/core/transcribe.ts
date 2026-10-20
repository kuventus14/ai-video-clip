import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { WHISPER_MODEL_PATH } from './env.ts'
import { run } from './exec.ts'
import { probeVideo } from './media.ts'
import type { Transcript, Word } from './types.ts'

interface WhisperToken {
  text?: string
  p?: number
}
interface WhisperEntry {
  offsets?: { from?: number; to?: number }
  text?: string
  tokens?: WhisperToken[]
}

const SPECIAL = /^\s*\[_[^\]]*\]\s*$/ // [_BEG_] [_EOT_] [_TT_427] 같은 whisper 특수 토큰
const SENTENCE_END = /[.?!。？！]$/
const SEGMENT_GAP_SEC = 0.8

/** whisper-cli `-ojf` 결과를 단어·세그먼트로 바꾼다. 순수 함수. */
export function parseWhisperJson(json: unknown, durationSec: number): Transcript {
  const root = (json ?? {}) as { result?: { language?: string }; transcription?: WhisperEntry[] }
  const acc: { text: string; start: number; end: number; pSum: number; pCount: number }[] = []

  for (const e of root.transcription ?? []) {
    const raw = e.text ?? ''
    if (!raw.trim() || SPECIAL.test(raw)) continue
    const from = (e.offsets?.from ?? 0) / 1000
    const to = (e.offsets?.to ?? 0) / 1000
    const ps = (e.tokens ?? []).filter((t) => !SPECIAL.test(t.text ?? '') && typeof t.p === 'number').map((t) => t.p as number)
    const startsWord = /^\s/.test(raw) || acc.length === 0
    const last = acc[acc.length - 1]
    if (startsWord || !last) {
      acc.push({ text: raw.trim(), start: from, end: to, pSum: ps.reduce((a, b) => a + b, 0), pCount: ps.length })
    } else {
      last.text += raw.trim()
      last.end = Math.max(last.end, to)
      last.pSum += ps.reduce((a, b) => a + b, 0)
      last.pCount += ps.length
    }
  }

  const words: Word[] = acc.map((w) => ({
    text: w.text,
    start: w.start,
    end: w.end,
    confidence: w.pCount ? w.pSum / w.pCount : 0.5,
  }))

  const segments: Transcript['segments'] = []
  let cur: { words: Word[] } | null = null
  for (const w of words) {
    const prev: Word | undefined = cur?.words[cur.words.length - 1]
    if (!cur || !prev || w.start - prev.end > SEGMENT_GAP_SEC || SENTENCE_END.test(prev.text)) {
      if (cur) segments.push(toSegment(cur.words))
      cur = { words: [] }
    }
    cur.words.push(w)
  }
  if (cur && cur.words.length) segments.push(toSegment(cur.words))

  return {
    language: root.result?.language ?? 'ko',
    durationSec,
    words,
    segments,
    hasSpeech: words.length > 0,
  }
}

function toSegment(ws: Word[]) {
  return { text: ws.map((w) => w.text).join(' '), start: ws[0]!.start, end: ws[ws.length - 1]!.end }
}

export async function transcribe(
  videoPath: string,
  opts: { language?: string; modelPath?: string; run?: typeof run } = {},
): Promise<Transcript> {
  const exec = opts.run ?? run
  const language = opts.language ?? 'ko'
  const info = await probeVideo(videoPath)
  if (!info.hasAudio) return { language, durationSec: info.durationSec, words: [], segments: [], hasSpeech: false }

  const modelPath = opts.modelPath ?? WHISPER_MODEL_PATH
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vae-whisper-'))
  try {
    const wav = path.join(tmp, 'audio.wav')
    await exec('ffmpeg', ['-v', 'error', '-nostdin', '-y', '-i', videoPath, '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav])
    const prefix = path.join(tmp, 'out')
    await exec('whisper-cli', ['-m', modelPath, '-l', language, '-ml', '1', '-sow', '-ojf', '-np', '-of', prefix, '-f', wav], {
      timeoutMs: 20 * 60_000,
    })
    const json = JSON.parse(fs.readFileSync(`${prefix}.json`, 'utf8')) as unknown
    const parsed = parseWhisperJson(json, info.durationSec)
    return { ...parsed, language: parsed.language || language }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}
