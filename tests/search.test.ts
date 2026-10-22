import { describe, expect, test } from 'vitest'
import type { run } from '../src/core/exec.ts'
import { broadQueries, buildSearchArgs, buildSp, parseSearchLines, rankRecommendations, searchReferences, SearchError, type RawResult } from '../src/core/search.ts'

const raw = (id: string, over: Partial<RawResult> = {}): RawResult => ({ id, title: `제목 ${id}`, channel: '채널', view_count: 1000, duration: 60, ...over })

describe('buildSp — 유튜브 검색 필터 코드', () => {
  test('유튜브가 쓰는 코드와 같다(알려진 값으로 확인): 4분 미만만 / 조회수순+4분 미만 / 조회수순+최근 1년+영상+4분 미만 / …+4~20분', () => {
    expect(buildSp({ duration: 'under4' })).toBe('EgIYAQ%3D%3D')
    expect(buildSp({ sort: 'views', duration: 'under4' })).toBe('CAMSAhgB')
    expect(buildSp({ sort: 'views', uploadDate: 'year', type: 'video', duration: 'under4' })).toBe('CAMSBggFEAEYAQ%3D%3D')
    expect(buildSp({ sort: 'views', uploadDate: 'year', type: 'video', duration: '4to20' })).toBe('CAMSBggFEAEYAw%3D%3D')
  })
  test('아무 필터도 없으면 빈 문자열', () => {
    expect(buildSp({})).toBe('')
  })
})

describe('buildSearchArgs', () => {
  test('둘 다 유튜브 검색 주소에 조회수순 + 최근 1년 + 영상 필터를 걸고, short 는 4분 미만 / post 는 4~20분', () => {
    const s = buildSearchArgs('골프 레슨', 'short')
    expect(s[0]).toContain(`search_query=${encodeURIComponent('골프 레슨')}`)
    expect(s[0]).toContain('sp=CAMSBggFEAEYAQ%3D%3D')
    expect(s).toEqual(expect.arrayContaining(['--flat-playlist', '--dump-json', '--no-warnings', '--playlist-end', '40']))
    const post = buildSearchArgs('골프 레슨', 'post')[0]!
    expect(post.startsWith('https://www.youtube.com/results?')).toBe(true)
    expect(post).toContain('sp=CAMSBggFEAEYAw%3D%3D')
  })
  test('질의 안의 &·공백·한글도 주소를 깨지 않게 인코딩한다', () => {
    const url = buildSearchArgs('a&b=c 한글', 'short')[0]!
    expect(new URL(url).searchParams.get('search_query')).toBe('a&b=c 한글')
  })
  test('perQuery 를 바꿀 수 있다', () => {
    expect(buildSearchArgs('x', 'post', 10)).toEqual(expect.arrayContaining(['--playlist-end', '10']))
  })
})

describe('broadQueries — 레퍼런스는 편집 참고용이라 주제가 아니라 장르 수준으로 넓게 찾는다', () => {
  test('장르(예: 골프 레슨)만 쓴다 — 롱아이언처럼 세부 주제는 넣지 않는다', () => {
    expect(broadQueries({ genre: '골프 레슨', topic: '롱아이언 체중 이동' })).toEqual(['골프 레슨'])
  })
  test('앞뒤 공백과 괄호 설명은 지운다', () => {
    expect(broadQueries({ genre: '  골프 레슨 (롱아이언 편)  ', topic: 'x' })).toEqual(['골프 레슨'])
  })
  test('장르가 비어 있으면 주제로 대신한다', () => {
    expect(broadQueries({ genre: '   ', topic: '퍼팅' })).toEqual(['퍼팅'])
  })
  test('둘 다 비면 빈 배열(검색 안 함)', () => {
    expect(broadQueries({ genre: ' ', topic: '' })).toEqual([])
  })
})

describe('parseSearchLines', () => {
  test('JSON 줄만 읽고 깨진 줄은 건너뛴다', () => {
    const out = parseSearchLines(['{"id":"a","view_count":5}', '여기는 로그 줄', '{"id":"b"', '', '{"id":"c","duration":30}'].join('\n'))
    expect(out.map((r) => r.id)).toEqual(['a', 'c'])
  })
  test('id 가 없는 줄은 버린다', () => {
    expect(parseSearchLines('{"title":"x"}')).toEqual([])
  })
})

