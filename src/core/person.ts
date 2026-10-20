import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { run } from './exec.ts'

const SRC = path.resolve(import.meta.dirname, '../../tools/persontrack/main.swift')
const BIN = path.resolve(import.meta.dirname, '../../.cache/persontrack')

const unit = z.number().min(0).max(1)

export const PersonBox = z
  .object({ x: unit, y: unit, w: unit, h: unit, confidence: unit, kind: z.enum(['human', 'face']) })
  .refine((b) => b.x + b.w <= 1.02 && b.y + b.h <= 1.02, '박스가 화면 밖으로 나가요')
export type PersonBox = z.infer<typeof PersonBox>

export const PersonTrack = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  samples: z.array(z.object({ t: z.number().nonnegative(), boxes: z.array(PersonBox) })),
})
export type PersonTrack = z.infer<typeof PersonTrack>

export function parsePersonTrack(json: unknown): PersonTrack {
  return PersonTrack.parse(json)
}

let compiling: Promise<string> | null = null

/** Swift 도구를 처음 쓸 때(또는 소스가 바뀌었을 때) 컴파일해 `.cache/persontrack` 로 둔다. */
export function ensurePersonTrackBinary(): Promise<string> {
  const upToDate = fs.existsSync(BIN) && fs.statSync(BIN).mtimeMs >= fs.statSync(SRC).mtimeMs
  if (upToDate) return Promise.resolve(BIN)
  compiling ??= (async () => {
    try {
      fs.mkdirSync(path.dirname(BIN), { recursive: true })
      const tmp = `${BIN}.${process.pid}.tmp`
      await run('swiftc', ['-O', SRC, '-o', tmp], { timeoutMs: 5 * 60_000 })
      fs.renameSync(tmp, BIN)
      return BIN
    } finally {
      compiling = null
    }
  })()
  return compiling
}

/** 영상 전체에서 초당 `sampleFps`(기본 4)번 사람의 위치를 찾는다. */
export async function trackPeople(videoPath: string, o: { sampleFps?: number } = {}): Promise<PersonTrack> {
  const bin = await ensurePersonTrackBinary()
  const { stdout } = await run(bin, [videoPath, String(o.sampleFps ?? 4)], { timeoutMs: 15 * 60_000 })
  return parsePersonTrack(JSON.parse(stdout))
}
