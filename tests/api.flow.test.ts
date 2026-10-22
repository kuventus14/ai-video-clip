import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { POST as approve } from '../app/api/jobs/[id]/approve/route.ts'
import { POST as confirm } from '../app/api/jobs/[id]/confirm/route.ts'
import { POST as otherVersion } from '../app/api/jobs/[id]/other-version/route.ts'
import { POST as plan } from '../app/api/jobs/[id]/plan/route.ts'
import { POST as retry } from '../app/api/jobs/[id]/retry/route.ts'
import { POST as start } from '../app/api/jobs/[id]/start/route.ts'
import type { Job } from '../src/db/jobs.ts'
import type { JobDto, JobStatus } from '../src/shared/types.ts'
import { getContext, resetContextForTests } from '../src/web/context.ts'

const HOST = 'localhost:4848'
let dir: string
const saved = process.env.VAE_DATA_DIR

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vae-flow-'))
  process.env.VAE_DATA_DIR = dir
  resetContextForTests()
})
afterEach(() => {
  if (saved === undefined) delete process.env.VAE_DATA_DIR
  else process.env.VAE_DATA_DIR = saved
  resetContextForTests()
})

type Handler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>
const call = (h: Handler, id: string, body?: unknown, headers: Record<string, string> = {}) =>
  h(new Request(`http://${HOST}/api/jobs/${id}/x`, { method: 'POST', body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body), headers }), { params: Promise.resolve({ id }) })

function job(status: JobStatus, patch: Parameters<ReturnType<typeof getContext>['jobs']['update']>[1] = {}): Job {
  const { jobs } = getContext()
  const j = jobs.create()
  return jobs.update(j.id, { status, ...patch })
}
const read = (id: string) => getContext().jobs.get(id)!

describe('start', () => {
  test('ready → queued_analysis, 설명·용도 선택·레퍼런스 링크를 기록한다', async () => {
    const j = job('ready')
    const res = await call(start, j.id, { description: '골프 레슨 영상입니다', purposeChoice: 'short', reference: ' https://youtu.be/abc ' })
    expect(res.status).toBe(200)
    expect(((await res.json()) as JobDto).status).toBe('queued_analysis')
    expect(read(j.id)).toMatchObject({ status: 'queued_analysis', description: '골프 레슨 영상입니다', purposeChoice: 'short', referenceSource: 'https://youtu.be/abc' })
  })

  test('레퍼런스 없음(생략·null·빈 문자열)은 레퍼런스 없이 시작', async () => {
    for (const ref of [undefined, null, '', '  ']) {
      const j = job('ready')
      await call(start, j.id, { purposeChoice: 'auto', reference: ref })
      expect(read(j.id).referenceSource).toBeNull()
    }
  })

  test("reference:'uploaded' 는 올려 둔 파일을 쓰고, 올린 파일이 없으면 400", async () => {
    const withFile = job('ready')
    const p = path.join(getContext().jobs.jobDir(withFile.id), 'reference-upload.mp4')
    fs.writeFileSync(p, 'x')
    getContext().jobs.update(withFile.id, { referenceUploadPath: p })
    const ok = await call(start, withFile.id, { purposeChoice: 'auto', reference: 'uploaded' })
    expect(ok.status).toBe(200)
    expect(read(withFile.id).referenceSource).toBe(p)
    expect(((await ok.json()) as JobDto).referenceSource).toBe('파일: reference-upload.mp4')

    const without = job('ready')
    expect((await call(start, without.id, { purposeChoice: 'auto', reference: 'uploaded' })).status).toBe(400)
    expect(read(without.id).status).toBe('ready')
  })

  test('http(s) 링크가 아닌 문자열(내 컴퓨터의 경로 등)은 레퍼런스로 받지 않는다', async () => {
    const j = job('ready')
    expect((await call(start, j.id, { purposeChoice: 'auto', reference: '/Users/me/secret.mp4' })).status).toBe(400)
    expect((await call(start, j.id, { purposeChoice: 'auto', reference: 'file:///etc/passwd' })).status).toBe(400)
    expect(read(j.id).status).toBe('ready')
  })

  test('ready 가 아니면 409', async () => {
    const j = job('analyzing')
    expect((await call(start, j.id, { purposeChoice: 'auto' })).status).toBe(409)
  })
})

