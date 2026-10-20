import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { DELETE as jobDelete, GET as jobGet } from '../app/api/jobs/[id]/route.ts'
import { GET as mediaGet } from '../app/api/jobs/[id]/media/[kind]/route.ts'
import { PUT as refFilePut } from '../app/api/jobs/[id]/reference-file/route.ts'
import { PUT as videoPut } from '../app/api/jobs/[id]/video/route.ts'
import { GET as listGet, POST as createPost } from '../app/api/jobs/route.ts'
import { getContext, resetContextForTests } from '../src/web/context.ts'
import type { JobDto } from '../src/shared/types.ts'

const HOST = 'localhost:4848'
let dir: string
const saved = process.env.VAE_DATA_DIR

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vae-api-'))
  process.env.VAE_DATA_DIR = dir
  resetContextForTests()
})
afterEach(() => {
  if (saved === undefined) delete process.env.VAE_DATA_DIR
  else process.env.VAE_DATA_DIR = saved
  resetContextForTests()
})

const url = (p: string) => `http://${HOST}${p}`
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const mediaParams = (id: string, kind: string) => ({ params: Promise.resolve({ id, kind }) })
const post = (p = '/api/jobs', init: RequestInit = {}) => new Request(url(p), { method: 'POST', ...init })

async function create(): Promise<JobDto> {
  const res = await createPost(post())
  expect(res.status).toBe(201)
  return (await res.json()) as JobDto
}

/** 청크 목록을 흘려 주는 본문. failAfter 개 청크 뒤에 에러를 내면 업로드가 도중에 끊긴 것을 흉내낸다. */
function bodyOf(chunks: Buffer[], failAfter?: number): ReadableStream<Uint8Array> {
  let i = 0
  return new ReadableStream({
    pull(controller) {
      if (failAfter !== undefined && i >= failAfter) return controller.error(new Error('연결이 끊겼어요'))
      if (i >= chunks.length) return controller.close()
      controller.enqueue(new Uint8Array(chunks[i++]!))
    },
  })
}
const put = (p: string, body: ReadableStream<Uint8Array> | null, init: RequestInit = {}) =>
  new Request(url(p), { method: 'PUT', body, duplex: 'half', ...init } as RequestInit)

