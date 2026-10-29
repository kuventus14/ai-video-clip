import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { isPortFree, killTree } from '../scripts/app-lib.mjs'
import { ensureFixtures } from './helpers/fixtures.ts'

// 앱을 사용자가 쓰는 방식 그대로(npm run app: 빌드 → 화면 서버 + 처리 프로그램) 켜서 영상을 올리고 끝낸다. 빌드가 들어 있어 몇 분 걸려서 CI 에서만 돌린다(VAE_E2E=1).
const e2e = describe.skipIf(process.env.VAE_E2E !== '1')

const PORT = 4871
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

e2e('앱 전체: 실행기 + 화면 서버 + 처리 프로그램', () => {
  test('켜지고, 영상을 올리면 처리 프로그램이 ffprobe 로 확인해 ready 가 되고, 끝내면 자식까지 모두 사라진다', async () => {
    const root = path.resolve(import.meta.dirname, '..')
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'vae-e2e-'))
    const fx = await ensureFixtures()
    let log = ''
    const app = spawn(process.execPath, ['scripts/app.mjs'], {
      cwd: root,
      env: { ...process.env, VAE_PORT: String(PORT), VAE_DATA_DIR: data },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      windowsHide: true,
    })
    app.stdout.on('data', (d) => (log += d))
    app.stderr.on('data', (d) => (log += d))
    try {
      await waitFor('화면 서버가 켜져야 해요', async () => (await fetch(`${BASE}/api/jobs`)).ok, 420_000)

      const created = (await (await fetch(`${BASE}/api/jobs`, { method: 'POST' })).json()) as { id: string }
      const put = await fetch(`${BASE}/api/jobs/${created.id}/video?name=sample.mp4`, { method: 'PUT', body: fs.readFileSync(fx.landscape), headers: { 'content-type': 'video/mp4' } })
      expect(put.status).toBe(200)

      const job = await waitFor('처리 프로그램이 영상을 확인해야 해요', async () => {
        const dto = (await (await fetch(`${BASE}/api/jobs/${created.id}`)).json()) as { status: string; sourceInfo: { width: number; height: number } | null; error: string | null }
        if (dto.status === 'failed') throw new Error(`확인 단계가 실패했어요: ${dto.error}`)
        return dto.status === 'ready' ? dto : null
      }, 120_000)
      expect(job.sourceInfo?.width).toBeGreaterThan(0)
    } catch (e) {
      throw new Error(`${(e as Error).message}\n--- 앱 로그(끝) ---\n${log.slice(-3000)}`)
    } finally {
      // 사용자의 Ctrl+C 와 같게: 맥·리눅스는 SIGINT(런처가 자식에게 종료를 알린다), 윈도우는 신호가 없어 트리째 끝낸다.
      // 런처만 갑자기 죽이면 자식(각자 프로세스 그룹)이 남는다 — 그건 앱의 설계이고 시험이 정리할 일이 아니다.
      if (process.platform === 'win32') killTree(app.pid)
      else app.kill('SIGINT')
      // 화면 서버·처리 프로그램이 남아 있으면 포트가 계속 쓰이고 있다
      await waitFor('앱을 끝내면 포트가 비어야 해요', () => isPortFree(PORT, '127.0.0.1'), 30_000)
      fs.rmSync(data, { recursive: true, force: true })
    }
  }, 700_000)
})