describe('plan', () => {
  test.each(['awaiting_reference', 'awaiting_plan', 'awaiting_confirm'] as JobStatus[])('%s → queued_plan, 입력을 갱신하고 오류를 비운다', async (status) => {
    const j = job(status, { referenceSource: 'https://youtu.be/old', requestText: '이전 요청', purposeChoice: 'auto' })
    const res = await call(plan, j.id, { reference: 'https://youtu.be/new', request: '컷을 더 빠르게', purposeChoice: 'post' })
    expect(res.status).toBe(200)
    expect(read(j.id)).toMatchObject({ status: 'queued_plan', referenceSource: 'https://youtu.be/new', requestText: '컷을 더 빠르게', purposeChoice: 'post', errorMessage: null, failedPhase: null })
  })

  test('보내지 않은 항목은 그대로 두고, reference:null 은 레퍼런스를 지운다', async () => {
    const j = job('awaiting_plan', { referenceSource: 'https://youtu.be/old', requestText: '요청', purposeChoice: 'short' })
    await call(plan, j.id, { request: '다른 요청' })
    expect(read(j.id)).toMatchObject({ referenceSource: 'https://youtu.be/old', requestText: '다른 요청', purposeChoice: 'short' })
    const k = job('awaiting_plan', { referenceSource: 'https://youtu.be/old' })
    await call(plan, k.id, { reference: null })
    expect(read(k.id).referenceSource).toBeNull()
  })

  test('plan 단계에서 실패한 작업은 새 레퍼런스로 다시 요청할 수 있고, analysis 에서 실패한 작업은 409', async () => {
    const failedPlan = job('failed', { failedPhase: 'plan', errorMessage: '비공개 영상이에요' })
    expect((await call(plan, failedPlan.id, { reference: 'https://youtu.be/ok' })).status).toBe(200)
    expect(read(failedPlan.id)).toMatchObject({ status: 'queued_plan', errorMessage: null, failedPhase: null })
    const failedAnalysis = job('failed', { failedPhase: 'analysis' })
    expect((await call(plan, failedAnalysis.id, { reference: 'https://youtu.be/ok' })).status).toBe(409)
    expect(read(failedAnalysis.id).status).toBe('failed')
  })

  test('그 밖의 상태(ready·producing 등)는 409', async () => {
    for (const status of ['ready', 'producing', 'confirmed'] as JobStatus[]) {
      expect((await call(plan, job(status).id, {})).status).toBe(409)
    }
  })

  test('본문이 비어 있어도 된다(입력은 그대로 다시 계획)', async () => {
    const j = job('awaiting_plan', { requestText: '요청' })
    expect((await call(plan, j.id)).status).toBe(200)
    expect(read(j.id)).toMatchObject({ status: 'queued_plan', requestText: '요청' })
  })
})

