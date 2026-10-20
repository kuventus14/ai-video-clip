import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { ToolError } from '../src/core/exec.ts'
import type { run } from '../src/core/exec.ts'
import { classifySource, fetchReference, ReferenceFetchError } from '../src/core/reference.ts'
import { ensureFixtures, type Fixtures } from './helpers/fixtures.ts'

let fx: Fixtures
let work: string
beforeAll(async () => {
  fx = await ensureFixtures()
})
beforeEach(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'ref-'))
})

describe('classifySource', () => {
  test('주소와 파일 경로를 구분한다', () => {
    expect(classifySource('https://www.youtube.com/shorts/abc')).toBe('youtube')
    expect(classifySource('https://youtu.be/abc')).toBe('youtube')
    expect(classifySource('https://www.youtube.com/watch?v=abc')).toBe('youtube')
    expect(classifySource('https://www.instagram.com/reel/x/')).toBe('instagram')
    expect(classifySource('https://example.com/a.mp4')).toBe('other-url')
    expect(classifySource('/tmp/a.mp4')).toBe('file')
    expect(classifySource('./영상 (1).mp4')).toBe('file')
  })
})

describe('fetchReference — URL', () => {
  // yt-dlp 를 흉내내 -o 템플릿 경로에 합성 영상을 만들어 둔다
  function fakeYtdlp(calls: { file: string; args: string[] }[]): typeof run {
    return (async (file: string, args: string[]) => {
      calls.push({ file, args })
      const template = args[args.indexOf('-o') + 1]!
      fs.copyFileSync(fx.portrait, template.replace('%(ext)s', 'mp4'))
      return { stdout: '', stderr: '' }
    }) as unknown as typeof run
  }

  test('앞 3분만, 재생목록 없이, workDir 안에 받는다', async () => {
    const calls: { file: string; args: string[] }[] = []
    const ref = await fetchReference('https://www.youtube.com/shorts/abc', work, { run: fakeYtdlp(calls) })
    expect(calls).toHaveLength(1)
    const { file, args } = calls[0]!
    expect(file).toBe('yt-dlp')
    expect(args).toEqual(expect.arrayContaining(['--download-sections', '*0-180', '--no-playlist', '--merge-output-format', 'mp4']))
    expect(args[args.indexOf('-o') + 1]!.startsWith(work)).toBe(true)
    expect(args[args.length - 1]).toBe('https://www.youtube.com/shorts/abc')
    expect(ref.origin).toBe('url')
    expect(ref.path.startsWith(work)).toBe(true)
    expect([ref.info.width, ref.info.height]).toEqual([1080, 1920])
  })

  test('cleanup 이 받은 파일을 지운다', async () => {
    const ref = await fetchReference('https://youtu.be/abc', work, { run: fakeYtdlp([]) })
    expect(fs.existsSync(ref.path)).toBe(true)
    await ref.cleanup()
    expect(fs.readdirSync(work).filter((f) => f.startsWith('reference.'))).toEqual([])
  })

  const failing = (stderr: string, code: number | null = 1): typeof run =>
    (async () => {
      throw new ToolError('yt-dlp', code, stderr)
    }) as unknown as typeof run

  test.each([
    ['ERROR: [youtube] abc: Private video. Sign in if you\'ve been granted access', 'private'],
    ['ERROR: [Instagram] x: login required to view this content', 'private'],
    ['ERROR: Unsupported URL: https://example.com/page', 'unsupported'],
    ['ERROR: Unable to download webpage: <urlopen error [Errno 8] nodename nor servname provided>', 'unreachable'],
  ])('yt-dlp 오류 "%s" → %s', async (stderr, kind) => {
    const err = await fetchReference('https://www.youtube.com/watch?v=abc', work, { run: failing(stderr) }).catch((e) => e)
    expect(err).toBeInstanceOf(ReferenceFetchError)
    expect((err as ReferenceFetchError).kind).toBe(kind)
    expect((err as ReferenceFetchError).message).toMatch(/[가-힣]/)
  })

  test('yt-dlp 를 실행할 수 없어도 unreachable 로 알린다', async () => {
    const err = await fetchReference('https://youtu.be/abc', work, { run: failing('spawn yt-dlp ENOENT', null) }).catch((e) => e)
    expect((err as ReferenceFetchError).kind).toBe('unreachable')
  })

  test('받은 파일이 없으면 unreachable', async () => {
    const empty = (async () => ({ stdout: '', stderr: '' })) as unknown as typeof run
    const err = await fetchReference('https://youtu.be/abc', work, { run: empty }).catch((e) => e)
    expect((err as ReferenceFetchError).kind).toBe('unreachable')
  })
})

describe('fetchReference — 실제 내려받기', () => {
  test.skipIf(process.env.INTEGRATION !== '1')('공개 유튜브 영상을 앞 3분 이내로 받아 영상으로 읽는다', async () => {
    const ref = await fetchReference('https://www.youtube.com/watch?v=ovvnJ4Y2tR0', work)
    expect(ref.origin).toBe('url')
    expect(ref.info.durationSec).toBeGreaterThan(30)
    expect(ref.info.durationSec).toBeLessThanOrEqual(181)
    await ref.cleanup()
    expect(fs.readdirSync(work).filter((f) => f.startsWith('reference.'))).toEqual([])
  }, 300_000)
})

describe('fetchReference — 파일', () => {
  test('원본은 건드리지 않고 workDir 로 복사한다 (한글·공백 파일명 포함)', async () => {
    const ref = await fetchReference(fx.koreanName, work)
    expect(ref.origin).toBe('file')
    expect(path.dirname(ref.path)).toBe(work)
    expect(path.basename(ref.path)).toMatch(/^reference\.mp4$/)
    expect(ref.info.width).toBe(1920)
    await ref.cleanup()
    expect(fs.existsSync(ref.path)).toBe(false)
    expect(fs.existsSync(fx.koreanName)).toBe(true)
  })

  test('없는 파일은 not-found', async () => {
    const err = await fetchReference('/no/such/영상.mp4', work).catch((e) => e)
    expect(err).toBeInstanceOf(ReferenceFetchError)
    expect((err as ReferenceFetchError).kind).toBe('not-found')
  })
})
