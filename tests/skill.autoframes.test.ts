import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

// 스킬(skills/autoframes)에 들어 있는 도구. 타입 선언 없이 쓰려고 이름을 변수로 불러온다.
const LIB = path.resolve(import.meta.dirname, '../skills/autoframes/scripts/autoframes.mjs')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lib = (await import(/* @vite-ignore */ LIB)) as any

const base = { id: 'abc1234567', title: '골프 레슨', stage: null, purpose: 'short', purposeGuess: null, sourceInfo: { durationSec: 65, width: 1080, height: 1920 }, error: null, failedPhase: null }

describe('describeJob — 상태별로 짧게, 다음에 할 일을 알려 준다', () => {
  test('모든 상태에 한국어 이름이 있고, 기다리는 상태에는 다음 명령 안내가 있다', () => {
    for (const s of ['created', 'queued_probe', 'probing', 'ready', 'queued_analysis', 'analyzing', 'awaiting_reference', 'queued_plan', 'planning', 'awaiting_plan', 'queued_produce', 'producing', 'awaiting_confirm', 'confirmed', 'failed']) {
      expect(lib.STATUS_KO[s], s).toBeTruthy()
      expect(lib.describeJob({ ...base, status: s })).toContain('다음:')
    }
    expect([...lib.WAITING].sort()).toEqual(['awaiting_confirm', 'awaiting_plan', 'awaiting_reference', 'confirmed', 'failed', 'ready'])
  })
  test('분석이 끝나면 추천 레퍼런스를 번호·링크와 함께 보인다', () => {
    const text = lib.describeJob({ ...base, status: 'awaiting_reference', recommendations: [{ title: '롱아이언 팁', channel: '골프TV', viewCount: 120000, durationSec: 58, url: 'https://youtu.be/x' }] })
    expect(text).toContain('1. 롱아이언 팁 — 골프TV · 120000회 · 0:58 · https://youtu.be/x')
  })
  test('계획 승인 단계: 이해한 내용·편집 구성·지금 선택을 보인다', () => {
    const text = lib.describeJob({ ...base, status: 'awaiting_plan', planCard: ['컷: 군더더기 정리'], script: { title: '제목', hookQuestion: '왜?', hookSec: 3, openingLines: ['a'], sections: [{}, {}], speed: 1.1 }, captionsMode: 'auto', captionPosition: 'bottom', audioMode: 'original', bgmId: null, sfxMode: 'off', quality: 'looks' })
    expect(text).toContain('• 컷: 군더더기 정리')
    expect(text).toContain('훅 질문 "왜?"(3초)')
    expect(text).toContain('음악 없음 · 효과음 off')
  })
  test('결과 확인 단계: 검수 결과, 확인하지 않은 항목(사용자가 직접), 소리 크기와 AI 추천(AI 는 못 듣는다)을 보인다', () => {
    const text = lib.describeJob({
      ...base, status: 'awaiting_confirm', sfxMode: 'on', resultInfo: { durationSec: 40, width: 1080, height: 1920 },
      report: { passed: false, attempts: 2, findings: [{ id: 'x', severity: 'medium', message: '글자 의심', atSec: 2 }, { id: 'caption-suggestion', severity: 'info', message: '제안' }], appliedCorrections: [{}], suggestions: [{}, {}], unchecked: ['싱크'] },
      soundAdjust: { available: true, bgmGainDb: 3, sfxGainDb: -2, aiBgmGainDb: -1, aiSfxGainDb: 0, aiReason: '말이 많아요', sfxCount: 2 },
    })
    expect(text).toContain('검수: 문제 있음 · 만든 횟수 2 · 결과 0:40 1080×1920')
    expect(text).toContain('[확인] 0:02 글자 의심')
    expect(text).not.toContain('제안\n') // caption-suggestion 은 위에서 따로 세지 않는다
    expect(text).toContain('자동 1건 · 제안만 2건')
    expect(text).toContain('사용자가 직접 확인해야 해요')
    expect(text).toContain('음악 +3dB · 효과음 −2dB (AI 추천: 음악 −1dB · 효과음 기본 — 말이 많아요) — AI 는 소리를 직접 듣지 못해요')
  })
  test('옛 작업은 소리를 다시 섞을 수 없다는 이유를, 실패한 작업은 오류와 단계를 보인다', () => {
    expect(lib.describeJob({ ...base, status: 'awaiting_confirm', soundAdjust: { available: false, reason: '이 작업은 소리만 다시 섞을 수 없어요.' } })).toContain('소리 크기 조절 불가: 이 작업은 소리만 다시 섞을 수 없어요.')
    expect(lib.describeJob({ ...base, status: 'failed', error: '영상을 읽을 수 없어요', failedPhase: 'probe' })).toContain('오류: 영상을 읽을 수 없어요 (단계: probe)')
  })
})

describe('describeCaptions', () => {
  test('줄 번호·시각·글자, 의심 단어, 자막이 없는 구간(2초 이상)을 보인다', () => {
    const text = lib.describeCaptions({
      hasSpeech: true, durationSec: 20, custom: false,
      lines: [{ start: 0, end: 3, text: '첫 줄' }, { start: 8, end: 10, text: '둘째 줄' }],
      original: [{ start: 0, end: 3, text: '첫 줄', lowWords: ['첫'] }],
    })
    expect(text).toContain('자막 2줄 · 영상 0:20')
    expect(text).toContain('1. 0.0–3.0 첫 줄   ⚠ 의심: 첫')
    expect(text).toContain('2. 8.0–10.0 둘째 줄')
    expect(text).toContain('자막이 없는 구간: 0:03–0:08, 0:10–0:20')
  })
  test('말이 인식되지 않은 영상은 직접 넣을 수 있다고 알려 준다', () => {
    expect(lib.describeCaptions({ hasSpeech: false, durationSec: 5, custom: false, lines: [], original: [] })).toContain('직접 넣을 수 있어요')
  })
})

describe('findRepo — 저장소 위치', () => {
  const make = (dir: string, name = 'video-autoeditor') => {
    fs.mkdirSync(path.join(dir, 'src', 'worker'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name }))
    return dir
  }
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'af-'))
  test('AUTOFRAMES_HOME 이 가장 먼저, 다음은 지금 폴더와 그 위쪽, 그다음 홈 아래의 흔한 위치', () => {
    const a = make(path.join(tmp(), 'x'))
    expect(lib.findRepo({ env: { AUTOFRAMES_HOME: a }, home: tmp(), cwd: tmp() })).toBe(a)
    const inner = path.join(make(path.join(tmp(), 'repo')), 'src')
    expect(lib.findRepo({ env: {}, home: tmp(), cwd: inner })).toBe(path.dirname(inner))
    const home = tmp()
    const cloned = make(path.join(home, 'ai-video-clip'))
    expect(lib.findRepo({ env: {}, home, cwd: tmp() })).toBe(cloned)
  })
  test('다른 프로젝트나 없으면 null', () => {
    const other = make(path.join(tmp(), 'o'), 'something-else')
    expect(lib.findRepo({ env: { AUTOFRAMES_HOME: other }, home: tmp(), cwd: tmp() })).toBeNull()
  })
})