describe('approve (Review Focus 2)', () => {
  test('awaiting_plan → queued_produce, 자막·화질 설정을 기록한다', async () => {
    const j = job('awaiting_plan')
    expect((await call(approve, j.id, { captions: 'off', quality: 'delivery' })).status).toBe(200)
    expect(read(j.id)).toMatchObject({ status: 'queued_produce', captionsMode: 'off', quality: 'delivery' })
  })

  test('같은 작업을 두 번 승인하면(두 탭) 한쪽만 200, 다른 쪽은 409 이고 한 번만 처리된다', async () => {
    const j = job('awaiting_plan')
    const [a, b] = await Promise.all([call(approve, j.id, { quality: 'looks' }), call(approve, j.id, { quality: 'draft' })])
    expect([a.status, b.status].sort()).toEqual([200, 409])
    expect(read(j.id).status).toBe('queued_produce')
  })

  test('설정을 안 보내면 기존 값을 유지하고, 잘못된 값은 400', async () => {
    const j = job('awaiting_plan', { quality: 'draft', captionsMode: 'off' })
    expect((await call(approve, j.id, { quality: 'ultra' })).status).toBe(400)
    expect(read(j.id).status).toBe('awaiting_plan')
    await call(approve, j.id, {})
    expect(read(j.id)).toMatchObject({ status: 'queued_produce', quality: 'draft', captionsMode: 'off' })
  })

  describe('소리 설정(audio)', () => {
    const saved = process.env.VAE_DEEP_FILTER
    let tool: string
    beforeEach(() => {
      tool = path.join(dir, 'deep-filter')
      fs.writeFileSync(tool, '#!/bin/sh\n', { mode: 0o755 })
      process.env.VAE_DEEP_FILTER = tool
    })
    afterEach(() => {
      if (saved === undefined) delete process.env.VAE_DEEP_FILTER
      else process.env.VAE_DEEP_FILTER = saved
    })

    test('voice 를 기록하고 응답 DTO 에 audioMode 가 있다', async () => {
      const j = job('awaiting_plan')
      const res = await call(approve, j.id, { audio: 'voice' })
      expect(res.status).toBe(200)
      expect(((await res.json()) as JobDto).audioMode).toBe('voice')
      expect(read(j.id)).toMatchObject({ status: 'queued_produce', audioMode: 'voice' })
    })

    test('보내지 않으면 기존 값을 유지한다(기본 original)', async () => {
      const j = job('awaiting_plan')
      await call(approve, j.id, {})
      expect(read(j.id).audioMode).toBe('original')
      const k = job('awaiting_plan', { audioMode: 'voice' })
      await call(approve, k.id, {})
      expect(read(k.id).audioMode).toBe('voice')
    })

    test('잘못된 값은 400 이고 작업은 승인되지 않는다', async () => {
      const j = job('awaiting_plan')
      expect((await call(approve, j.id, { audio: 'loud' })).status).toBe(400)
      expect(read(j.id).status).toBe('awaiting_plan')
    })

    test('보정 도구가 없는데 voice 를 고르면 400(설치 안내)이고 승인되지 않는다. original 은 도구 없이도 된다', async () => {
      process.env.VAE_DEEP_FILTER = path.join(dir, 'missing-tool')
      const j = job('awaiting_plan')
      const res = await call(approve, j.id, { audio: 'voice' })
      expect(res.status).toBe(400)
      expect(((await res.json()) as { error: string }).error).toContain('README')
      expect(read(j.id).status).toBe('awaiting_plan')
      expect((await call(approve, j.id, { audio: 'original' })).status).toBe(200)
    })
  })

  describe('편집 구성 문구 수정(scriptEdits)', () => {
    const SCRIPT = { version: 1, title: '프로님의 롱아이언 꿀팁', hook: { sourceStart: 30, sourceEnd: 33, question: '왜 나만 안 맞을까?' }, openingLines: ['롱아이언 실전편', '꿀팁 공개?'],
      sections: [{ atSec: 5, label: '여기서 포인트!' }, { atSec: 20, label: '체크 방법!' }], questions: [{ atSec: 10, text: 'q' }], reactions: [], emphasis: [], speed: 1.1, drop: [] }

    test('계획 단계의 대본이 응답 DTO 에 보이기 좋게 들어 있다(제목·훅 질문·소개 줄·소제목·개수·속도)', async () => {
      const j = job('awaiting_plan', { script: SCRIPT })
      const dto = (await (await call(approve, j.id, {})).json()) as JobDto
      expect(dto.script).toEqual({ title: '프로님의 롱아이언 꿀팁', hookSec: 3, hookQuestion: '왜 나만 안 맞을까?', openingLines: ['롱아이언 실전편', '꿀팁 공개?'], sections: ['여기서 포인트!', '체크 방법!'], questions: 1, reactions: 0, speed: 1.1 })
    })
    test('대본이 없는 작업(감독 실패)의 DTO.script 는 null', async () => {
      const dto = (await (await call(approve, job('awaiting_plan').id, {})).json()) as JobDto
      expect(dto.script).toBeNull()
    })
    test('승인에 scriptEdits 를 보내면 저장되고, DTO 에는 고친 값이 보인다', async () => {
      const j = job('awaiting_plan', { script: SCRIPT })
      const res = await call(approve, j.id, { scriptEdits: { title: '내가 고친 제목', hookQuestion: '새 질문?', openingLines: ['한 줄만'] } })
      expect(res.status).toBe(200)
      expect(read(j.id).scriptEdits).toEqual({ title: '내가 고친 제목', hookQuestion: '새 질문?', openingLines: ['한 줄만'] })
      expect(((await res.json()) as JobDto).script).toMatchObject({ title: '내가 고친 제목', hookQuestion: '새 질문?', openingLines: ['한 줄만'] })
    })
    test('보내지 않으면 기존 수정값을 유지한다', async () => {
      const j = job('awaiting_plan', { script: SCRIPT, scriptEdits: { title: '이전에 고친 제목' } })
      await call(approve, j.id, {})
      expect(read(j.id).scriptEdits).toEqual({ title: '이전에 고친 제목' })
    })
    test.each([
      ['제목 19자', { title: '가'.repeat(19) }],
      ['빈 제목', { title: '' }],
      ['훅 질문 23자', { hookQuestion: '가'.repeat(23) }],
      ['소개 줄 4개', { openingLines: ['a', 'b', 'c', 'd'] }],
      ['소개 줄 23자', { openingLines: ['가'.repeat(23)] }],
      ['주소가 든 제목', { title: 'https://example.com' }],
      ['알 수 없는 칸', { speed: 3 }],
    ])('잘못된 수정값(%s)은 400 이고 승인되지 않는다', async (_n, edits) => {
      const j = job('awaiting_plan', { script: SCRIPT })
      expect((await call(approve, j.id, { scriptEdits: edits })).status).toBe(400)
      expect(read(j.id).status).toBe('awaiting_plan')
    })
    test('대본이 없는 작업(감독 실패)에 scriptEdits 를 보내면 무시하고 승인된다', async () => {
      const j = job('awaiting_plan')
      expect((await call(approve, j.id, { scriptEdits: { title: '제목' } })).status).toBe(200)
      expect(read(j.id).scriptEdits).toBeNull()
    })
  })

  describe('자막 위치(captionPosition)', () => {
    test.each(['top', 'middle', 'bottom'] as const)('%s 를 기록하고 응답 DTO 에 captionPosition 이 있다', async (position) => {
      const j = job('awaiting_plan')
      const res = await call(approve, j.id, { captionPosition: position })
      expect(res.status).toBe(200)
      expect(((await res.json()) as JobDto).captionPosition).toBe(position)
      expect(read(j.id)).toMatchObject({ status: 'queued_produce', captionPosition: position })
    })
    test('보내지 않으면 계획이 정해 둔 값을 그대로 둔다', async () => {
      const j = job('awaiting_plan', { captionPosition: 'top' })
      await call(approve, j.id, {})
      expect(read(j.id).captionPosition).toBe('top')
    })
    test('잘못된 값(center, 빈 문자열)은 400 이고 승인되지 않는다', async () => {
      const j = job('awaiting_plan')
      expect((await call(approve, j.id, { captionPosition: 'center' })).status).toBe(400)
      expect((await call(approve, j.id, { captionPosition: '' })).status).toBe(400)
      expect(read(j.id).status).toBe('awaiting_plan')
    })
  })

  describe('배경음악·효과음(bgm / sfx)', () => {
    const savedSound = process.env.VAE_SOUND_DIR
    let sound: string
    /** 임시 음원 폴더에 목록과 가짜 파일을 만든다 */
    const catalog = (o: { bgm?: boolean; sfx?: boolean } = { bgm: true, sfx: true }) => {
      const tracks: Record<string, unknown>[] = []
      const common = { author: '작가', sourceUrl: 'https://pixabay.com/x', license: 'Pixabay License', durationSec: 60, peakDb: -2 }
      if (o.bgm) tracks.push({ kind: 'bgm', id: 'calm-1', file: 'bgm/calm-1.mp3', title: '잔잔한 곡', lufs: -14, mood: 'calm', ...common })
      if (o.sfx) tracks.push({ kind: 'sfx', id: 'whoosh-1', file: 'sfx/whoosh-1.mp3', title: '휙', lufs: null, role: 'whoosh', ...common })
      for (const t of tracks) {
        fs.mkdirSync(path.dirname(path.join(sound, String(t.file))), { recursive: true })
        fs.writeFileSync(path.join(sound, String(t.file)), 'x')
      }
      fs.writeFileSync(path.join(sound, 'manifest.json'), JSON.stringify({ version: 1, tracks }))
    }
    beforeEach(() => {
      sound = path.join(dir, 'sound')
      fs.mkdirSync(sound)
      process.env.VAE_SOUND_DIR = sound
      catalog()
    })
    afterEach(() => {
      if (savedSound === undefined) delete process.env.VAE_SOUND_DIR
      else process.env.VAE_SOUND_DIR = savedSound
    })

    test('곡과 효과음을 기록하고 응답 DTO 에 bgmId·sfxMode 가 있다', async () => {
      const j = job('awaiting_plan')
      const res = await call(approve, j.id, { bgm: 'calm-1', sfx: 'on' })
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ bgmId: 'calm-1', sfxMode: 'on' })
      expect(read(j.id)).toMatchObject({ status: 'queued_produce', bgmId: 'calm-1', sfxMode: 'on' })
    })

    test('보내지 않으면 기본(없음·끄기)이고, 기존 값은 유지한다', async () => {
      const j = job('awaiting_plan')
      await call(approve, j.id, {})
      expect(read(j.id)).toMatchObject({ bgmId: null, sfxMode: 'off' })
      const k = job('awaiting_plan', { bgmId: 'calm-1', sfxMode: 'on' })
      await call(approve, k.id, {})
      expect(read(k.id)).toMatchObject({ bgmId: 'calm-1', sfxMode: 'on' })
    })

    test('bgm: null 로 고른 곡을 지울 수 있다', async () => {
      const j = job('awaiting_plan', { bgmId: 'calm-1' })
      expect((await call(approve, j.id, { bgm: null })).status).toBe(200)
      expect(read(j.id).bgmId).toBeNull()
    })

    test('목록에 없는 곡이면 400(한국어)이고 승인되지 않는다', async () => {
      const j = job('awaiting_plan')
      const res = await call(approve, j.id, { bgm: 'nope' })
      expect(res.status).toBe(400)
      expect(((await res.json()) as { error: string }).error).toContain('배경음악')
      expect(read(j.id).status).toBe('awaiting_plan')
    })

    test('효과음 파일을 곡 id 로 넣으면(whoosh-1) 배경음악으로 인정하지 않는다', async () => {
      expect((await call(approve, job('awaiting_plan').id, { bgm: 'whoosh-1' })).status).toBe(400)
    })

    test('효과음을 켰는데 효과음 파일이 없으면 400이고, 끄면 된다', async () => {
      catalog({ bgm: true, sfx: false })
      const j = job('awaiting_plan')
      const res = await call(approve, j.id, { sfx: 'on' })
      expect(res.status).toBe(400)
      expect(((await res.json()) as { error: string }).error).toContain('효과음')
      expect((await call(approve, j.id, { sfx: 'off' })).status).toBe(200)
    })

    test('이전에 골라 둔 곡이 그 사이 목록에서 사라졌으면, 값을 안 보내도 400으로 알린다(제작 중에 실패하지 않게)', async () => {
      const j = job('awaiting_plan', { bgmId: 'gone-track' })
      expect((await call(approve, j.id, {})).status).toBe(400)
      expect(read(j.id).status).toBe('awaiting_plan')
    })

    test('음원 목록이 깨졌으면 400(목록 오류를 그대로 안내)', async () => {
      fs.writeFileSync(path.join(sound, 'manifest.json'), '{ broken')
      const res = await call(approve, job('awaiting_plan').id, { bgm: 'calm-1' })
      expect(res.status).toBe(400)
      expect(((await res.json()) as { error: string }).error).toContain('manifest.json')
    })

    test('아무것도 고르지 않았다면 음원 폴더가 없어도 승인된다', async () => {
      fs.rmSync(sound, { recursive: true, force: true })
      expect((await call(approve, job('awaiting_plan').id, {})).status).toBe(200)
    })

    test('잘못된 값(sfx: loud, 빈 bgm)은 400이고 승인되지 않는다', async () => {
      const j = job('awaiting_plan')
      expect((await call(approve, j.id, { sfx: 'loud' })).status).toBe(400)
      expect((await call(approve, j.id, { bgm: '' })).status).toBe(400)
      expect(read(j.id).status).toBe('awaiting_plan')
    })
  })

  test('awaiting_plan 이 아니면 409', async () => {
    expect((await call(approve, job('awaiting_reference').id, {})).status).toBe(409)
  })
})

