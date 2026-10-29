import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, test } from 'vitest'
import { childSpawnOptions, createHangupHandler, createSignalHandler, forwardSignals, isPortFree, killTree, latestMtimeMs, linePrefixer, needsBuild, nextBinPath, parseAppArgs } from '../scripts/app-lib.mjs'

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

describe('createSignalHandler — Ctrl+C 한 번에 진행 중인 작업이 죽지 않게', () => {
  function setup() {
    const calls: string[] = []
    let t = 1_000_000
    const children = ['web', 'worker']
    const handler = createSignalHandler({
      listChildren: () => children,
      terminate: (c) => calls.push(`TERM ${c}`),
      killGroup: (c) => calls.push(`KILL ${c}`),
      exit: (code) => calls.push(`exit ${code}`),
      say: (m) => calls.push(`say ${m.slice(0, 6)}`),
      now: () => t,
    })
    return { handler, calls, advance: (ms: number) => (t += ms) }
  }

  it('첫 신호는 자식마다 SIGTERM 을 정확히 한 번 보내고 안내한다(워커는 진행 중인 작업을 끝낸다)', () => {
    const { handler, calls } = setup()
    expect(handler('SIGINT')).toBe('graceful')
    expect(calls.filter((c) => c.startsWith('TERM'))).toEqual(['TERM web', 'TERM worker'])
    expect(calls.some((c) => c.startsWith('KILL') || c.startsWith('exit'))).toBe(false)
  })

  it('터미널과 npm 이 같은 Ctrl+C 를 두 번 전달해도(1초 안의 중복) 한 번으로 친다', () => {
    const { handler, calls, advance } = setup()
    handler('SIGINT')
    advance(30)
    expect(handler('SIGINT')).toBe('ignored')
    advance(400)
    expect(handler('SIGTERM')).toBe('ignored')
    expect(calls.filter((c) => c.startsWith('TERM'))).toHaveLength(2) // web, worker 한 번씩뿐
    expect(calls.some((c) => c.startsWith('KILL') || c.startsWith('exit'))).toBe(false)
  })

  it('시간을 두고 사용자가 한 번 더 누르면 프로세스 그룹째(렌더 도구 포함) 강제 종료한다', () => {
    const { handler, calls, advance } = setup()
    handler('SIGINT')
    advance(5000)
    expect(handler('SIGINT')).toBe('force')
    expect(calls.filter((c) => c.startsWith('KILL'))).toEqual(['KILL web', 'KILL worker'])
    expect(calls[calls.length - 1]).toBe('exit 1')
  })
})

describe('killTree — 자식과 그 자식들을 함께 끝낸다(플랫폼별)', () => {
  test('윈도우: taskkill /T /F 로 트리째 끝낸다', () => {
    const calls: unknown[][] = []
    killTree(123, { platform: 'win32', spawnSync: (...a: unknown[]) => void calls.push(a) })
    expect(calls).toEqual([['taskkill', ['/pid', '123', '/T', '/F'], { stdio: 'ignore', windowsHide: true }]])
  })
  test('맥·리눅스: 프로세스 그룹째(-pid) SIGKILL', () => {
    const calls: unknown[][] = []
    killTree(123, { platform: 'darwin', kill: (...a: unknown[]) => void calls.push(a) })
    expect(calls).toEqual([[-123, 'SIGKILL']])
  })
  test('이미 끝나서 던져도 조용히 넘어간다', () => {
    expect(() => killTree(1, { platform: 'linux', kill: () => { throw new Error('ESRCH') } })).not.toThrow()
    expect(() => killTree(1, { platform: 'win32', spawnSync: () => { throw new Error('x') } })).not.toThrow()
  })
  test('pid 가 없으면 아무것도 하지 않는다', () => {
    const calls: unknown[][] = []
    killTree(undefined, { platform: 'darwin', kill: (...a: unknown[]) => void calls.push(a) })
    expect(calls).toEqual([])
  })
})

describe('nextBinPath — next 를 node 로 직접 실행하는 파일', () => {
  test('.bin 의 셸 스크립트(윈도우는 .cmd)가 아니라 next 패키지 안의 JS 파일을 가리킨다', () => {
    expect(nextBinPath('/app')).toBe(path.join('/app', 'node_modules', 'next', 'dist', 'bin', 'next'))
    expect(fs.existsSync(nextBinPath(path.resolve(import.meta.dirname, '..')))).toBe(true)
  })
})

describe('forwardSignals — 감싼 프로그램이 받은 종료 신호를 자식(next)에게 넘긴다', () => {
  test('SIGTERM·SIGINT·SIGHUP 를 받으면 같은 신호로 자식을 끝낸다(안 그러면 포트를 잡은 채 남는다)', () => {
    const proc = new EventEmitter()
    const killed: string[] = []
    forwardSignals({ kill: (s?: string) => void killed.push(String(s)) }, proc)
    proc.emit('SIGTERM')
    proc.emit('SIGINT')
    proc.emit('SIGHUP')
    expect(killed).toEqual(['SIGTERM', 'SIGINT', 'SIGHUP'])
  })
})

describe('childSpawnOptions — 자식 프로세스를 띄우는 방식', () => {
  test('맥·리눅스: 자기 프로세스 그룹(detached)에 둔다', () => {
    expect(childSpawnOptions('darwin')).toEqual({ detached: true, windowsHide: true })
    expect(childSpawnOptions('linux')).toEqual({ detached: true, windowsHide: true })
  })
  test('윈도우: detached 는 콘솔 없는 프로세스라 Next 가 만드는 하위 프로세스마다 검은 창이 뜬다 — 쓰지 않는다', () => {
    expect(childSpawnOptions('win32')).toEqual({ detached: false, windowsHide: true })
  })
})

describe('createHangupHandler — 터미널·콘솔 창을 닫을 때(SIGHUP)', () => {
  test('자식을 트리째 끝내고 종료한다(보이지 않는 채로 포트를 잡고 남지 않게)', () => {
    const killed: number[] = []
    const exits: number[] = []
    const handle = createHangupHandler({ listChildren: () => [{ pid: 11 }, { pid: 22 }], kill: (pid: number) => void killed.push(pid), exit: (c: number) => void exits.push(c) })
    handle()
    expect(killed).toEqual([11, 22])
    expect(exits).toEqual([1])
  })
})
