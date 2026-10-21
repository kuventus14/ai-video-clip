#!/usr/bin/env node
// 영상 편집 앱을 한 번에 켠다: 화면(웹 서버) + 처리 프로그램(워커).
//   npm run app          운영 모드. 소스가 바뀌었으면 먼저 빌드한다. (--rebuild 로 강제)
//   npm run app:dev      개발 모드(next dev)
// 로그 앞에는 [web] / [worker] 가 붙는다. Ctrl+C 한 번: 진행 중인 작업을 끝내고 종료, 두 번: 바로 종료.
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isPortFree, linePrefixer, needsBuild, parseAppArgs } from './app-lib.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HOST = '127.0.0.1'
const port = Number(process.env.VAE_PORT ?? 4848)
const bin = (name) => path.join(root, 'node_modules', '.bin', name)
const say = (line) => console.log(line)

let args
try {
  args = parseAppArgs(process.argv.slice(2))
} catch (e) {
  console.error(`[app] ${e.message}\n사용법: npm run app [-- --rebuild]  /  npm run app:dev`)
  process.exit(2)
}

if (!(await isPortFree(port, HOST))) {
  console.error(`[app] ${port} 포트를 이미 다른 프로그램이 쓰고 있어요. 이미 앱이 켜져 있다면 http://${HOST}:${port} 를 열어 보세요.\n      다른 포트로 켜려면: VAE_PORT=4949 npm run app`)
  process.exit(1)
}

/** 자식 프로세스를 띄우고 출력에 접두어를 붙여 이어 준다. */
function run(prefix, command, commandArgs) {
  const child = spawn(command, commandArgs, { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
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
  const { code } = await exited(run('[build]', bin('next'), ['build']))
  if (code !== 0) {
    console.error('[app] 빌드에 실패했어요. 위의 [build] 로그를 확인해 주세요.')
    process.exit(1)
  }
}

let shuttingDown = false
let signalCount = 0
const children = new Set()

const web = run('[web]', bin('next'), [args.dev ? 'dev' : 'start', '-H', HOST, '-p', String(port)])
children.add(web)

// 워커가 예상치 못하게 멈추면 작업이 조용히 멈춰 버리므로 다시 켠다(짧은 시간에 반복해서 죽으면 포기한다).
const restarts = []
function startWorker() {
  const worker = run('[worker]', bin('tsx'), ['src/worker/main.ts'])
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

function shutdown(exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const c of children) c.kill('SIGTERM')
  const timer = setInterval(() => {
    if (children.size === 0) {
      clearInterval(timer)
      process.exit(exitCode)
    }
  }, 200)
}

// 터미널의 Ctrl+C 는 자식에게도 이미 전달된다 — 여기서는 한 번 더 보내지 않고 끝나기를 기다린다.
// (워커는 첫 신호에 진행 중인 작업을 끝내고, 두 번째 신호에 바로 종료한다.)
process.on('SIGINT', () => {
  signalCount++
  if (signalCount === 1) {
    say('[app] 종료하는 중이에요. 처리 중인 작업이 있으면 끝날 때까지 기다려요 (바로 끝내려면 Ctrl+C 를 한 번 더)')
    shutdown(0)
  } else {
    for (const c of children) c.kill('SIGKILL')
    process.exit(1)
  }
})
// kill 로 종료하는 경우(터미널 신호가 아님)에는 자식에게 직접 알린다. 두 번째는 강제 종료.
process.on('SIGTERM', () => {
  signalCount++
  if (signalCount === 1) shutdown(0)
  else {
    for (const c of children) c.kill('SIGKILL')
    process.exit(1)
  }
})

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
