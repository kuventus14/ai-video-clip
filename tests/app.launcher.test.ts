import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isPortFree, latestMtimeMs, linePrefixer, needsBuild, parseAppArgs } from '../scripts/app-lib.mjs'

describe('linePrefixer', () => {
  it('줄마다 접두어를 붙이고, 줄 중간에 끊겨 온 조각은 이어 붙인다', () => {
    const out: string[] = []
    const p = linePrefixer('[web]', (line) => out.push(line))
    p.write(Buffer.from('첫째 줄\n둘째 '))
    p.write(Buffer.from('줄\n'))
    expect(out).toEqual(['[web] 첫째 줄', '[web] 둘째 줄'])
  })
  it('한글이 바이트 경계에서 쪼개져 와도 깨지지 않는다', () => {
    const out: string[] = []
    const p = linePrefixer('[worker]', (line) => out.push(line))
    const bytes = Buffer.from('시작했어요\n')
    p.write(bytes.subarray(0, 4)) // "시" 의 중간
    p.write(bytes.subarray(4))
    expect(out).toEqual(['[worker] 시작했어요'])
  })
  it('flush 는 줄바꿈 없이 끝난 마지막 조각을 내보내고, 빈 줄은 건너뛴다', () => {
    const out: string[] = []
    const p = linePrefixer('[web]', (line) => out.push(line))
    p.write(Buffer.from('a\n\n\nb'))
    expect(out).toEqual(['[web] a'])
    p.flush()
    expect(out).toEqual(['[web] a', '[web] b'])
  })
  it('자식이 이미 같은 접두어를 붙여 출력하면 겹쳐 붙이지 않는다', () => {
    const out: string[] = []
    const p = linePrefixer('[worker]', (line) => out.push(line))
    p.write(Buffer.from('[worker] 시작했어요\n[worker]시작\n'))
    expect(out).toEqual(['[worker] 시작했어요', '[worker] [worker]시작'])
  })
  it('캐리지리턴(\\r)으로 덮어쓰는 진행 표시는 마지막 상태만 남긴다', () => {
    const out: string[] = []
    const p = linePrefixer('[build]', (line) => out.push(line))
    p.write(Buffer.from('10%\r50%\r100%\n'))
    expect(out).toEqual(['[build] 100%'])
  })
})

describe('parseAppArgs', () => {
  it('기본은 운영 모드, --dev 는 개발 모드, --rebuild 는 다시 빌드', () => {
    expect(parseAppArgs([])).toEqual({ dev: false, rebuild: false })
    expect(parseAppArgs(['--dev'])).toEqual({ dev: true, rebuild: false })
    expect(parseAppArgs(['--rebuild'])).toEqual({ dev: false, rebuild: true })
  })
  it('모르는 옵션은 던진다', () => {
    expect(() => parseAppArgs(['--nope'])).toThrow(/--nope/)
  })
})

describe('빌드가 필요한지', () => {
  let root: string
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vae-app-'))
    fs.mkdirSync(path.join(root, 'app'), { recursive: true })
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    fs.writeFileSync(path.join(root, 'app', 'page.tsx'), 'x')
    fs.writeFileSync(path.join(root, 'package.json'), '{}')
  })
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  const touch = (file: string, secondsFromNow: number) => {
    const t = new Date(Date.now() + secondsFromNow * 1000)
    fs.utimesSync(file, t, t)
  }

  it('latestMtimeMs 는 폴더 안 파일들의 가장 늦은 수정 시각 (없는 경로는 무시)', () => {
    touch(path.join(root, 'app', 'page.tsx'), 100)
    const t = latestMtimeMs([path.join(root, 'app'), path.join(root, 'src'), path.join(root, 'nope')])
    expect(t).toBeGreaterThan(Date.now() + 90_000)
  })
  it('빌드 결과(.next/BUILD_ID)가 없으면 필요', () => {
    expect(needsBuild(root)).toBe(true)
  })
  it('빌드 뒤에 소스가 바뀌었으면 필요, 아니면 불필요', () => {
    fs.mkdirSync(path.join(root, '.next'))
    const id = path.join(root, '.next', 'BUILD_ID')
    fs.writeFileSync(id, 'abc')
    touch(id, 50)
    expect(needsBuild(root)).toBe(false)
    touch(path.join(root, 'app', 'page.tsx'), 100)
    expect(needsBuild(root)).toBe(true)
  })
})

describe('isPortFree', () => {
  it('쓰는 중인 포트는 false, 비어 있으면 true', async () => {
    const server = net.createServer()
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as net.AddressInfo).port
    expect(await isPortFree(port, '127.0.0.1')).toBe(false)
    await new Promise<void>((r) => server.close(() => r()))
    expect(await isPortFree(port, '127.0.0.1')).toBe(true)
  })
})
