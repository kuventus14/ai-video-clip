import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { isPortFree, killTree } from '../scripts/app-lib.mjs'
import { ensureFixtures } from './helpers/fixtures.ts'

// 실제 브라우저(Chromium)로 화면을 써 본다: 새 영상 화면에서 영상을 고르면 올라가고 확인이 끝나 "분석 시작" 이 켜지는가. 화면 캡처도 남긴다.
// playwright 는 package.json 에 없다 — CI 가 `npm i --no-save playwright` 로 깐다. VAE_UI_E2E=1 일 때만 돌린다.
const ui = describe.skipIf(process.env.VAE_UI_E2E !== '1')

const PORT = 4873
const BASE = `http://127.0.0.1:${PORT}`
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitFor<T>(what: string, fn: () => Promise<T | null | false>, timeoutMs: number): Promise<T> {
  const end = Date.now() + timeoutMs
  for (;;) {
    try {
      const v = await fn()
      if (v) return v
    } catch {
      // 아직 준비 중
    }
    if (Date.now() > end) throw new Error(`${what} — ${timeoutMs / 1000}초 안에 안 됐어요`)
    await sleep(1000)
  }
}

ui('브라우저로 화면 쓰기', () => {
  test('새 영상 화면에서 영상을 고르면 올라가고 분석 시작 버튼이 켜진다', async () => {
    const root = path.resolve(import.meta.dirname, '..')
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'vae-ui-'))
    const shots = process.env.VAE_SCREENSHOT_DIR ?? path.join(os.tmpdir(), 'vae-shots')
    fs.mkdirSync(shots, { recursive: true })
    const fx = await ensureFixtures()
    // playwright 는 CI 에서만 깔려서 타입을 가져오지 않는다(tsc 가 없는 모듈을 찾지 않게 이름을 변수로 둔다)
    const pkg = 'playwright'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { chromium } = (await import(/* @vite-ignore */ pkg)) as { chromium: { launch(): Promise<any> } }
    let log = ''
    const app = spawn(process.execPath, ['scripts/app.mjs'], { cwd: root, env: { ...process.env, VAE_PORT: String(PORT), VAE_DATA_DIR: data }, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true })
    app.stdout.on('data', (d) => (log += d))
    app.stderr.on('data', (d) => (log += d))
    const browser = await chromium.launch()
    try {
      await waitFor('화면 서버가 켜져야 해요', async () => (await fetch(`${BASE}/api/jobs`)).ok, 420_000)
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
      const errors: string[] = []
      page.on('pageerror', (e: Error) => errors.push(e.message))
      page.on('console', (m: { type(): string; text(): string }) => m.type() === 'error' && errors.push(m.text()))

      await page.goto(`${BASE}/new`)
      await page.locator('input[type=file]').first().setInputFiles(fx.landscape)
      const start = page.getByRole('button', { name: '분석 시작' })
      await waitFor('영상을 올리고 확인이 끝나 "분석 시작" 이 켜져야 해요', async () => start.isEnabled(), 120_000)
      await page.screenshot({ path: path.join(shots, 'new-ready.png'), fullPage: true })
      console.log(`확인: 브라우저로 영상을 올려 "분석 시작" 버튼이 켜졌어요 (${process.platform}, 화면 오류 ${errors.length}개)`)

      await page.goto(`${BASE}/`)
      await page.waitForLoadState('networkidle')
      await page.screenshot({ path: path.join(shots, 'history.png'), fullPage: true })
      expect(errors).toEqual([])
    } catch (e) {
      throw new Error(`${(e as Error).message}\n--- 앱 로그(끝) ---\n${log.slice(-3000)}`)
    } finally {
      await browser.close()
      if (process.platform === 'win32') killTree(app.pid)
      else app.kill('SIGINT')
      await waitFor('앱을 끝내면 포트가 비어야 해요', () => isPortFree(PORT, '127.0.0.1'), 30_000)
      fs.rmSync(data, { recursive: true, force: true })
    }
  }, 700_000)
})
