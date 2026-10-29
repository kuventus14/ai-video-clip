import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { transcribe } from '../src/core/transcribe.ts'
import { ensureFixtures } from './helpers/fixtures.ts'

// 실제 whisper-cli 를 부르는 시험. 작은 모델 파일 경로를 VAE_WHISPER_TEST_MODEL 로 줄 때만 돌린다(CI 의 윈도우·리눅스).
// 합성음에는 말이 없어서 글자는 확인하지 않는다 — 실행·인자·결과 JSON 읽기가 그 컴퓨터에서 되는지 본다.
const model = process.env.VAE_WHISPER_TEST_MODEL

describe.skipIf(!model)('whisper-cli 실제 호출', () => {
  test('transcribe 가 whisper-cli 를 실행하고 결과 JSON 을 읽어 Transcript 를 돌려준다', async () => {
    const fx = await ensureFixtures()
    const t = await transcribe(fx.landscape, { modelPath: model!, language: 'en' })
    expect(t.durationSec).toBeGreaterThan(0)
    expect(Array.isArray(t.words)).toBe(true)
    expect(Array.isArray(t.segments)).toBe(true)
  }, 180_000)

  // 윈도우의 whisper-cli 는 인자를 시스템 코드 페이지로 읽는다는 보고가 있다 — 사용자 폴더·모델 폴더에 한글이 있어도 도는지 CI 에서 직접 본다.
  test('한글이 든 임시 폴더·모델 폴더와 한글 힌트(--prompt)에서도 돈다', async () => {
    const fx = await ensureFixtures()
    const base = fs.mkdtempSync(path.join(os.tmpdir(), '한글 폴더 '))
    const koModel = path.join(base, 'ggml-small.bin') // 사용자 폴더에 한글이 있는 경우: 폴더만 한글이고 파일 이름은 영어
    fs.copyFileSync(model!, koModel)
    const keys = ['TEMP', 'TMP', 'TMPDIR'] as const
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]))
    for (const k of keys) process.env[k] = base // os.tmpdir() 가 이 폴더를 쓰게
    try {
      const t = await transcribe(fx.landscape, { modelPath: koModel, language: 'ko', prompt: '롱아이언, 백스윙' })
      expect(t.durationSec).toBeGreaterThan(0)
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k]
        else process.env[k] = saved[k]
      }
      fs.rmSync(base, { recursive: true, force: true })
    }
  }, 180_000)
})