describe('confirm', () => {
  test('awaiting_confirm → confirmed + confirmedAt, 두 번째는 409', async () => {
    const j = job('awaiting_confirm')
    expect((await call(confirm, j.id)).status).toBe(200)
    expect(read(j.id).status).toBe('confirmed')
    expect(new Date(read(j.id).confirmedAt!).toString()).not.toBe('Invalid Date')
    expect((await call(confirm, j.id)).status).toBe(409)
  })
  test('결과가 나오기 전에는 409', async () => {
    expect((await call(confirm, job('producing').id)).status).toBe(409)
  })
})

describe('retry', () => {
  test.each([
    ['probe', 'queued_probe'],
    ['analysis', 'queued_analysis'],
    ['plan', 'queued_plan'],
    ['produce', 'queued_produce'],
  ] as const)('failed(%s) → %s, 오류를 비운다', async (phase, queued) => {
    const j = job('failed', { failedPhase: phase, errorMessage: '실패' })
    expect((await call(retry, j.id)).status).toBe(200)
    expect(read(j.id)).toMatchObject({ status: queued, errorMessage: null, failedPhase: null })
  })
  test('실패한 작업이 아니면 409', async () => {
    expect((await call(retry, job('ready').id)).status).toBe(409)
  })

  describe('배경음악·효과음을 못 쓰게 돼서 제작이 실패한 작업', () => {
    const savedSound = process.env.VAE_SOUND_DIR
    let sound: string
    const writeCatalog = (ids: string[]) => {
      const tracks = ids.map((id) => ({ kind: 'bgm', id, file: `bgm/${id}.mp3`, title: id, author: '작가', sourceUrl: 'https://mixkit.co/x', license: 'Mixkit Free License', durationSec: 60, lufs: -14, peakDb: -1, mood: 'calm' }))
      for (const t of tracks) {
        fs.mkdirSync(path.join(sound, 'bgm'), { recursive: true })
        fs.writeFileSync(path.join(sound, t.file), 'x')
      }
      fs.writeFileSync(path.join(sound, 'manifest.json'), JSON.stringify({ version: 1, tracks }))
    }
    beforeEach(() => {
      sound = path.join(dir, 'sound')
      fs.mkdirSync(sound)
      process.env.VAE_SOUND_DIR = sound
    })
    afterEach(() => {
      if (savedSound === undefined) delete process.env.VAE_SOUND_DIR
      else process.env.VAE_SOUND_DIR = savedSound
    })

    test('저장된 곡이 목록에서 사라졌으면 다시 시도가 제작이 아니라 계획 단계로 돌려보낸다(곡을 다시 고를 수 있게)', async () => {
      writeCatalog(['other'])
      const j = job('failed', { failedPhase: 'produce', errorMessage: '고른 배경음악(gone)을 찾을 수 없어요', bgmId: 'gone' })
      expect((await call(retry, j.id)).status).toBe(200)
      expect(read(j.id)).toMatchObject({ status: 'queued_plan', errorMessage: null, failedPhase: null })
      expect(read(j.id).log.map((l) => l.message).join(' ')).toContain('배경음악')
    })
    test('음원 목록이 깨졌어도 같다(계획 단계로)', async () => {
      fs.writeFileSync(path.join(sound, 'manifest.json'), '{ broken')
      const j = job('failed', { failedPhase: 'produce', bgmId: 'x' })
      await call(retry, j.id)
      expect(read(j.id).status).toBe('queued_plan')
    })
    test('효과음을 켜 뒀는데 효과음 파일이 없어도 계획 단계로', async () => {
      writeCatalog(['a'])
      const j = job('failed', { failedPhase: 'produce', sfxMode: 'on' })
      await call(retry, j.id)
      expect(read(j.id).status).toBe('queued_plan')
    })
    test('저장된 곡이 목록에 있으면 그대로 제작을 다시 시도한다', async () => {
      writeCatalog(['calm-1'])
      const j = job('failed', { failedPhase: 'produce', bgmId: 'calm-1' })
      await call(retry, j.id)
      expect(read(j.id).status).toBe('queued_produce')
    })
    test('소리를 고르지 않았다면 음원 폴더가 없어도 제작을 다시 시도한다', async () => {
      const j = job('failed', { failedPhase: 'produce' })
      await call(retry, j.id)
      expect(read(j.id).status).toBe('queued_produce')
    })
    test('다른 단계(plan)의 실패는 곡 상태와 상관없이 그 단계부터', async () => {
      const j = job('failed', { failedPhase: 'plan', bgmId: 'gone' })
      await call(retry, j.id)
      expect(read(j.id).status).toBe('queued_plan')
    })
  })
})

