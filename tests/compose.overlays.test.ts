import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, test } from 'vitest'
import { buildProject, fitFontPx, isEmphasized, overlayLayout, type BuildInput, type RenderScript } from '../src/core/compose.ts'
import { run } from '../src/core/exec.ts'
import type { AppliedStyle } from '../src/core/interpret.ts'
import { probeVideo } from '../src/core/media.ts'
import type { VideoInfo } from '../src/core/types.ts'
import { ensureFixtures, type Fixtures } from './helpers/fixtures.ts'

const SHORT = { width: 1080, height: 1920 }
const POST = { width: 1920, height: 1080 }
const STYLE: AppliedStyle = { captions: { position: 'bottom', sizePx: 64, color: '#FFFFFF', highlightColor: '#FFD400', maxChars: 14 }, transition: 'hard-cut', padSec: 0.25 }
const LAND: Pick<VideoInfo, 'width' | 'height'> = { width: 1920, height: 1080 }
const PORT: Pick<VideoInfo, 'width' | 'height'> = { width: 1080, height: 1920 }

const SCRIPT: RenderScript = {
  title: '프로님의 롱아이언 꿀팁',
  hook: { sec: 3, question: '롱아이언, 왜 나만 안 맞을까?' },
  openingLines: [{ text: '롱아이언 실전편', color: 'yellow' }, { text: '프로님만 아는 꿀팁 공개?', color: 'cyan' }, { text: '백스윙 하나로 달라지는 샷', color: 'white' }],
  sections: [{ start: 3, end: 9, label: '여기서 포인트!' }, { start: 9, end: 14, label: '체크 방법!' }],
  questions: [{ start: 10, text: '아마추어는 백스윙이 짧다?' }],
  reactions: [{ start: 12, text: '와.. 이렇게 뻗는다고?!' }],
  emphasis: ['백스윙', '차이'],
  hookSec: 3,
}

let fx: Fixtures
let landscape: VideoInfo
beforeAll(async () => {
  fx = await ensureFixtures()
  landscape = await probeVideo(fx.landscape)
})
const work = () => fs.mkdtempSync(path.join(os.tmpdir(), 'compose-ov-'))
const input = (over: Partial<BuildInput> = {}): BuildInput => ({
  workDir: work(), sourcePath: fx.landscape, info: landscape, canvas: SHORT,
  kept: [{ start: 0, end: 5 }, { start: 0, end: 5 }, { start: 0, end: 5 }], // 훅 3초 자리 포함 총 15초가 되도록 같은 원본을 쓴다
  cues: [{ text: '백스윙 했을 때 차이가 나더라', start: 4, end: 7 }, { text: '평범한 자막', start: 8, end: 9.5 }],
  reframe: 'blur-fill', style: STYLE, script: SCRIPT, ...over,
})
const html = (dir: string) => fs.readFileSync(path.join(dir, 'index.html'), 'utf8')
const attr = (h: string, id: string, name: string) => h.match(new RegExp(`id="${id}"[^>]*${name}="([^"]*)"`))?.[1]

describe('overlayLayout — 위·아래 띠 계산', () => {
  test('가로 영상(1920x1080)을 세로 캔버스(1080x1920)에 blur-fill 하면 영상은 가운데 띠(top≈656)이고 위·아래에 띠가 생긴다', () => {
    const l = overlayLayout('blur-fill', LAND, SHORT, 'bottom')
    expect(l.band).toBe(true)
    expect(l.videoTop).toBeCloseTo(656, 0)
    expect(l.videoBottom).toBeCloseTo(1264, 0)
    expect(l.titleTop).toBeLessThan(l.videoTop) // 제목은 위 띠 안
    expect(l.captionTop!).toBeGreaterThanOrEqual(l.videoBottom) // 자막은 아래 띠 안
  })
  test('세로 원본(전체 화면)이면 띠가 없고 제목은 화면 위 6~26% 안', () => {
    const l = overlayLayout('none', PORT, SHORT, 'bottom')
    expect(l.band).toBe(false)
    expect(l.titleTop).toBeGreaterThanOrEqual(0.06 * 1920 - 1)
    expect(l.titleTop).toBeLessThanOrEqual(0.26 * 1920)
  })
  test('세로 원본을 가로 캔버스에 blur-fill 하면(영상이 화면 높이를 다 씀) 띠가 없다', () => {
    expect(overlayLayout('blur-fill', PORT, POST, 'bottom').band).toBe(false)
  })
  test('띠가 너무 얇으면(영상이 거의 화면을 채움) 띠 배치를 쓰지 않는다', () => {
    expect(overlayLayout('blur-fill', { width: 1920, height: 1000 }, { width: 1080, height: 800 }, 'bottom').band).toBe(false) // 위·아래 띠가 각각 119px 뿐
  })
  test('자막 위치 top 을 골라도 자막은 화면 높이 26% 아래에서 시작한다(제목·소제목 묶음과 겹치지 않음) (Review Focus 4)', () => {
    for (const [reframe, info] of [['blur-fill', LAND], ['none', PORT]] as const) {
      expect(overlayLayout(reframe, info, SHORT, 'top').captionTop!).toBeGreaterThanOrEqual(0.26 * 1920 - 1)
    }
  })
  test('middle 은 화면 가운데 근처', () => {
    const l = overlayLayout('blur-fill', LAND, SHORT, 'middle')
    expect(Math.abs(l.captionTop! - 960)).toBeLessThan(200)
  })
})

