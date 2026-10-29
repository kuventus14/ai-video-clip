// scripts/app.mjs 의 순수한 부분 — 시험할 수 있게 따로 둔다.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'

/**
 * 자식 프로세스의 출력을 줄 단위로 나눠 접두어를 붙여 내보낸다.
 * 줄 중간에서 끊겨 온 조각과 바이트 경계에서 쪼개진 한글은 이어 붙이고, 빈 줄은 건너뛰고, 이미 같은 접두어가 붙어 온 줄은 그대로 두고,
 * \r 로 덮어쓰는 진행 표시는 마지막 상태만 남긴다.
 */
export function linePrefixer(prefix, sink) {
  const decoder = new StringDecoder('utf8')
  let pending = ''
  const emit = (text) => {
    const last = text.split('\r').filter((s) => s.length > 0).pop()
    if (last === undefined || last.trim() === '') return
    sink(last.startsWith(`${prefix} `) ? last : `${prefix} ${last}`)
  }
  return {
    write(chunk) {
      pending += decoder.write(chunk)
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) emit(line)
    },
    flush() {
      pending += decoder.end()
      if (pending) emit(pending)
      pending = ''
    },
  }
}

export function parseAppArgs(argv) {
  const out = { dev: false, rebuild: false }
  for (const a of argv) {
    if (a === '--dev') out.dev = true
    else if (a === '--rebuild') out.rebuild = true
    else throw new Error(`알 수 없는 옵션이에요: ${a}`)
  }
  return out
}

/** 폴더(또는 파일) 목록 안에서 가장 늦게 바뀐 파일의 수정 시각(ms). 없는 경로는 무시한다. */
export function latestMtimeMs(paths) {
  let latest = 0
  const visit = (p) => {
    let stat
    try {
      stat = fs.statSync(p)
    } catch {
      return
    }
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(p)) visit(path.join(p, name))
    } else if (stat.mtimeMs > latest) {
      latest = stat.mtimeMs
    }
  }
  for (const p of paths) visit(p)
  return latest
}

/** 빌드 결과(.next/BUILD_ID)가 없거나, 빌드 뒤에 소스가 바뀌었으면 true */
export function needsBuild(root) {
  let builtAt
  try {
    builtAt = fs.statSync(path.join(root, '.next', 'BUILD_ID')).mtimeMs
  } catch {
    return true
  }
  const sources = ['app', 'components', 'src', 'package.json', 'next.config.ts', 'postcss.config.mjs', 'tsconfig.json'].map((p) => path.join(root, p))
  return latestMtimeMs(sources) > builtAt
}

/** 그 포트를 쓸 수 있는지(아무도 듣고 있지 않은지) */
export function isPortFree(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, host)
  })
}

/**
 * 종료 신호(Ctrl+C·kill) 처리. 처음 한 번은 자식마다 SIGTERM 을 정확히 한 번 보낸다 — 워커는 이걸 "진행 중인 작업을 끝내고 종료"로
 * 받아들인다. 터미널(프로세스 그룹)과 npm 이 같은 Ctrl+C 를 각각 전달해 한 번 누른 것이 두 번 오기도 하므로, 직전 신호에서
 * debounceMs(기본 1초) 안에 온 신호는 같은 Ctrl+C 로 보고 무시한다. 시간을 두고 다시 오면 사용자가 일부러 누른 것이니
 * 자식을 프로세스 그룹째(렌더링 도구 포함) 강제 종료한다.
 * @returns 'graceful' | 'ignored' | 'force'
 */
export function createSignalHandler({ listChildren, terminate, killGroup, exit, say, now = Date.now, debounceMs = 1000 }) {
  let stopping = false
  let last = 0
  return function onSignal() {
    const t = now()
    if (stopping && t - last < debounceMs) return 'ignored'
    last = t
    if (!stopping) {
      stopping = true
      say('[app] 종료하는 중이에요. 처리 중인 작업이 있으면 끝날 때까지 기다려요 (바로 끝내려면 Ctrl+C 를 한 번 더)')
      for (const child of listChildren()) terminate(child)
      return 'graceful'
    }
    for (const child of listChildren()) killGroup(child)
    exit(1)
    return 'force'
  }
}

/**
 * 자식 프로세스를 그 자식들(렌더링 도구 포함)과 함께 끝낸다.
 * 맥·리눅스는 자식이 자기 프로세스 그룹이라 그룹째(-pid) 끝내고, 윈도우는 그룹이 없어서 taskkill 의 /T(트리)로 끝낸다.
 * 이미 끝났으면 조용히 넘어간다. 옵션은 시험에서 가짜로 바꿔 끼우는 용도.
 */
export function killTree(pid, { platform = process.platform, spawnSync: spawnSyncFn = spawnSync, kill = process.kill.bind(process) } = {}) {
  if (pid === undefined) return
  try {
    if (platform === 'win32') spawnSyncFn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    else kill(-pid, 'SIGKILL')
  } catch {
    // 이미 끝났다
  }
}

/** next 를 node 로 직접 실행할 JS 파일. node_modules/.bin/next 는 윈도우에서 .cmd 라 spawn 이 거절한다. */
export function nextBinPath(root) {
  return path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next')
}
