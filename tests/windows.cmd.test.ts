import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { run } from '../src/core/exec.ts'

// 윈도우에서만 돈다: npm 전역 설치 도구(hyperframes.cmd)처럼 .cmd 를 shell 로 실행할 때, 한글·공백·& 가 든 경로와 인자가 그대로 도착하는가.
// (CI 의 임시 폴더는 영어 이름이라 이 경우를 지나치기 쉽다.)
describe.skipIf(process.platform !== 'win32')('윈도우 .cmd 실행 — 한글·공백이 든 경로', () => {
  test('인자가 그대로 도착한다', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), '한글 폴더 & (x) '))
    try {
      fs.writeFileSync(path.join(dir, 'show-args.mjs'), 'console.log(JSON.stringify(process.argv.slice(2)))\n')
      fs.writeFileSync(path.join(dir, '도구.cmd'), `@echo off\r\n"${process.execPath}" "%~dp0show-args.mjs" %*\r\n`)
      const args = ['render', '.', '--quality', 'looks', '-o', path.join(dir, '결과 영상.mp4')]
      const { stdout } = await run(path.join(dir, '도구.cmd'), args)
      expect(JSON.parse(stdout.trim().split('\n').pop()!)).toEqual(args)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