describe('만들기·조회', () => {
  test('POST 로 만들고 GET 으로 읽는다 — DTO 에는 서버의 절대 경로가 없다', async () => {
    const made = await create()
    expect(made).toMatchObject({ status: 'created', purposeChoice: 'auto', title: '이름 없는 작업', recommendations: [], media: {} })
    const res = await jobGet(new Request(url(`/api/jobs/${made.id}`)), params(made.id))
    expect(res.status).toBe(200)
    const dto = (await res.json()) as JobDto
    expect(dto.id).toBe(made.id)
    expect(JSON.stringify(dto)).not.toContain(dir)
  })

  test('없는 작업은 404, 형식이 틀린 id 는 400', async () => {
    expect((await jobGet(new Request(url('/api/jobs/aaaaaaaaaa')), params('aaaaaaaaaa'))).status).toBe(404)
    expect((await jobGet(new Request(url('/api/jobs/x')), params('../etc'))).status).toBe(400)
  })

  test('목록: history 는 확정된 것만, active 는 나머지(실패 포함), 최신 순', async () => {
    const a = await create()
    const b = await create()
    const c = await create()
    const { jobs } = getContext()
    jobs.update(b.id, { status: 'confirmed' })
    jobs.update(c.id, { status: 'failed', failedPhase: 'plan', errorMessage: '실패' })
    const list = async (q: string) => ((await (await listGet(new Request(url(`/api/jobs${q}`)))).json()) as JobDto[]).map((j) => j.id)
    expect(await list('?filter=history')).toEqual([b.id])
    expect(await list('?filter=active')).toEqual([c.id, a.id])
    expect(await list('')).toEqual([c.id, b.id, a.id])
  })

  test('statusSince 는 지금 상태가 된 시각 — 상태가 바뀌면 갱신되고 로그만 쌓으면 그대로', async () => {
    const made = await create()
    expect(made.statusSince).toBe(made.createdAt)
    const { jobs } = getContext()
    await new Promise((r) => setTimeout(r, 5))
    jobs.log(made.id, 'x', '로그')
    const afterLog = (await (await jobGet(new Request(url(`/api/jobs/${made.id}`)), params(made.id))).json()) as JobDto
    expect(afterLog.statusSince).toBe(made.createdAt)
    jobs.transition(made.id, ['created'], 'queued_probe')
    const afterMove = (await (await jobGet(new Request(url(`/api/jobs/${made.id}`)), params(made.id))).json()) as JobDto
    expect(afterMove.statusSince > made.createdAt).toBe(true)
  })

  test('리포트의 교정·제안에는 고치기 전 글(original)이 함께 오고, 옛 리포트(original 없음)도 읽힌다', async () => {
    const a = await create()
    const { jobs } = getContext()
    const qa = { passed: true, findings: [] }
    jobs.update(a.id, { report: { qa, appliedCorrections: [{ index: 2, text: '롱아이언은 체중 이동이에요', reason: 'term', original: '롱 아이런은 체중 이동이에요' }], suggestions: [{ index: 5, text: '다운스윙', reason: 'spacing' }] } })
    const dto = (await (await jobGet(new Request(url(`/api/jobs/${a.id}`)), params(a.id))).json()) as JobDto
    expect(dto.report?.appliedCorrections).toEqual([{ index: 2, text: '롱아이언은 체중 이동이에요', reason: 'term', original: '롱 아이런은 체중 이동이에요' }])
    expect(dto.report?.suggestions).toEqual([{ index: 5, text: '다운스윙', reason: 'spacing' }])
  })

  test('결과 영상의 길이·크기(리포트의 output)는 resultInfo 로, 없거나 형식이 틀리면 null', async () => {
    const a = await create()
    const b = await create()
    const c = await create()
    const { jobs } = getContext()
    const qa = { passed: true, findings: [] }
    jobs.update(a.id, { report: { qa, output: { durationSec: 44.2, width: 1080, height: 1920 } } })
    jobs.update(b.id, { report: { qa } })
    jobs.update(c.id, { report: { output: { durationSec: '길다' } } })
    const get = async (id: string) => (await (await jobGet(new Request(url(`/api/jobs/${id}`)), params(id))).json()) as JobDto
    expect((await get(a.id)).resultInfo).toEqual({ durationSec: 44.2, width: 1080, height: 1920 })
    expect((await get(b.id)).resultInfo).toBeNull()
    expect((await get(c.id)).resultInfo).toBeNull()
  })
})

