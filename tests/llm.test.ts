import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { z } from 'zod'
import { askClaude as realAsk, extractJson, LlmError, type AskOpts } from '../src/core/llm.ts'

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
