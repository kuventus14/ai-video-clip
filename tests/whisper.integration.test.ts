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
})