describe('영상 업로드 (스트리밍)', () => {
  test('한글·공백·괄호 이름도 받는다 — 디스크에는 이름 없이 source<확장자> 로 저장하고 상태는 queued_probe', async () => {
    const made = await create()
    const chunks = [Buffer.alloc(100_000, 1), Buffer.alloc(100_000, 2), Buffer.alloc(50_000, 3)]
    const res = await videoPut(put(`/api/jobs/${made.id}/video?name=${encodeURIComponent('내 영상 (1).MOV')}`, bodyOf(chunks)), params(made.id))
    expect(res.status).toBe(200)
    const dto = (await res.json()) as JobDto
    expect(dto).toMatchObject({ status: 'queued_probe', sourceName: '내 영상 (1).MOV' })
    const job = getContext().jobs.get(made.id)!
    expect(path.basename(job.sourcePath!)).toBe('source.mov')
    expect(fs.statSync(job.sourcePath!).size).toBe(250_000)
    expect(fs.readdirSync(path.dirname(job.sourcePath!)).filter((f) => f.endsWith('.part'))).toEqual([])
  })

  test('(Review Focus 5) 허용되지 않는 확장자·이름 없음·본문 없음은 400', async () => {
    const made = await create()
    const small = () => bodyOf([Buffer.alloc(10)])
    expect((await videoPut(put(`/api/jobs/${made.id}/video?name=virus.exe`, small()), params(made.id))).status).toBe(400)
    expect((await videoPut(put(`/api/jobs/${made.id}/video`, small()), params(made.id))).status).toBe(400)
    expect((await videoPut(put(`/api/jobs/${made.id}/video?name=a.mp4`, null), params(made.id))).status).toBe(400)
    expect(getContext().jobs.get(made.id)!.status).toBe('created')
  })

  test('빈 파일은 400 이고 남기지 않는다', async () => {
    const made = await create()
    const res = await videoPut(put(`/api/jobs/${made.id}/video?name=a.mp4`, bodyOf([])), params(made.id))
    expect(res.status).toBe(400)
    expect(fs.readdirSync(getContext().jobs.jobDir(made.id))).toEqual([])
  })

  test('이미 올린 작업에 다시 올리면 409', async () => {
    const made = await create()
    await videoPut(put(`/api/jobs/${made.id}/video?name=a.mp4`, bodyOf([Buffer.alloc(10)])), params(made.id))
    const second = await videoPut(put(`/api/jobs/${made.id}/video?name=b.mp4`, bodyOf([Buffer.alloc(10)])), params(made.id))
    expect(second.status).toBe(409)
  })

  test('(Review Focus 1) 업로드가 도중에 끊기면 반쯤 쓴 파일을 지우고 작업은 created 로 남는다', async () => {
    const made = await create()
    const res = await videoPut(put(`/api/jobs/${made.id}/video?name=a.mp4`, bodyOf([Buffer.alloc(80_000), Buffer.alloc(80_000)], 1)), params(made.id))
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(((await res.json()) as { error: string }).error).toMatch(/끊겼어요|올리지 못했어요/)
    const job = getContext().jobs.get(made.id)!
    expect(job.status).toBe('created')
    expect(job.sourcePath).toBeNull()
    expect(fs.readdirSync(getContext().jobs.jobDir(made.id))).toEqual([])
  })

  test('없는 작업에 올리면 404 이고 파일을 만들지 않는다', async () => {
    const res = await videoPut(put('/api/jobs/aaaaaaaaaa/video?name=a.mp4', bodyOf([Buffer.alloc(10)])), params('aaaaaaaaaa'))
    expect(res.status).toBe(404)
    expect(fs.existsSync(path.join(dir, 'jobs', 'aaaaaaaaaa'))).toBe(false)
  })
})

describe('레퍼런스 파일 업로드', () => {
  test('referenceUploadPath 만 기록한다 (referenceSource 는 건드리지 않음)', async () => {
    const made = await create()
    const res = await refFilePut(put(`/api/jobs/${made.id}/reference-file?name=ref.mp4`, bodyOf([Buffer.alloc(500)])), params(made.id))
    expect(res.status).toBe(200)
    const job = getContext().jobs.get(made.id)!
    expect(path.basename(job.referenceUploadPath!)).toBe('reference-upload.mp4')
    expect(job.referenceSource).toBeNull()
    expect(((await res.json()) as JobDto).hasUploadedReference).toBe(true)
  })
  test('실행 중인 작업에는 409, 허용되지 않는 확장자는 400', async () => {
    const made = await create()
    expect((await refFilePut(put(`/api/jobs/${made.id}/reference-file?name=x.txt`, bodyOf([Buffer.alloc(5)])), params(made.id))).status).toBe(400)
    getContext().jobs.update(made.id, { status: 'analyzing' })
    expect((await refFilePut(put(`/api/jobs/${made.id}/reference-file?name=x.mp4`, bodyOf([Buffer.alloc(5)])), params(made.id))).status).toBe(409)
  })
})

