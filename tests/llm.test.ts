import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { z } from 'zod'
import { askClaude as realAsk, cleanEnv, extractJson, LlmError, type AskOpts } from '../src/core/llm.ts'

const FAKE = path.resolve(import.meta.dirname, 'fixtures/fake-claude.mjs')

// askClaude 는 자식 프로세스 환경을 화이트리스트로 새로 짓는다. 가짜 claude 가 읽는 FAKE_CLAUDE_* 는 env 옵션으로 넘긴다.
function fakeEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const k of ['FAKE_CLAUDE_REPLIES', 'FAKE_CLAUDE_LOG', 'FAKE_CLAUDE_SLEEP_MS']) if (process.env[k]) out[k] = process.env[k]!
  return out
}
const askClaude = ((o: AskOpts) => realAsk({ ...o, env: fakeEnv() })) as typeof realAsk

let dir: string
const saved: Record<string, string | undefined> = {}
const KEYS = ['VAE_CLAUDE_BIN', 'FAKE_CLAUDE_REPLIES', 'FAKE_CLAUDE_LOG', 'FAKE_CLAUDE_SLEEP_MS', 'CLAUDECODE']

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-'))
  fs.chmodSync(FAKE, 0o755)
  for (const k of KEYS) saved[k] = process.env[k]
  process.env.VAE_CLAUDE_BIN = FAKE
  process.env.FAKE_CLAUDE_LOG = path.join(dir, 'log.jsonl')
  delete process.env.FAKE_CLAUDE_SLEEP_MS
})
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  fs.rmSync(dir, { recursive: true, force: true })
})

