import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { run, ToolError } from '../src/core/exec.ts'
import { askClaude, cleanEnv, LlmError } from '../src/core/llm.ts'
import { probeVideo } from '../src/core/media.ts'
import { buildSearchArgs, parseSearchLines } from '../src/core/search.ts'
import { enhanceVoice } from '../src/core/voice.ts'
import { findDeepFilter } from '../src/shared/voice.ts'
import { ensureFixtures } from './helpers/fixtures.ts'

// 실제 외부 프로그램(yt-dlp·deep-filter·Claude Code)을 그 컴퓨터에서 실제로 부르는 시험. CI 의 "외부 도구 확인" 워크플로에서만 돌린다(VAE_EXTERNAL=1).
// 결과는 로그에 "확인:" 줄로 남긴다. AI 응답 자체는 로그인(토큰)이 필요해서 확인하지 못한다 — 실행·인자·환경이 받아들여지는지만 본다.
const external = describe.skipIf(process.env.VAE_EXTERNAL !== '1')

external('yt-dlp', () => {
  test('실행되고, 검색한다(YouTube 가 이 서버를 막으면 실행만 확인)', async () => {
    const v = await run('yt-dlp', ['--version'])
    console.log(`확인: yt-dlp 버전 ${v.stdout.trim()}`)
    expect(v.stdout.trim()).toMatch(/^\d{4}\.\d+\.\d+/)
    try {
      const { stdout } = await run('yt-dlp', buildSearchArgs('golf swing tips', 'short'), { timeoutMs: 120_000 })
      const found = parseSearchLines(stdout)
      console.log(`확인: yt-dlp 검색 결과 ${found.length}개`)
      expect(found.length).toBeGreaterThan(0)
    } catch (e) {
      const text = e instanceof ToolError ? e.stderr : String(e)
      if (!/sign in to confirm|not a bot|429|unable to download|HTTP Error|rate.?limit/i.test(text)) throw e
      console.log(`확인: yt-dlp 는 실행됐지만 YouTube 가 이 서버(GitHub)의 요청을 막았어요 — ${text.trim().split('\n').pop()?.slice(0, 160)}`)
    }
  }, 240_000)
})

external('deep-filter 목소리 보정', () => {
  test.skipIf(!findDeepFilter())('enhanceVoice 가 실제 deep-filter 로 소리를 보정해 영상을 만든다', async () => {
    const fx = await ensureFixtures()
    const info = await probeVideo(fx.landscape)
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'vae-deep-'))
    try {
      const out = path.join(work, 'out.mp4')
      const t0 = Date.now()
      await enhanceVoice({ sourcePath: fx.landscape, outPath: out, workDir: path.join(work, 'w'), durationSec: info.durationSec })
      const o = await probeVideo(out)
      console.log(`확인: deep-filter 목소리 보정 ${Math.round((Date.now() - t0) / 100) / 10}초, 길이 ${o.durationSec}초(원본 ${info.durationSec}초), 소리 ${o.hasAudio ? '있음' : '없음'}`)
      expect(o.hasAudio).toBe(true)
      expect(Math.abs(o.durationSec - info.durationSec)).toBeLessThan(0.6)
    } finally {
      fs.rmSync(work, { recursive: true, force: true })
    }
  }, 240_000)
})

external('Claude Code', () => {
  test('설치돼 있고 우리가 만든 환경(cleanEnv)으로 실행된다', async () => {
    const v = await run('claude', ['--version'], { env: cleanEnv() })
    console.log(`확인: claude 버전 ${v.stdout.trim()}`)
    expect(v.stdout).toMatch(/\d+\.\d+/)
  }, 120_000)

  test('로그인 없이 부르면 실행·인자·환경은 받아들여지고 인증 때문에 실패한다(실행 오류가 아니라)', async () => {
    const err = await askClaude({ prompt: '안녕', timeoutMs: 150_000 }).then(
      () => null,
      (e: unknown) => e as Error,
    )
    console.log(`확인: claude 응답(로그인 없음) — ${err ? err.message.slice(0, 300).replace(/\s+/g, ' ') : '(성공 — 이 컴퓨터에 로그인이 있어요)'}`)
    if (err) {
      expect(err).toBeInstanceOf(LlmError)
      expect(err.message).not.toMatch(/실행할 수 없어요|ENOENT|EINVAL|EFTYPE|unknown option|unknown argument|시간 초과/i)
    }
  }, 200_000)
})
