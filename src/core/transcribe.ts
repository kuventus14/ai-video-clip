import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { segmentWords } from '../shared/captionReview.ts'
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

  // 큰따옴표는 인식 찌꺼기다(`"이렇게`가 그대로 자막에 찍힌다). 따옴표뿐이던 조각은 단어로 세지 않는다.
  const words: Word[] = acc
    .map((w) => ({ ...w, text: w.text.replace(/["“”]/g, '') }))
    .filter((w) => w.text)
    .map((w) => ({
      text: w.text,
      start: w.start,
      end: w.end,
      confidence: w.pCount ? w.pSum / w.pCount : 0.5,
    }))

  return {
    language: root.result?.language ?? 'ko',
    durationSec,
    words,
    segments: segmentWords(words),
    hasSpeech: words.length > 0,
  }
}

const lettersOnly = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, '')

/**
 * 인식 결과가 힌트(prompt) 문구를 그대로 받아 적은 것인가. whisper 는 말이 약하거나 없는 영상에서 힌트를 자막처럼 내놓는다
 * (예: 힌트 "롱아이언 스윙 설명 영상" → 자막 "(롱아이언 스윙 설명)"). 글자만 남겨 비교해서, 인식된 단어가 모두 힌트 안에 있으면 메아리로 본다.
 * 실제 말이 우연히 힌트 단어만으로 이뤄졌다면 잘못 걸리지만, 그때 치르는 값은 힌트 없이 한 번 더 인식하는 것뿐이다.
 */
export function echoesPrompt(t: Pick<Transcript, 'words'>, prompt: string): boolean {
  const hint = lettersOnly(prompt)
  const heard = t.words.map((w) => lettersOnly(w.text)).filter(Boolean)
  return hint !== '' && heard.length > 0 && heard.every((w) => hint.includes(w))
}

const NON_ASCII = /[^\x00-\x7F]/

/**
 * whisper-cli 에 줄 경로. 윈도우의 whisper-cli 는 인자를 시스템 코드 페이지로 읽어서 영어 로캘에서는 한글이 `?` 로 깨진다(입력 파일을 못 찾는다).
 * 그래서 임시 파일은 영어 이름의 폴더에 두고, 모델 폴더에 한글이 있으면 그 폴더를 작업 폴더로 해서 파일 이름만 넘긴다.
 * 한국어 윈도우(CP949)는 대부분 되지만 드문 글자는 깨지므로 같은 방식으로 막아 둔다. 맥·리눅스는 그대로.
 */
export function whisperPaths(o: { platform?: NodeJS.Platform; tmpdir?: string; modelPath: string; publicDir?: string }): { tmpBase: string; model: string; cwd: string | undefined } {
  const platform = o.platform ?? process.platform
  const tmpdir = o.tmpdir ?? os.tmpdir()
  if (platform !== 'win32') return { tmpBase: tmpdir, model: o.modelPath, cwd: undefined }
  const tmpBase = NON_ASCII.test(tmpdir) ? (o.publicDir ?? process.env.PUBLIC ?? 'C:\\Users\\Public') : tmpdir
  const dir = path.win32.dirname(o.modelPath)
  const name = path.win32.basename(o.modelPath)
  if (NON_ASCII.test(dir) && !NON_ASCII.test(name)) return { tmpBase, model: name, cwd: dir }
  return { tmpBase, model: o.modelPath, cwd: undefined }
}

export async function transcribe(
  videoPath: string,
  opts: { language?: string; modelPath?: string; /** 분야 용어 힌트(예: "롱아이언, 백스윙") — 전문 용어 오인식을 줄인다 */ prompt?: string; run?: typeof run } = {},
): Promise<Transcript> {
  const exec = opts.run ?? run
  const language = opts.language ?? 'ko'
  const info = await probeVideo(videoPath)
  if (!info.hasAudio) return { language, durationSec: info.durationSec, words: [], segments: [], hasSpeech: false }

  const modelPath = opts.modelPath ?? WHISPER_MODEL_PATH
  const w = whisperPaths({ modelPath })
  const tmp = fs.mkdtempSync(path.join(w.tmpBase, 'vae-whisper-'))
  try {
    const wav = path.join(tmp, 'audio.wav')
    await exec('ffmpeg', ['-v', 'error', '-nostdin', '-y', '-i', videoPath, '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav])
    const prefix = path.join(tmp, 'out')
    const hint = opts.prompt?.trim() ? ['--prompt', opts.prompt.trim()] : []
    await exec('whisper-cli', ['-m', w.model, '-l', language, '-ml', '1', '-sow', '-ojf', '-np', ...hint, '-of', prefix, '-f', wav], {
      timeoutMs: 20 * 60_000,
      cwd: w.cwd,
    })
    const json = JSON.parse(fs.readFileSync(`${prefix}.json`, 'utf8')) as unknown
    const parsed = parseWhisperJson(json, info.durationSec)
    return { ...parsed, language: parsed.language || language }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}