describe('other-version', () => {
  /** 부모 작업 + 폴더에 source·analysis.json·prepared.json·썸네일을 만들어 둔다 */
  function parent(status: JobStatus = 'confirmed', purpose: 'post' | 'short' | null = 'short') {
    const { jobs } = getContext()
    const base = job(status, { purpose, sourceName: '내 영상.mp4', description: '골프 레슨', requestText: '컷을 빠르게', referenceSource: 'https://youtu.be/abc' })
    const d = jobs.jobDir(base.id)
    const source = path.join(d, 'source.mp4')
    const normalized = path.join(d, 'source-h264.mp4')
    const thumb = path.join(d, 'thumb.jpg')
    fs.writeFileSync(source, 'SOURCE')
    fs.writeFileSync(normalized, 'NORMALIZED')
    fs.writeFileSync(thumb, 'JPG')
    fs.writeFileSync(path.join(d, 'analysis.json'), JSON.stringify({ version: 1, sourcePath: normalized, info: { path: normalized, durationSec: 5 }, summary: { oneLine: '요약' } }))
    fs.writeFileSync(path.join(d, 'prepared.json'), JSON.stringify({ purpose: 'short', referenceSource: 'https://youtu.be/abc', spec: { orientation: 'portrait' } }))
    return jobs.update(base.id, { sourcePath: source, thumbPath: thumb, summary: { oneLine: '요약' }, sourceInfo: { durationSec: 5, width: 1080, height: 1920 } })
  }

  test('소리 설정(audioMode)은 새 작업이 부모에서 이어받는다 — 다른 버전을 만들 때마다 다시 고르지 않아도 된다', async () => {
    const p = parent('confirmed', 'short')
    getContext().jobs.update(p.id, { audioMode: 'voice' })
    const child = (await (await call(otherVersion, p.id)).json()) as JobDto
    expect(child.audioMode).toBe('voice')
  })

  test('배경음악·효과음 선택(bgmId·sfxMode)도 새 작업이 부모에서 이어받는다', async () => {
    const p = parent('confirmed', 'short')
    getContext().jobs.update(p.id, { bgmId: 'calm-1', sfxMode: 'on' })
    const child = (await (await call(otherVersion, p.id)).json()) as JobDto
    expect(child).toMatchObject({ bgmId: 'calm-1', sfxMode: 'on' })
  })

  test('반대 용도의 새 작업이 계획 단계에서 시작하고, 원본·분석·계획을 가져온다', async () => {
    const p = parent('confirmed', 'short')
    const res = await call(otherVersion, p.id)
    expect(res.status).toBe(201)
    const child = (await res.json()) as JobDto
    expect(child).toMatchObject({ status: 'queued_plan', purposeChoice: 'post', parentJobId: p.id, description: '골프 레슨', requestText: '컷을 빠르게', referenceSource: 'https://youtu.be/abc' })
    const c = read(child.id)
    const cd = getContext().jobs.jobDir(child.id)
    expect(fs.readFileSync(path.join(cd, 'source.mp4'), 'utf8')).toBe('SOURCE')
    expect(c.sourcePath).toBe(path.join(cd, 'source.mp4'))
    expect(fs.existsSync(path.join(cd, 'prepared.json'))).toBe(true)
    const analysis = JSON.parse(fs.readFileSync(path.join(cd, 'analysis.json'), 'utf8'))
    expect(analysis.sourcePath).toBe(path.join(cd, 'source-h264.mp4')) // 부모 폴더가 아니라 자기 폴더를 가리킨다
    expect(analysis.info.path).toBe(path.join(cd, 'source-h264.mp4'))
    expect(fs.readFileSync(analysis.sourcePath, 'utf8')).toBe('NORMALIZED')
    expect(read(p.id).status).toBe('confirmed') // 부모는 그대로
  })

  test('부모를 지워도 자식의 파일은 남는다', async () => {
    const p = parent('awaiting_confirm', 'post')
    const child = (await (await call(otherVersion, p.id)).json()) as JobDto
    expect(child.purposeChoice).toBe('short')
    getContext().jobs.remove(p.id)
    const analysis = JSON.parse(fs.readFileSync(path.join(getContext().jobs.jobDir(child.id), 'analysis.json'), 'utf8'))
    expect(fs.existsSync(analysis.sourcePath)).toBe(true)
  })

  test('확정된 용도가 없거나 결과가 나오기 전이면 409', async () => {
    expect((await call(otherVersion, parent('confirmed', null).id)).status).toBe(409)
    expect((await call(otherVersion, parent('producing', 'short').id)).status).toBe(409)
  })

  test('분석 결과(analysis.json)가 없으면 409', async () => {
    const p = parent()
    fs.rmSync(path.join(getContext().jobs.jobDir(p.id), 'analysis.json'))
    expect((await call(otherVersion, p.id)).status).toBe(409)
  })
})

