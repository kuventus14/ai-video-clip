#!/usr/bin/env node
// 화면 서버만 켠다(처리 프로그램 없이): npm run web:dev / web:start. 포트는 VAE_PORT(기본 4848).
// package.json 에 `${VAE_PORT:-4848}` 를 쓰면 윈도우(cmd)에서 안 돼서 node 로 푼다.
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { nextBinPath } from './app-lib.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mode = process.argv[2]
if (mode !== 'dev' && mode !== 'start') {
  console.error('사용법: node scripts/web.mjs dev|start')
  process.exit(2)
}
const child = spawn(process.execPath, [nextBinPath(root), mode, '-H', '127.0.0.1', '-p', process.env.VAE_PORT ?? '4848'], { cwd: root, stdio: 'inherit' })
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
