import type { ApproveInput, JobDto, PlanInput, StartInput } from '../shared/types.ts'

/** 서버가 거절했거나(status 4xx/5xx) 서버에 닿지 못했을 때(status 0). message 는 사용자에게 그대로 보여 줘도 되는 한국어. */
export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'
const UNREACHABLE = '서버에 연결할 수 없어요. 앱이 켜져 있는지 확인해 주세요.'
const UNEXPECTED = '서버에서 문제가 생겼어요. 잠시 뒤 다시 해 주세요.'

async function toApiError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null
  return new ApiError(res.status, typeof body?.error === 'string' ? body.error : UNEXPECTED)
}

async function request<T>(method: string, url: string, o: { body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const init: RequestInit = { method, signal: o.signal }
  if (o.body !== undefined) {
    init.headers = { 'content-type': 'application/json' }
    init.body = JSON.stringify(o.body)
  }
  let res: Response
  try {
    res = await fetch(url, init)
  } catch (e) {
    if (isAbort(e)) throw e
    throw new ApiError(0, UNREACHABLE)
  }
  if (!res.ok) throw await toApiError(res)
  return (await res.json().catch(() => {
    throw new ApiError(res.status, UNEXPECTED)
  })) as T
}

const jobUrl = (id: string, action = '') => `/api/jobs/${id}${action}`

export const listJobs = (filter?: 'history' | 'active', signal?: AbortSignal) => request<JobDto[]>('GET', filter ? `/api/jobs?filter=${filter}` : '/api/jobs', { signal })
export const createJob = () => request<JobDto>('POST', '/api/jobs')
export const getJob = (id: string, signal?: AbortSignal) => request<JobDto>('GET', jobUrl(id), { signal })
export const start = (id: string, input: StartInput) => request<JobDto>('POST', jobUrl(id, '/start'), { body: input })
export const plan = (id: string, input: PlanInput) => request<JobDto>('POST', jobUrl(id, '/plan'), { body: input })
export const approve = (id: string, input: ApproveInput = {}) => request<JobDto>('POST', jobUrl(id, '/approve'), { body: input })
export const confirm = (id: string) => request<JobDto>('POST', jobUrl(id, '/confirm'))
export const retry = (id: string) => request<JobDto>('POST', jobUrl(id, '/retry'))
export const otherVersion = (id: string) => request<JobDto>('POST', jobUrl(id, '/other-version'))
export const removeJob = (id: string) => request<{ ok: true }>('DELETE', jobUrl(id))

/**
 * 파일을 본문 그대로 PUT 한다. fetch 는 올리는 진행률을 알려 주지 않아 XMLHttpRequest 를 쓴다.
 * onProgress 에는 0~1 이 온다. signal 로 취소하면 AbortError 를 던진다.
 */
function putFile(url: string, file: File, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<JobDto> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const abort = () => xhr.abort()
    const done = () => signal?.removeEventListener('abort', abort)
    xhr.open('PUT', url)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress?.(e.loaded / e.total)
    }
    xhr.onload = () => {
      done()
      let body: unknown = null
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        // JSON 이 아니면 아래에서 일반 문구로 처리한다
      }
      if (xhr.status >= 200 && xhr.status < 300 && body) return resolve(body as JobDto)
      const message = body && typeof (body as { error?: unknown }).error === 'string' ? (body as { error: string }).error : UNEXPECTED
      reject(new ApiError(xhr.status, message))
    }
    xhr.onerror = () => {
      done()
      reject(new ApiError(0, UNREACHABLE))
    }
    xhr.onabort = () => {
      done()
      reject(new DOMException('업로드를 취소했어요', 'AbortError'))
    }
    if (signal?.aborted) return xhr.onabort?.(new ProgressEvent('abort'))
    signal?.addEventListener('abort', abort)
    xhr.send(file)
  })
}

export const uploadVideo = (id: string, file: File, onProgress?: (fraction: number) => void, signal?: AbortSignal) => putFile(`${jobUrl(id, '/video')}?name=${encodeURIComponent(file.name)}`, file, onProgress, signal)

/** 레퍼런스로 쓸 영상 파일을 올린다. 쓸지는 plan/start 의 reference: 'uploaded' 로 정한다. */
export const uploadReferenceFile = (id: string, file: File, onProgress?: (fraction: number) => void, signal?: AbortSignal) => putFile(`${jobUrl(id, '/reference-file')}?name=${encodeURIComponent(file.name)}`, file, onProgress, signal)