describe('공통', () => {
  const actions: [string, Handler, JobStatus, unknown][] = [
    ['start', start, 'ready', { purposeChoice: 'auto' }],
    ['plan', plan, 'awaiting_plan', {}],
    ['approve', approve, 'awaiting_plan', {}],
    ['confirm', confirm, 'awaiting_confirm', undefined],
    ['retry', retry, 'failed', undefined],
    ['other-version', otherVersion, 'confirmed', undefined],
  ]

  test.each(actions)('%s: 다른 Origin 은 403 이고 상태를 바꾸지 않는다', async (_n, handler, status, body) => {
    const j = job(status, { failedPhase: 'plan', purpose: 'short' })
    const res = await call(handler, j.id, body, { origin: 'http://evil.example' })
    expect(res.status).toBe(403)
    expect(read(j.id).status).toBe(status)
  })

  test.each(actions)('%s: 없는 작업은 404, 형식이 틀린 id 는 400', async (_n, handler, _s, body) => {
    expect((await call(handler, 'aaaaaaaaaa', body)).status).toBe(404)
    expect((await call(handler, '../x', body)).status).toBe(400)
  })

  test('잘못된 본문(알 수 없는 용도·깨진 JSON)은 400 이고 상태를 바꾸지 않는다', async () => {
    const j = job('ready')
    expect((await call(start, j.id, { purposeChoice: 'xx' })).status).toBe(400)
    expect((await call(start, j.id, '{깨진 json')).status).toBe(400)
    expect((await call(start, j.id, {})).status).toBe(400) // purposeChoice 는 필수
    expect(read(j.id).status).toBe('ready')
  })
})
