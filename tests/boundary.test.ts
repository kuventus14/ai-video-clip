import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

const ROOT = path.resolve(import.meta.dirname, '..')

function filesUnder(dir: string): string[] {
  const abs = path.join(ROOT, dir)
  if (!fs.existsSync(abs)) return []
  const out: string[] = []
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...filesUnder(rel))
    else if (/\.(ts|tsx|mts|mjs)$/.test(e.name)) out.push(rel)
  }
  return out
}

/** 파일이 가져오는 모든 모듈 이름(import … from, import('…'), require('…')) */
function specifiersOf(file: string): string[] {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8')
  const out: string[] = []
  for (const re of [/\bfrom\s+['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g, /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g, /^\s*import\s+['"]([^'"]+)['"]/gm]) {
    for (const m of src.matchAll(re)) out.push(m[1]!)
  }
  return out
}

// 화면 쪽(app·components·shared·db·web·ui)은 편집 엔진(core)·워커(worker)를 가져오지 않는다.
// 엔진은 import.meta.dirname 처럼 번들러에 맞지 않는 코드를 쓰고, 화면 서버가 무거운 일을 직접 하면 안 되기 때문이다.
const UI_SIDE = ['app', 'components', 'src/shared', 'src/db', 'src/web', 'src/ui']

describe('화면 쪽과 편집 엔진의 경계', () => {
  test('Next.js 앱이 있다 (app/layout.tsx)', () => {
    expect(fs.existsSync(path.join(ROOT, 'app/layout.tsx'))).toBe(true)
  })

  test.each(UI_SIDE)('%s 는 core·worker 를 가져오지 않는다', (dir) => {
    const offenders = filesUnder(dir).flatMap((f) => specifiersOf(f).filter((s) => /(^|\/)(core|worker)(\/|$)/.test(s)).map((s) => `${f} → ${s}`))
    expect(offenders).toEqual([])
  })

  test.each(['src/shared', 'src/db'])('%s 는 node:*·zod·상대 경로만 가져온다', (dir) => {
    const offenders = filesUnder(dir).flatMap((f) =>
      specifiersOf(f)
        .filter((s) => !(s.startsWith('.') || s.startsWith('node:') || s === 'zod'))
        .map((s) => `${f} → ${s}`),
    )
    expect(offenders).toEqual([])
  })

  // shared/sound.ts·voice.ts 는 node:fs 를 쓴다. 브라우저에서 도는 코드가 값(함수·상수)을 가져오면 Turbopack 빌드가 터진다(시험·타입검사는 통과한다).
  test.each(['components', 'src/ui'])('%s 는 shared/sound·voice 에서 타입만 가져온다', (dir) => {
    const offenders = filesUnder(dir).flatMap((f) =>
      fs
        .readFileSync(path.join(ROOT, f), 'utf8')
        .split('\n')
        .filter((l) => /^\s*import\b(?!\s+type\b).*from\s+['"][^'"]*shared\/(sound|voice)\.ts['"]/.test(l))
        .map((l) => `${f}: ${l.trim()}`),
    )
    expect(offenders).toEqual([])
  })

  test('edit 엔진(core)·워커는 화면 쪽(app·components)을 가져오지 않는다', () => {
    const offenders = [...filesUnder('src/core'), ...filesUnder('src/worker')].flatMap((f) =>
      specifiersOf(f)
        .filter((s) => /(^|\/)(app|components)(\/|$)/.test(s))
        .map((s) => `${f} → ${s}`),
    )
    expect(offenders).toEqual([])
  })
})