describe('미디어 (Range)', () => {
  async function jobWithResult(bytes = 1000) {
    const made = await create()
    const { jobs } = getContext()
    const file = path.join(jobs.jobDir(made.id), 'result.mp4')
    fs.writeFileSync(file, Buffer.from(Array.from({ length: bytes }, (_, i) => i % 251)))
    jobs.update(made.id, { resultPath: file })
    return made.id
  }
  const get = (id: string, kind: string, range?: string) => mediaGet(new Request(url(`/api/jobs/${id}/media/${kind}`), { headers: range ? { range } : {} }), mediaParams(id, kind))

  test('Range 는 206 + Content-Range, 일부만 돌려준다', async () => {
    const id = await jobWithResult()
    const res = await get(id, 'result', 'bytes=0-99')
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 0-99/1000')
    expect(res.headers.get('content-length')).toBe('100')
    expect(res.headers.get('content-type')).toBe('video/mp4')
    expect((await res.arrayBuffer()).byteLength).toBe(100)
    const tail = await get(id, 'result', 'bytes=900-')
    expect(tail.headers.get('content-range')).toBe('bytes 900-999/1000')
    expect((await tail.arrayBuffer()).byteLength).toBe(100)
    const suffix = await get(id, 'result', 'bytes=-50')
    expect(suffix.headers.get('content-range')).toBe('bytes 950-999/1000')
  })

  test('범위가 파일을 벗어나면 416, 범위 없이 부르면 전체와 Accept-Ranges', async () => {
    const id = await jobWithResult()
    const bad = await get(id, 'result', 'bytes=2000-3000')
    expect(bad.status).toBe(416)
    expect(bad.headers.get('content-range')).toBe('bytes */1000')
    const full = await get(id, 'result')
    expect(full.status).toBe(200)
    expect(full.headers.get('accept-ranges')).toBe('bytes')
    expect((await full.arrayBuffer()).byteLength).toBe(1000)
  })

  test('파일이 없으면 404, 모르는 종류도 404', async () => {
    const made = await create()
    expect((await get(made.id, 'result')).status).toBe(404)
    expect((await get(made.id, 'secret')).status).toBe(404)
  })

  test('DTO 의 media 에는 파일이 있는 것만 URL 로 들어간다', async () => {
    const id = await jobWithResult()
    const dto = (await (await jobGet(new Request(url(`/api/jobs/${id}`)), params(id))).json()) as JobDto
    expect(dto.media).toEqual({ result: `/api/jobs/${id}/media/result` })
  })
})

describe('Origin 검사 (다른 사이트가 내 로컬 앱을 건드리지 못하게)', () => {
  test('다른 Origin 의 변경 요청은 403, 같은 Origin·Origin 없음은 통과', async () => {
    const evil = await createPost(post('/api/jobs', { headers: { origin: 'http://evil.example' } }))
    expect(evil.status).toBe(403)
    expect((await createPost(post('/api/jobs', { headers: { origin: `http://${HOST}` } }))).status).toBe(201)
    expect((await createPost(post())).status).toBe(201)
    const made = await create()
    const del = await jobDelete(new Request(url(`/api/jobs/${made.id}`), { method: 'DELETE', headers: { origin: 'http://evil.example' } }), params(made.id))
    expect(del.status).toBe(403)
    expect(getContext().jobs.get(made.id)).toBeDefined()
    const up = await videoPut(put(`/api/jobs/${made.id}/video?name=a.mp4`, bodyOf([Buffer.alloc(10)]), { headers: { origin: 'http://evil.example' } }), params(made.id))
    expect(up.status).toBe(403)
  })

  test('GET 은 Origin 과 무관하게 통과', async () => {
    const res = await listGet(new Request(url('/api/jobs'), { headers: { origin: 'http://evil.example' } }))
    expect(res.status).toBe(200)
  })
})

describe('삭제', () => {
  test('실행 중인 작업은 409, 아니면 행과 폴더를 지운다', async () => {
    const made = await create()
    const { jobs } = getContext()
    const d = jobs.jobDir(made.id)
    jobs.update(made.id, { status: 'analyzing' })
    const refused = await jobDelete(new Request(url(`/api/jobs/${made.id}`), { method: 'DELETE' }), params(made.id))
    expect(refused.status).toBe(409)
    expect(jobs.get(made.id)).toBeDefined()
    jobs.update(made.id, { status: 'awaiting_plan' })
    const ok = await jobDelete(new Request(url(`/api/jobs/${made.id}`), { method: 'DELETE' }), params(made.id))
    expect(ok.status).toBe(200)
    expect(jobs.get(made.id)).toBeUndefined()
    expect(fs.existsSync(d)).toBe(false)
  })
  test('없는 작업은 404', async () => {
    expect((await jobDelete(new Request(url('/api/jobs/aaaaaaaaaa'), { method: 'DELETE' }), params('aaaaaaaaaa'))).status).toBe(404)
  })
})
