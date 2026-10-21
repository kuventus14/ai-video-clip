import type { JobStatus } from '../../../src/shared/types.ts'
import { getContext } from '../../../src/web/context.ts'
import { toJobDto } from '../../../src/web/dto.ts'
import { assertLocalHost, assertSameOrigin } from '../../../src/web/http.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALL: JobStatus[] = ['created', 'queued_probe', 'probing', 'ready', 'queued_analysis', 'analyzing', 'awaiting_reference', 'queued_plan', 'planning', 'awaiting_plan', 'queued_produce', 'producing', 'awaiting_confirm', 'failed']

/** 목록. ?filter=history 는 확정한 영상만, ?filter=active 는 나머지(진행 중·실패 포함), 없으면 전부. 최신 순. */
export async function GET(req: Request) {
  const wrongHost = assertLocalHost(req)
  if (wrongHost) return wrongHost
  const filter = new URL(req.url).searchParams.get('filter')
  const statuses: JobStatus[] | undefined = filter === 'history' ? ['confirmed'] : filter === 'active' ? ALL : undefined
  return Response.json(getContext().jobs.list({ statuses }).map(toJobDto))
}

/** 새 작업을 만든다(영상은 이어서 PUT /api/jobs/<id>/video 로 올린다). */
export async function POST(req: Request) {
  const blocked = assertSameOrigin(req)
  if (blocked) return blocked
  return Response.json(toJobDto(getContext().jobs.create()), { status: 201 })
}