describe('rankRecommendations', () => {
  test('id 중복을 없애고 형식(url·thumbnail·channel)을 채운다', () => {
    const [r] = rankRecommendations([raw('abc', { uploader: undefined, channel: '프로 채널' }), raw('abc')], 'short')
    expect(r).toEqual({
      id: 'abc',
      url: 'https://www.youtube.com/watch?v=abc',
      title: '제목 abc',
      channel: '프로 채널',
      viewCount: 1000,
      durationSec: 60,
      thumbnail: 'https://i.ytimg.com/vi/abc/hqdefault.jpg',
    })
    expect(rankRecommendations([raw('abc'), raw('abc')], 'short')).toHaveLength(1)
  })

  test('short 는 180초 이하만(긴 영상은 뺌), 조회수 내림차순, 조회수 없음은 맨 뒤', () => {
    const rows = [
      raw('slow', { duration: 573, view_count: 9_999_999 }),
      raw('a', { duration: 60, view_count: 100 }),
      raw('b', { duration: 170, view_count: 40_000 }),
      raw('c', { duration: 67, view_count: null }),
      raw('d', { duration: 82, view_count: 7_000 }),
      raw('e', { duration: 50, view_count: 500 }),
    ]
    expect(rankRecommendations(rows, 'short').map((r) => r.id)).toEqual(['b', 'd', 'e', 'a', 'c'])
  })

  test('post 는 120초 이상만', () => {
    const rows = [raw('s', { duration: 59 }), raw('m', { duration: 130, view_count: 10 }), raw('l', { duration: 600, view_count: 20 }), raw('x', { duration: 200, view_count: 5 }), raw('y', { duration: 300, view_count: 1 })]
    expect(rankRecommendations(rows, 'post').map((r) => r.id)).toEqual(['l', 'm', 'x', 'y'])
  })

  test('조건에 맞는 것이 4개 미만이면 기준을 완화한다 (short ≤240초, post ≥90초)', () => {
    const rows = [raw('a', { duration: 60 }), raw('b', { duration: 200, view_count: 5000 }), raw('c', { duration: 235, view_count: 3000 }), raw('far', { duration: 400 })]
    expect(rankRecommendations(rows, 'short').map((r) => r.id)).toEqual(['b', 'c', 'a'])
    const post = [raw('p1', { duration: 130 }), raw('p2', { duration: 95, view_count: 9 }), raw('p3', { duration: 20 })]
    expect(rankRecommendations(post, 'post').map((r) => r.id)).toEqual(['p1', 'p2'])
  })

  test('길이를 모르는 항목(라이브 등)은 뺀다', () => {
    expect(rankRecommendations([raw('live', { duration: null })], 'short')).toEqual([])
  })

  test('limit 을 지킨다 (기본 12)', () => {
    const rows = Array.from({ length: 30 }, (_, i) => raw(`v${i}`, { duration: 60, view_count: i }))
    expect(rankRecommendations(rows, 'short')).toHaveLength(12)
    expect(rankRecommendations(rows, 'short', 5)).toHaveLength(5)
    expect(rankRecommendations(rows, 'short', 5)[0]!.id).toBe('v29')
  })
})

describe('searchReferences', () => {
  const lines = (...rows: RawResult[]) => rows.map((r) => JSON.stringify(r)).join('\n')
  const fakeRun = (impl: (args: string[]) => string | Error) => {
    const calls: string[][] = []
    const fn = (async (_file: string, args: string[]) => {
      calls.push(args)
      const out = impl(args)
      if (out instanceof Error) throw out
      return { stdout: out, stderr: '' }
    }) as unknown as typeof run
    return { calls, fn }
  }

  test('질의마다 yt-dlp 를 부르고 합쳐서 순위를 매긴다', async () => {
    const f = fakeRun((args) => (args[0]!.includes('qa') ? lines(raw('a', { view_count: 10 })) : lines(raw('b', { view_count: 99 }), raw('a', { view_count: 10 }))))
    const out = await searchReferences({ queries: ['qa', 'qb'], purpose: 'short' }, { run: f.fn })
    expect(f.calls).toHaveLength(2)
    expect(out.map((r) => r.id)).toEqual(['b', 'a'])
  })

  test('질의는 앞의 3개만 쓴다', async () => {
    const f = fakeRun(() => lines(raw('a')))
    await searchReferences({ queries: ['1', '2', '3', '4', '5'], purpose: 'short' }, { run: f.fn })
    expect(f.calls).toHaveLength(3)
  })

  test('일부 질의가 실패해도 나머지로 계속한다', async () => {
    const f = fakeRun((args) => (args[0]!.includes('bad') ? new Error('네트워크 오류') : lines(raw('ok'))))
    const out = await searchReferences({ queries: ['bad', 'good'], purpose: 'short' }, { run: f.fn })
    expect(out.map((r) => r.id)).toEqual(['ok'])
  })

  test('전부 실패하면 SearchError', async () => {
    const f = fakeRun(() => new Error('인터넷 없음'))
    const err = await searchReferences({ queries: ['a', 'b'], purpose: 'post' }, { run: f.fn }).catch((e) => e)
    expect(err).toBeInstanceOf(SearchError)
    expect((err as SearchError).message).toMatch(/[가-힣]/)
  })

  test('성공했지만 결과가 없으면 빈 배열 (오류가 아니다)', async () => {
    const f = fakeRun(() => '')
    expect(await searchReferences({ queries: ['a'], purpose: 'short' }, { run: f.fn })).toEqual([])
  })

  test('검색어가 비어 있으면 SearchError', async () => {
    const f = fakeRun(() => lines(raw('a')))
    await expect(searchReferences({ queries: ['  ', ''], purpose: 'short' }, { run: f.fn })).rejects.toBeInstanceOf(SearchError)
    expect(f.calls).toHaveLength(0)
  })

  test.skipIf(process.env.INTEGRATION !== '1')('실제 유튜브 검색: 1개 이상, 모두 240초 이하, 조회수 내림차순', async () => {
    const out = await searchReferences({ queries: ['골프 레슨'], purpose: 'short' })
    expect(out.length).toBeGreaterThan(0)
    for (const r of out) expect(r.durationSec!).toBeLessThanOrEqual(240)
    const views = out.map((r) => r.viewCount ?? -1)
    expect(views).toEqual([...views].sort((a, b) => b - a))
  }, 120_000)
})