function replies(...r: unknown[]) {
  const f = path.join(dir, 'replies.json')
  fs.writeFileSync(f, JSON.stringify(r))
  process.env.FAKE_CLAUDE_REPLIES = f
}
function calls(): { argv: string[]; stdin: string; imageCount: number; claudecode: string | null }[] {
  const f = process.env.FAKE_CLAUDE_LOG!
  if (!fs.existsSync(f)) return []
  return fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

describe('extractJson', () => {
  test('코드펜스와 잡담 속의 첫 JSON 을 꺼낸다', () => {
    expect(extractJson('여기 있어요:\n```json\n{"a":1,"b":"}"}\n```\n끝')).toEqual({ a: 1, b: '}' })
    expect(extractJson('[1,2]')).toEqual([1, 2])
  })
  test('JSON 이 없으면 던진다', () => {
    expect(() => extractJson('그냥 글')).toThrow()
  })
})

describe('askClaude', () => {
  test('문자열 답을 돌려준다', async () => {
    replies('안녕하세요')
    expect(await askClaude({ prompt: '인사해' })).toBe('안녕하세요')
    expect(calls()).toHaveLength(1)
  })

  test('schema 가 있으면 JSON 을 꺼내 검증한 값을 돌려준다 (코드펜스 포함)', async () => {
    replies('```json\n{"a":1}\n```')
    const out = await askClaude({ prompt: 'x', schema: z.object({ a: z.number() }) })
    expect(out).toEqual({ a: 1 })
  })

  test('첫 답이 JSON 이 아니면 한 번 다시 물어 성공한다', async () => {
    replies('죄송해요 그냥 글이에요', '{"a":2}')
    const out = await askClaude({ prompt: '숫자', schema: z.object({ a: z.number() }) })
    expect(out).toEqual({ a: 2 })
    const c = calls()
    expect(c).toHaveLength(2)
    expect(c[1]!.stdin).toContain('재요청')
  })

  test('두 번 다 JSON 이 아니면 LlmError(invalid-json)', async () => {
    replies('글', '또 글')
    const err = await askClaude({ prompt: 'x', schema: z.object({ a: z.number() }) }).catch((e) => e)
    expect(err).toBeInstanceOf(LlmError)
    expect((err as LlmError).kind).toBe('invalid-json')
    expect(calls()).toHaveLength(2)
  })

  test('JSON 은 맞지만 모양이 틀리면 한 번 재시도 후 LlmError(schema)', async () => {
    replies('{"a":"문자"}', '{"a":"또 문자"}')
    const err = await askClaude({ prompt: 'x', schema: z.object({ a: z.number() }) }).catch((e) => e)
    expect((err as LlmError).kind).toBe('schema')
    expect(calls()).toHaveLength(2)
  })

  test('이미지는 개수만큼 구조화 메시지로 전달된다', async () => {
    const a = path.join(dir, 'a.jpg')
    const b = path.join(dir, 'b.jpg')
    fs.writeFileSync(a, 'AAA')
    fs.writeFileSync(b, 'BBB')
    replies('ok')
    await askClaude({ prompt: '봐', images: [a, b] })
    const c = calls()[0]!
    expect(c.imageCount).toBe(2)
    expect(c.argv).toContain('--input-format')
  })

  test('이미지가 없으면 --input-format 을 쓰지 않는다', async () => {
    replies('ok')
    await askClaude({ prompt: '글만', system: '시스템 지시' })
    const c = calls()[0]!
    expect(c.argv).not.toContain('--input-format')
    expect(c.argv).toContain('--append-system-prompt')
    expect(c.stdin).toBe('글만')
  })

  test('부모의 CLAUDECODE 환경변수를 자식에게 물려주지 않는다 (중첩 세션 멈춤 방지)', async () => {
    process.env.CLAUDECODE = '1'
    replies('ok')
    await askClaude({ prompt: 'x' })
    expect(calls()[0]!.claudecode).toBeNull()
  })

  test('claude 가 오류 결과를 내면 LlmError(spawn)', async () => {
    replies({ error: '로그인이 필요해요' })
    const err = await askClaude({ prompt: 'x' }).catch((e) => e)
    expect(err).toBeInstanceOf(LlmError)
    expect((err as LlmError).kind).toBe('spawn')
    expect((err as LlmError).message).toContain('로그인')
  })

  test('실행 파일이 없으면 LlmError(spawn)', async () => {
    process.env.VAE_CLAUDE_BIN = '/nonexistent/claude'
    const err = await askClaude({ prompt: 'x' }).catch((e) => e)
    expect((err as LlmError).kind).toBe('spawn')
  })

  test('제한 시간을 넘기면 LlmError(timeout)', async () => {
    replies('늦은 답')
    process.env.FAKE_CLAUDE_SLEEP_MS = '3000'
    const err = await askClaude({ prompt: 'x', timeoutMs: 300 }).catch((e) => e)
    expect((err as LlmError).kind).toBe('timeout')
  })
})

describe('cleanEnv — claude 를 부를 때 자식 프로세스 환경(플랫폼별)', () => {
  const base = { PATH: '/ignored:/usr/bin', FOO: 'x', ANTHROPIC_API_KEY: 'k', CLAUDE_CODE_OAUTH_TOKEN: 't', CLAUDECODE: '1' }
  test('맥: 예전과 같은 화이트리스트 — 모르는 변수는 안 넘기고 PATH 는 정해 둔 위치만(":")', () => {
    const e = cleanEnv({ EXTRA: '1' }, { platform: 'darwin', env: { ...base, HOME: '/Users/me' }, home: '/Users/me' })
    expect(e.PATH).toBe('/usr/local/bin:/opt/homebrew/bin:/Users/me/.npm-global/bin:/Users/me/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin')
    expect(e).toMatchObject({ HOME: '/Users/me', ANTHROPIC_API_KEY: 'k', CLAUDE_CODE_OAUTH_TOKEN: 't', EXTRA: '1' })
    expect(e.FOO).toBeUndefined()
    expect(e.CLAUDECODE).toBeUndefined()
  })
  test('리눅스: 지금 PATH 를 앞에 두고 정해 둔 위치를 뒤에 이어서(nvm 의 node 가 오래된 /usr/bin/node 에 가리지 않게)', () => {
    const e = cleanEnv({}, { platform: 'linux', env: { ...base, HOME: '/home/me' }, home: '/home/me' })
    expect(e.PATH).toBe('/ignored:/usr/bin:/usr/local/bin:/home/me/.npm-global/bin:/home/me/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin')
    expect(e.HOME).toBe('/home/me')
  })
  test('윈도우: 필수 변수(SystemRoot·USERPROFILE·APPDATA·TEMP·PATHEXT 등)를 넘기고 PATH 는 ";" 로 잇는다', () => {
    const env = { Path: 'C:\\Windows\\System32;C:\\Git\\bin', SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\Users\\me', APPDATA: 'C:\\Users\\me\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', TEMP: 'C:\\T', PATHEXT: '.COM;.EXE', ComSpec: 'C:\\Windows\\System32\\cmd.exe', CLAUDE_CODE_GIT_BASH_PATH: 'C:\\Git\\bin\\bash.exe', FOO: 'x', ANTHROPIC_API_KEY: 'k' }
    const e = cleanEnv({}, { platform: 'win32', env, home: 'C:\\Users\\me' })
    expect(e).toMatchObject({ SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\Users\\me', APPDATA: 'C:\\Users\\me\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', TEMP: 'C:\\T', PATHEXT: '.COM;.EXE', ComSpec: 'C:\\Windows\\System32\\cmd.exe', CLAUDE_CODE_GIT_BASH_PATH: 'C:\\Git\\bin\\bash.exe', ANTHROPIC_API_KEY: 'k' })
    expect(e.FOO).toBeUndefined()
    const pathValue = Object.entries(e).find(([k]) => k.toLowerCase() === 'path')![1] as string
    expect(pathValue.split(';')).toEqual(expect.arrayContaining(['C:\\Windows\\System32', 'C:\\Git\\bin', 'C:\\Users\\me\\.local\\bin']))
    expect(pathValue).not.toContain('/usr/local/bin')
    expect(Object.keys(e).filter((k) => k.toLowerCase() === 'path')).toHaveLength(1)
  })
  test('윈도우: 이 앱이 정한 값(env 옵션)이 덮어쓴다', () => {
    expect(cleanEnv({ FAKE_X: '1' }, { platform: 'win32', env: { SystemRoot: 'C:\\Windows' }, home: 'C:\\Users\\me' }).FAKE_X).toBe('1')
  })
})
