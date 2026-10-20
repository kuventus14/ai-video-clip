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

const PER_QUERY = 25
const MAX_QUERIES = 3
const DEFAULT_LIMIT = 12
const MIN_STRICT = 4
/** 유튜브 검색의 "4분 미만" 필터. "shorts" 를 질의에 붙여도 긴 영상만 나와서 이 필터로 받은 뒤 길이로 다시 거른다. */
const SP_UNDER_4_MIN = 'EgIYAQ%3D%3D'

/** yt-dlp 인자. short 는 4분 미만 필터가 걸린 검색 주소, post 는 ytsearch. */
export function buildSearchArgs(query: string, purpose: Purpose, perQuery = PER_QUERY): string[] {
  const target =
    purpose === 'short'
      ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=${SP_UNDER_4_MIN}`
      : `ytsearch${perQuery}:${query}`
  return [target, '--flat-playlist', '--dump-json', '--no-warnings', '--playlist-end', String(perQuery)]
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
  purpose === 'short' ? sec <= (relaxed ? 180 : 90) : sec >= (relaxed ? 90 : 120)

/** 중복 제거 → 길이 거르기(적게 남으면 완화) → 조회수 내림차순(없으면 뒤) → 상위 limit */
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
 * 검색어(앞 3개)로 유튜브를 검색해 비슷한 인기 영상을 돌려준다. 키가 필요 없다(yt-dlp).
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
