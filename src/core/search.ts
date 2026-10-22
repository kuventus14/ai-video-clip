import { run } from './exec.ts'
import type { Recommendation } from '../shared/types.ts'
import type { Purpose } from './types.ts'

/** yt-dlp --flat-playlist --dump-json 이 한 줄에 하나씩 내는 항목 중 우리가 쓰는 필드 */
export interface RawResult {
  id: string
  title?: string
  channel?: string
  uploader?: string
  view_count?: number | null
  duration?: number | null
}

export class SearchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SearchError'
  }
}

const PER_QUERY = 40
const MAX_QUERIES = 3
const DEFAULT_LIMIT = 12
const MIN_STRICT = 4

/** 유튜브 검색 필터. 코드의 숫자는 유튜브 검색 주소의 sp 값(프로토콜 버퍼)에서 쓰는 값이다. */
export interface SearchFilters {
  sort?: 'views'
  uploadDate?: 'year'
  type?: 'video'
  duration?: 'under4' | '4to20'
}
const SORT = { views: 3 } as const
const UPLOAD_DATE = { year: 5 } as const // 최근 1년(실제로 12개월 안의 영상만 나오는 것을 업로드 날짜로 확인했다)
const TYPE = { video: 1 } as const
const DURATION = { under4: 1, '4to20': 3 } as const

/** 유튜브 검색 주소의 sp 파라미터(URL 인코딩된 base64). 필터가 없으면 빈 문자열. */
export function buildSp(f: SearchFilters): string {
  const filters = [
    ...(f.uploadDate ? [0x08, UPLOAD_DATE[f.uploadDate]] : []),
    ...(f.type ? [0x10, TYPE[f.type]] : []),
    ...(f.duration ? [0x18, DURATION[f.duration]] : []),
  ]
  const bytes = [...(f.sort ? [0x08, SORT[f.sort]] : []), ...(filters.length ? [0x12, filters.length, ...filters] : [])]
  return bytes.length ? encodeURIComponent(Buffer.from(bytes).toString('base64')) : ''
}

/**
 * yt-dlp 인자. 유튜브 검색의 조회수순 + 최근 1년 + 영상(채널·재생목록 제외) 필터를 건다.
 * short 는 4분 미만, post 는 4~20분(유튜브 필터가 길이 구간을 이렇게 나눈다). 받은 뒤 길이로 다시 거른다.
 */
export function buildSearchArgs(query: string, purpose: Purpose, perQuery = PER_QUERY): string[] {
  const sp = buildSp({ sort: 'views', uploadDate: 'year', type: 'video', duration: purpose === 'short' ? 'under4' : '4to20' })
  const target = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=${sp}`
  return [target, '--flat-playlist', '--dump-json', '--no-warnings', '--playlist-end', String(perQuery)]
}

/**
 * 레퍼런스는 영상 편집(컷·자막·구성)을 참고하려는 것이라 주제가 아니라 장르 수준으로 넓게 찾는다
 * (예: "롱아이언 체중 이동" 영상 → "골프 레슨"). 장르의 괄호 설명은 지우고, 장르가 비면 주제로 대신한다.
 */
export function broadQueries(s: { genre: string; topic: string }): string[] {
  const clean = (t: string) => t.replace(/\(.*?\)|（.*?）/g, '').replace(/\s+/g, ' ').trim()
  const q = clean(s.genre) || clean(s.topic)
  return q ? [q] : []
}

/** JSON 줄만 읽고 깨진 줄·id 없는 줄은 건너뛴다. */
export function parseSearchLines(stdout: string): RawResult[] {
  const out: RawResult[] = []
  for (const line of stdout.split('\n')) {
    const t = line.trim()
    if (!t.startsWith('{')) continue
    try {
      const r = JSON.parse(t) as RawResult
      if (typeof r.id === 'string' && r.id) out.push(r)
    } catch {
      // 깨진 줄은 무시
    }
  }
  return out
}

const inRange = (purpose: Purpose, sec: number, relaxed: boolean) =>
  purpose === 'short' ? sec <= (relaxed ? 240 : 180) : sec >= (relaxed ? 90 : 120)

/** 중복 제거 → 길이 거르기(적게 남으면 완화) → 조회수 내림차순(없으면 뒤) → 상위 limit. 최근 1년·조회수순은 검색 필터가 이미 걸었다. */
export function rankRecommendations(results: RawResult[], purpose: Purpose, limit = DEFAULT_LIMIT): Recommendation[] {
  const seen = new Set<string>()
  const unique = results.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
  const withDuration = unique.filter((r): r is RawResult & { duration: number } => typeof r.duration === 'number')
  let picked = withDuration.filter((r) => inRange(purpose, r.duration, false))
  if (picked.length < MIN_STRICT) picked = withDuration.filter((r) => inRange(purpose, r.duration, true))
  return picked
    .sort((a, b) => (b.view_count ?? -1) - (a.view_count ?? -1))
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      url: `https://www.youtube.com/watch?v=${r.id}`,
      title: r.title ?? r.id,
      channel: r.channel ?? r.uploader,
      viewCount: r.view_count ?? null,
      durationSec: r.duration,
      thumbnail: `https://i.ytimg.com/vi/${r.id}/hqdefault.jpg`,
    }))
}

/**
 * 검색어(앞 3개)로 유튜브에서 최근 1년 안의 조회수 높은 영상을 찾아 준다. 키가 필요 없다(yt-dlp).
 * 일부 검색이 실패해도 나머지로 계속하고, 전부 실패하면 SearchError.
 */
export async function searchReferences(
  i: { queries: string[]; purpose: Purpose; limit?: number },
  deps: { run?: typeof run } = {},
): Promise<Recommendation[]> {
  const exec = deps.run ?? run
  const queries = i.queries.map((q) => q.trim()).filter(Boolean).slice(0, MAX_QUERIES)
  if (!queries.length) throw new SearchError('검색어가 없어요')

  const settled = await Promise.allSettled(queries.map((q) => exec('yt-dlp', buildSearchArgs(q, i.purpose), { timeoutMs: 60_000 })))
  const ok = settled.filter((s): s is PromiseFulfilledResult<{ stdout: string; stderr: string }> => s.status === 'fulfilled')
  if (!ok.length) throw new SearchError('유튜브에서 비슷한 영상을 검색하지 못했어요. 인터넷 연결을 확인하거나 링크를 직접 넣어 주세요.')
  return rankRecommendations(ok.flatMap((s) => parseSearchLines(s.value.stdout)), i.purpose, i.limit)
}
