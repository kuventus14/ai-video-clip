#!/usr/bin/env node
// 영상 편집 앱을 한 번에 켠다: 화면(웹 서버) + 처리 프로그램(워커).
//   npm run app          운영 모드. 소스가 바뀌었으면 먼저 빌드한다. (--rebuild 로 강제)
//   npm run app:dev      개발 모드(next dev)
// 로그 앞에는 [web] / [worker] 가 붙는다. Ctrl+C 한 번: 진행 중인 작업을 끝내고 종료, 두 번: 바로 종료.
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSignalHandler, isPortFree, killTree, linePrefixer, needsBuild, nextBinPath, parseAppArgs } from './app-lib.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HOST = '127.0.0.1'
const port = Number(process.env.VAE_PORT ?? 4848)
const say = (line) => console.log(line)

let args
try {
  args = parseAppArgs(process.argv.slice(2))
} catch (e) {
  console.error(`[app] ${e.message}\n사용법: npm run app [-- --rebuild]  /  npm run app:dev`)
  process.exit(2)
}

if (!(await isPortFree(port, HOST))) {
  console.error(`[app] ${port} 포트를 이미 다른 프로그램이 쓰고 있어요. 이미 앱이 켜져 있다면 http://${HOST}:${port} 를 열어 보세요.\n      다른 포트로 켜려면: ${process.platform === 'win32' ? '$env:VAE_PORT=4949; npm run app (PowerShell)' : 'VAE_PORT=4949 npm run app'}`)
  process.exit(1)
}

/** 자식 프로세스를 띄우고 출력에 접두어를 붙여 이어 준다. */
function run(prefix, command, commandArgs) {
  // detached: 자식을 자기 프로세스 그룹에 둔다 — 터미널의 Ctrl+C 가 자식(렌더링 중인 워커·hyperframes·ffmpeg)에게 직접 가서
  // 진행 중인 작업이 바로 죽는 일이 없게 하고, 종료는 런처가 정해진 순서로 알린다.
  const child = spawn(command, commandArgs, { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true, windowsHide: true })
  const out = linePrefixer(prefix, say)
  const err = linePrefixer(prefix, say)
  child.stdout.on('data', (c) => out.write(c))
  child.stderr.on('data', (c) => err.write(c))
  child.on('close', () => {
    out.flush()
    err.flush()
  })
  return child
}

const exited = (child) => new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })))

if (!args.dev && (args.rebuild || needsBuild(root))) {
  say('[app] 화면을 빌드해요 (처음이거나 소스가 바뀌었을 때만 해요. 1~2분 걸릴 수 있어요)')
  const { code } = await exited(run('[build]', process.execPath, [nextBinPath(root), 'build']))
  if (code !== 0) {
    console.error('[app] 빌드에 실패했어요. 위의 [build] 로그를 확인해 주세요.')
    process.exit(1)
  }
}

let shuttingDown = false
const children = new Set()

const web = run('[web]', process.execPath, [nextBinPath(root), args.dev ? 'dev' : 'start', '-H', HOST, '-p', String(port)]) // .bin/next 는 윈도우에서 .cmd 라 node 로 직접 연다
children.add(web)

// 워커가 예상치 못하게 멈추면 작업이 조용히 멈춰 버리므로 다시 켠다(짧은 시간에 반복해서 죽으면 포기한다).
const restarts = []
function startWorker() {
  // tsx 실행 파일을 거치지 않고 node 가 직접 tsx 로 워커를 연다 — 종료 신호가 중간 단계에서 한 번 더 전달되는 일이 없다.
  const worker = run('[worker]', process.execPath, ['--import', 'tsx', 'src/worker/main.ts'])
  children.add(worker)
  worker.once('exit', (code, signal) => {
    children.delete(worker)
    if (shuttingDown) return
    const now = Date.now()
    restarts.push(now)
    while (restarts.length && now - restarts[0] > 120_000) restarts.shift()
    if (restarts.length > 5) {
      console.error('[app] 처리 프로그램이 계속 멈춰서 종료해요. 위의 [worker] 로그를 확인해 주세요.')
      shutdown(1)
      return
    }
    say(`[app] 처리 프로그램이 멈췄어요 (${signal ?? `코드 ${code}`}). 3초 뒤 다시 켜요. 진행 중이던 작업은 "중단됐어요"로 표시돼요.`)
    setTimeout(() => !shuttingDown && startWorker(), 3000)
  })
}
startWorker()

web.once('exit', (code, signal) => {
  children.delete(web)
  if (!shuttingDown) {
    console.error(`[app] 화면 서버가 멈췄어요 (${signal ?? `코드 ${code}`}). 앱을 종료해요.`)
    shutdown(code || 1)
  }
})

/** 자식이 모두 끝나면 종료한다 */
function exitWhenChildrenGone(exitCode) {
  const timer = setInterval(() => {
    if (children.size === 0) {
      clearInterval(timer)
      process.exit(exitCode)
    }
  }, 200)
}

/**
 * 자식에게 "끝내 달라"고 알린다. 맥·리눅스는 SIGTERM 이라 워커가 진행 중인 작업을 끝내고 종료한다.
 * 윈도우는 신호가 없어 SIGTERM 이 곧바로 강제 종료라서, 렌더링 도구까지 함께 트리째 끝낸다(진행 중이던 작업은 다음 실행 때 "중단됐어요"로 표시된다).
 */
function terminate(c) {
  if (process.platform === 'win32') killTree(c.pid)
  else c.kill('SIGTERM')
}

/** 앱 안에서 정한 종료(화면 서버가 죽음, 워커가 계속 죽음): 자식에게 한 번씩 알리고 끝나길 기다린다 */
function shutdown(exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const c of children) terminate(c)
  exitWhenChildrenGone(exitCode)
}

// 터미널의 Ctrl+C 는 자식이 아니라 런처만 받는다(자식은 자기 그룹). 첫 신호: 진행 중인 작업을 끝내고 종료, 시간을 두고 한 번 더: 강제 종료.
// 터미널과 npm 이 같은 Ctrl+C 를 두 번 전달하는 경우는 1초 안의 중복으로 보고 무시한다(app-lib 의 createSignalHandler).
const onSignal = createSignalHandler({
  listChildren: () => [...children],
  terminate,
  killGroup: (c) => killTree(c.pid), // 프로세스 그룹(윈도우는 트리)째: 워커가 띄운 렌더링 도구까지
  exit: (code) => process.exit(code),
  say,
})
const handleSignal = () => {
  const first = !shuttingDown
  shuttingDown = true
  if (onSignal() === 'graceful' && first) exitWhenChildrenGone(0)
}
process.on('SIGINT', handleSignal)
process.on('SIGTERM', handleSignal)

// 화면이 열리면 주소를 알려 준다
const url = `http://${HOST}:${port}`
for (let i = 0; i < 120 && !shuttingDown; i++) {
  try {
    const res = await fetch(`${url}/api/jobs`)
    if (res.ok) {
      say(`\n[app] 준비됐어요: ${url}   (종료: Ctrl+C)\n`)
      break
    }
  } catch {
    // 아직 켜지는 중
  }
  await new Promise((r) => setTimeout(r, 1000))
}
