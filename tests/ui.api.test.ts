import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, approve, confirm, createJob, getJob, getSound, listJobs, otherVersion, plan, removeJob, retry, start } from '../src/ui/api.ts'

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function stubFetch(res: Response | Error) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => {
    if (res instanceof Error) throw res
    return res.clone()
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

const callOf = (fn: ReturnType<typeof stubFetch>, i: number) => fn.mock.calls[i]!

describe('ui api client', () => {
  it('getJob 은 GET /api/jobs/<id> 의 JSON 을 돌려준다', async () => {
    const fetch = stubFetch(jsonResponse({ id: 'abc1234567', status: 'ready' }))
    const job = await getJob('abc1234567')
    expect(job.status).toBe('ready')
    expect(callOf(fetch, 0)[0]).toBe('/api/jobs/abc1234567')
    expect(callOf(fetch, 0)[1]?.method ?? 'GET').toBe('GET')
  })

  it('listJobs 는 filter 를 쿼리로 붙인다', async () => {
    const fetch = stubFetch(jsonResponse([]))
    await listJobs('history')
    expect(callOf(fetch, 0)[0]).toBe('/api/jobs?filter=history')
    await listJobs()
    expect(callOf(fetch, 1)[0]).toBe('/api/jobs')
  })

  it('동작은 POST 로 보내고 JSON 본문은 content-type 과 함께 보낸다', async () => {
    const fetch = stubFetch(jsonResponse({ id: 'abc1234567', status: 'queued_analysis' }))
    await start('abc1234567', { purposeChoice: 'auto', description: '골프 레슨' })
    const [url, init] = callOf(fetch, 0)
    expect(url).toBe('/api/jobs/abc1234567/start')
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json')
    expect(JSON.parse(String(init?.body))).toEqual({ purposeChoice: 'auto', description: '골프 레슨' })
  })

  it('본문 없는 동작은 content-type 을 보내지 않는다', async () => {
    const fetch = stubFetch(jsonResponse({ id: 'abc1234567', status: 'confirmed' }))
    await confirm('abc1234567')
    const init = callOf(fetch, 0)[1]
    expect(init?.method).toBe('POST')
    expect(init?.body).toBeUndefined()
    expect(new Headers(init?.headers).get('content-type')).toBeNull()
  })

  it('getSound 는 GET /api/sound 의 목록을 돌려주고, 실패하면 ApiError(서버가 준 한국어 메시지)', async () => {
    const fetch = stubFetch(jsonResponse({ bgm: [{ id: 'calm-1' }], sfxCount: 3 }))
    const list = await getSound()
    expect(list.sfxCount).toBe(3)
    expect(callOf(fetch, 0)[0]).toBe('/api/sound')
    stubFetch(jsonResponse({ error: '음원 목록(manifest.json)을 읽을 수 없어요' }, 500))
    await expect(getSound()).rejects.toMatchObject({ status: 500, message: '음원 목록(manifest.json)을 읽을 수 없어요' })
  })

  it('각 동작의 주소', async () => {
    const fetch = stubFetch(jsonResponse({ id: 'abc1234567' }))
    await createJob()
    await plan('abc1234567', { request: '자막 스타일' })
    await approve('abc1234567', { captions: 'auto' })
    await retry('abc1234567')
    await otherVersion('abc1234567')
    await removeJob('abc1234567')
    expect(fetch.mock.calls.map(([u, i]) => `${i?.method} ${u}`)).toEqual([
      'POST /api/jobs',
      'POST /api/jobs/abc1234567/plan',
      'POST /api/jobs/abc1234567/approve',
      'POST /api/jobs/abc1234567/retry',
      'POST /api/jobs/abc1234567/other-version',
      'DELETE /api/jobs/abc1234567',
    ])
  })

  it('서버가 { error } 로 거절하면 ApiError 에 상태 코드와 한국어 문구가 담긴다', async () => {
    stubFetch(jsonResponse({ error: '이미 영상을 올린 작업이에요' }, 409))
    const err = await getJob('abc1234567').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(409)
    expect(err.message).toBe('이미 영상을 올린 작업이에요')
  })

  it('본문이 JSON 이 아닌 오류는 일반 문구로 바꾼다', async () => {
    stubFetch(new Response('<html>oops</html>', { status: 500 }))
    const err = await getJob('abc1234567').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(500)
    expect(err.message).toMatch(/문제가 생겼어요/)
  })

  it('서버에 닿지 못하면 상태 0 의 ApiError', async () => {
    stubFetch(new TypeError('Failed to fetch'))
    const err = await getJob('abc1234567').catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(0)
    expect(err.message).toMatch(/연결/)
  })

  it('취소(AbortError)는 ApiError 로 바꾸지 않고 그대로 던진다', async () => {
    stubFetch(new DOMException('aborted', 'AbortError'))
    const err = await getJob('abc1234567').catch((e) => e)
    expect(err).not.toBeInstanceOf(ApiError)
    expect(err.name).toBe('AbortError')
  })
})