describe('fitFontPx — 긴 문구는 글자 크기를 줄여 박스 폭에 맞춘다', () => {
  test('22자 문구는 폭 88%(950px) 안에 들도록 줄어든다', () => {
    const px = fitFontPx('가'.repeat(22), 59, 1080 * 0.88)
    expect(px).toBeLessThan(59)
    expect(22 * px).toBeLessThanOrEqual(1080 * 0.88)
    expect(px).toBeGreaterThanOrEqual(59 * 0.7) // 70% 아래로는 줄이지 않는다(그 아래는 줄바꿈)
  })
  test('짧은 문구는 기본 크기 그대로', () => {
    expect(fitFontPx('안녕', 59, 950)).toBe(59)
  })
})

describe('isEmphasized', () => {
  test('조사가 붙은 단어도 강조 단어를 포함하면 강조', () => {
    expect(isEmphasized('백스윙을', ['백스윙'])).toBe(true)
    expect(isEmphasized('차이가', ['백스윙', '차이'])).toBe(true)
  })
  test('한 글자 강조어와 무관한 단어는 강조하지 않는다', () => {
    expect(isEmphasized('이렇게', ['이'])).toBe(false)
    expect(isEmphasized('평범한', ['백스윙'])).toBe(false)
  })
})

describe('buildProject + script', () => {
  test('script 가 없으면 오버레이가 하나도 없다(기존과 같음)', async () => {
    const { projectDir } = await buildProject(input({ script: undefined }))
    expect(html(projectDir)).not.toContain('id="ov-')
  })

  test('제목 박스는 영상 내내, 훅 질문은 0~훅 길이, 소개 줄은 훅 직후에 나온다', async () => {
    const { projectDir, durationSec } = await buildProject(input())
    const h = html(projectDir)
    expect(durationSec).toBe(15)
    expect(attr(h, 'ov-title', 'data-start')).toBe('0')
    expect(attr(h, 'ov-title', 'data-duration')).toBe('15')
    expect(attr(h, 'ov-hook', 'data-start')).toBe('0')
    expect(attr(h, 'ov-hook', 'data-duration')).toBe('3')
    expect(Number(attr(h, 'ov-open', 'data-start'))).toBeGreaterThanOrEqual(3)
    expect(h).toContain('롱아이언 실전편')
    expect(h).toContain('백스윙 하나로 달라지는 샷')
    expect(h).toContain('롱아이언, 왜 나만 안 맞을까?')
  })

  test('소제목은 구간마다(시작~끝), 질문·리액션은 2.5초', async () => {
    const { projectDir } = await buildProject(input())
    const h = html(projectDir)
    expect(attr(h, 'ov-sec-1', 'data-start')).toBe('9')
    expect(attr(h, 'ov-sec-1', 'data-duration')).toBe('5')
    expect(attr(h, 'ov-q-0', 'data-duration')).toBe('2.5')
    expect(attr(h, 'ov-r-0', 'data-duration')).toBe('2.5')
  })

  test('소개 줄과 겹치는 소제목·질문은 소개가 끝난 뒤로 밀리고, 다 겹쳐 사라지면 뺀다', async () => {
    const early: RenderScript = { ...SCRIPT, sections: [{ start: 3, end: 4, label: '너무 일찍' }, { start: 3, end: 12, label: '정상' }], questions: [{ start: 3.5, text: '일찍 나온 질문' }] }
    const { projectDir } = await buildProject(input({ script: early }))
    const h = html(projectDir)
    const openEnd = Number(attr(h, 'ov-open', 'data-start')) + Number(attr(h, 'ov-open', 'data-duration'))
    expect(h).not.toContain('너무 일찍') // 소개 구간 안에 다 들어가 사라진다
    expect(Number(attr(h, 'ov-sec-1', 'data-start') ?? attr(h, 'ov-sec-0', 'data-start'))).toBeGreaterThanOrEqual(openEnd - 1e-6)
    expect(Number(attr(h, 'ov-q-0', 'data-start'))).toBeGreaterThanOrEqual(openEnd - 1e-6)
  })

  test('같은 종류의 질문·리액션은 서로 겹치지 않는다(앞의 것이 끝난 뒤로 밀리고, 남는 시간이 모자라면 뺀다)', async () => {
    const close: RenderScript = { ...SCRIPT, questions: [{ start: 7, text: '첫째 질문' }, { start: 8, text: '바로 뒤 질문' }], reactions: [{ start: 7, text: '첫 리액션' }, { start: 8, text: '바로 뒤 리액션' }, { start: 8.5, text: '또 뒤 리액션' }, { start: 9, text: '마지막 리액션' }] }
    const { projectDir } = await buildProject(input({ script: close }))
    const h = html(projectDir)
    const win = (id: string) => [Number(attr(h, id, 'data-start')), Number(attr(h, id, 'data-start')) + Number(attr(h, id, 'data-duration'))] as const
    expect(win('ov-q-1')[0]).toBeGreaterThanOrEqual(win('ov-q-0')[1] - 1e-6)
    expect(win('ov-r-1')[0]).toBeGreaterThanOrEqual(win('ov-r-0')[1] - 1e-6)
    expect(win('ov-r-2')[0]).toBeGreaterThanOrEqual(win('ov-r-1')[1] - 1e-6)
    expect(h).not.toContain('마지막 리액션') // 14.5초로 밀리면 영상 끝(15초)까지 0.8초도 안 남아 뺀다
  })

  test('강조 단어가 든 큐는 그 단어만 노랑 span, 없는 큐는 평문(기존 "마지막 단어 강조" 규칙은 쓰지 않는다)', async () => {
    const { projectDir } = await buildProject(input())
    const h = html(projectDir)
    expect(h).toMatch(/<span style="color:#FFD400">백스윙<\/span>/)
    expect(h).toMatch(/<span style="color:#FFD400">차이가<\/span>/)
    expect(h).toContain('>평범한 자막<') // 평범한 자막은 마지막 단어도 감싸지 않는다
  })

  test('큐마다 팝업(scale) 트윈이 있고, 타이밍이 걸린 클립 자체가 아니라 안쪽 요소를 움직인다', async () => {
    const { projectDir } = await buildProject(input())
    const h = html(projectDir)
    expect(h).toMatch(/"#cap-0 \.text"/)
    expect(h).toMatch(/scale: 0\.85/)
    expect(h).not.toMatch(/tl\.(from|fromTo|to|set)\("#(cap|ov)-[^" ]+"/) // "#cap-0" 같은 클립 자체를 트윈하지 않는다
  })

  test('문구는 HTML 이스케이프된다', async () => {
    const { projectDir } = await buildProject(input({ script: { ...SCRIPT, title: '<b>x</b> & "y"' } }))
    const h = html(projectDir)
    expect(h).toContain('&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;')
    expect(h).not.toContain('<b>x</b>')
  })

  test('옛 제목 카드(hook)는 script 가 있으면 그리지 않는다(중복 방지)', async () => {
    const { projectDir } = await buildProject(input({ style: { ...STYLE, hookTitle: { text: '옛 제목', durationSec: 2.5 } } }))
    expect(html(projectDir)).not.toContain('옛 제목')
  })

  test('가로 블러 채우기에서 제목 위치(top px)가 영상 사각형 위쪽 띠 안에 있다', async () => {
    const { projectDir } = await buildProject(input())
    const h = html(projectDir)
    const top = Number(h.match(/#ov-stack\s*\{[^}]*top:\s*(\d+(?:\.\d+)?)px/)?.[1])
    expect(top).toBeGreaterThan(0)
    expect(top).toBeLessThan(656)
  })

  test('hyperframes check 를 통과한다(오버레이 포함)', async () => {
    const { projectDir } = await buildProject(input())
    await run('hyperframes', ['check'], { cwd: projectDir, timeoutMs: 5 * 60_000 })
  }, 300_000)
})
