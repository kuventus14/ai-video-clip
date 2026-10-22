import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, test } from 'vitest'
import { buildProject, chooseReframeMode, renderProject, type BuildInput } from '../src/core/compose.ts'
import { run } from '../src/core/exec.ts'
import type { AppliedStyle } from '../src/core/interpret.ts'
import { probeVideo } from '../src/core/media.ts'
import type { VideoInfo } from '../src/core/types.ts'
import { ensureFixtures, type Fixtures } from './helpers/fixtures.ts'

const SHORT = { width: 1080, height: 1920 }
const POST = { width: 1920, height: 1080 }
const STYLE: AppliedStyle = { captions: { position: 'bottom', sizePx: 64, color: '#FFFFFF', maxChars: 14 }, transition: 'hard-cut', padSec: 0.25 }
const KEPT = [{ start: 0, end: 2 }, { start: 3, end: 5 }]
const CUES = [{ text: '안녕하세요', start: 0.2, end: 1.5 }, { text: '반갑습니다', start: 2.1, end: 3.6 }]

let fx: Fixtures
let landscape: VideoInfo
beforeAll(async () => {
  fx = await ensureFixtures()
  landscape = await probeVideo(fx.landscape)
})

const work = () => fs.mkdtempSync(path.join(os.tmpdir(), 'compose-'))
const input = (over: Partial<BuildInput> = {}): BuildInput => ({
  workDir: work(),
  sourcePath: fx.landscape,
  info: landscape,
  canvas: SHORT,
  kept: KEPT,
  cues: CUES,
  reframe: 'track',
  style: STYLE,
  ...over,
})
const html = (dir: string) => fs.readFileSync(path.join(dir, 'index.html'), 'utf8')
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length

describe('chooseReframeMode', () => {
  const cases: [string, { width: number; height: number }, { width: number; height: number }, string][] = [
    ['16:9 → 9:16 (자르지 않고 가운데 + 위아래 블러)', { width: 1920, height: 1080 }, SHORT, 'blur-fill'],
    ['9:16 → 16:9', { width: 1080, height: 1920 }, POST, 'blur-fill'],
    ['1:1 → 9:16', { width: 1080, height: 1080 }, SHORT, 'blur-fill'],
    ['1:1 → 16:9', { width: 1080, height: 1080 }, POST, 'blur-fill'],
    ['4:5 → 9:16', { width: 1080, height: 1350 }, SHORT, 'blur-fill'],
    ['21:9 → 16:9 (위아래 띠)', { width: 2520, height: 1080 }, POST, 'blur-fill'],
    ['16:9 → 16:9', { width: 1920, height: 1080 }, POST, 'none'],
    ['9:16 → 9:16', { width: 1080, height: 1920 }, SHORT, 'none'],
    ['거의 같은 비율(1920x1088 → 16:9)', { width: 1920, height: 1088 }, POST, 'none'],
  ]
  test.each(cases)('%s → %s', (_n, src, canvas, mode) => {
    expect(chooseReframeMode(src, canvas)).toBe(mode)
  })
})

describe('buildProject', () => {
  test('track: 캔버스·길이·구간별 video·자막·타임라인 등록이 계획대로 들어간다', async () => {
    const { projectDir, durationSec } = await buildProject(input())
    const h = html(projectDir)
    expect(durationSec).toBe(4)
    expect(h).toContain('data-width="1080"')
    expect(h).toContain('data-height="1920"')
    expect(h).toContain('data-duration="4"')
    expect(count(h, /<video/g)).toBe(2)
    expect(h).toContain('data-media-start="0"')
    expect(h).toContain('data-media-start="3"')
    const starts = [...h.matchAll(/<video[^>]*data-start="([0-9.]+)"/g)].map((m) => Number(m[1]))
    expect(starts).toEqual([0, 2])
    expect(h).not.toContain('crossorigin')
    expect(count(h, /class="clip caption"/g)).toBe(2)
    expect(h).toContain('window.__timelines["main"]')
    expect(h).toContain('data-composition-id="main"')
    expect(fs.statSync(path.join(projectDir, 'source.mp4')).size).toBeGreaterThan(0)
  })

  test('video 는 타이밍이 걸린 래퍼 안에 있지 않다 (#punch/#inner 는 data-start 가 없다)', async () => {
    const h = html((await buildProject(input())).projectDir)
    expect(h).toMatch(/<div id="punch"(?![^>]*data-start)[^>]*>/)
    expect(h).toMatch(/<div id="inner"(?![^>]*data-start)[^>]*>/)
  })

  test('한글·공백·괄호 파일명 입력도 ASCII 이름 source.mp4 로 쓴다', async () => {
    const { projectDir } = await buildProject(input({ sourcePath: fx.koreanName }))
    const h = html(projectDir)
    expect(h).not.toMatch(/테스트|\(1\)/)
    expect(h).toContain('src="source.mp4"')
    expect(fs.existsSync(path.join(projectDir, 'source.mp4'))).toBe(true)
  })

  test('track: 크롭 키프레임을 #inner 의 x 위치로 바꾼다 (중심 0.5 → 0.7)', async () => {
    const crop = [{ t: 0, centerX: 0.5 }, { t: 4, centerX: 0.7 }]
    const h = html((await buildProject(input({ crop }))).projectDir)
    // 영상 폭 = 1920*1920/1080 = 3413.33px, x = 540 - centerX*폭
    expect(h).toContain('-1166.67')
    expect(h).toContain('-1849.33')
  })

  test('blur-fill: 블러 배경은 어둡게 깔아(밝기 낮춤) 위아래 띠에 얹는 흰색·노란색 글자가 밝은 장면에서도 읽힌다', async () => {
    const { projectDir } = await buildProject(input({ canvas: SHORT, info: { ...landscape, width: 1920, height: 1080 }, reframe: 'blur-fill' }))
    const bg = html(projectDir).match(/<video id="seg-0-bg"[^>]*style="([^"]*)"/)![1]!
    expect(bg).toContain('blur(')
    expect(bg).toMatch(/brightness\((0\.[3-7]\d*)\)/)
  })

  test('blur-fill: 구간마다 소리 없는 블러 배경 + 소리 있는 앞 영상, 총 4개', async () => {
    const { projectDir } = await buildProject(input({ canvas: POST, info: { ...landscape, width: 1080, height: 1920 }, reframe: 'blur-fill' }))
    const h = html(projectDir)
    expect(count(h, /<video/g)).toBe(4)
    expect(count(h, /<video[^>]*data-has-audio="true"/g)).toBe(2)
    expect(count(h, /<video[^>]*\bmuted\b/g)).toBe(2)
    expect(h).toContain('blur(')
    expect(h).toContain('object-fit: contain')
  })

  test('none: 크롭 없이 캔버스를 채운다', async () => {
    const h = html((await buildProject(input({ canvas: POST, reframe: 'none' }))).projectDir)
    expect(h).toContain('object-fit: cover')
    expect(h).not.toContain('"#inner"')
  })

  test('punch-zoom 이면 둘째 구간 시작(출력 2초)에 #punch 확대 트윈이 생긴다', async () => {
    const h = html((await buildProject(input({ style: { ...STYLE, transition: 'punch-zoom' } }))).projectDir)
    expect(h).toMatch(/tl\.fromTo\("#punch"[^;]*,\s*2\)/)
    const hard = html((await buildProject(input())).projectDir)
    expect(hard).not.toContain('#punch"')
  })

  test('자막 글은 HTML 이스케이프되고 영상 길이를 넘지 않게 잘린다', async () => {
    const cues = [{ text: '<b>"A&B"</b>', start: 3.5, end: 9 }, { text: '범위 밖', start: 6, end: 7 }]
    const h = html((await buildProject(input({ cues }))).projectDir)
    expect(h).toContain('&lt;b&gt;')
    expect(h).toContain('&amp;')
    expect(h).not.toContain('<b>')
    expect(h).not.toContain('범위 밖')
    expect(h).toMatch(/data-start="3.5" data-duration="0.5"/)
  })

  test('강조 색이 있으면 큐의 마지막 단어를 그 색으로 감싼다', async () => {
    const style = { ...STYLE, captions: { ...STYLE.captions, highlightColor: '#FFE600' } }
    const h = html((await buildProject(input({ cues: [{ text: '이건 꿀팁', start: 0, end: 1 }], style }))).projectDir)
    expect(h).toContain('<span style="color:#FFE600">꿀팁</span>')
  })

  test('제목 카드는 style.hookTitle 이 있을 때만 0초부터 들어간다', async () => {
    const withHook = html((await buildProject(input({ style: { ...STYLE, hookTitle: { text: '롱아이언 꿀팁', durationSec: 2.5 } } }))).projectDir)
    expect(withHook).toContain('id="hook"')
    expect(withHook).toContain('롱아이언 꿀팁')
    expect(html((await buildProject(input())).projectDir)).not.toContain('id="hook"')
  })

  test('오디오가 없는 원본은 muted 로 둔다 (data-has-audio 없음)', async () => {
    const silent = await probeVideo(fx.silent)
    const h = html((await buildProject(input({ sourcePath: fx.silent, info: silent, kept: [{ start: 0, end: 2 }], cues: [] }))).projectDir)
    expect(h).toMatch(/<video[^>]*\bmuted\b/)
    expect(h).not.toContain('data-has-audio')
  })

  test('한글 글꼴(Noto Sans KR 700)과 gsap 을 프로젝트 안에 담는다 (네트워크 없이 렌더)', async () => {
    const { projectDir } = await buildProject(input())
    const h = html(projectDir)
    expect(h).toContain("font-family: 'Noto Sans KR'")
    expect(count(h, /@font-face/g)).toBeGreaterThan(50)
    expect(h).toContain('src="lib/gsap.min.js"')
    expect(fs.readdirSync(path.join(projectDir, 'fonts')).filter((f) => f.endsWith('.woff2')).length).toBeGreaterThan(50)
    expect(fs.existsSync(path.join(projectDir, 'lib/gsap.min.js'))).toBe(true)
    expect(h).not.toMatch(/https?:\/\//)
  })
})

describe('hyperframes 통합 — 변환 없이 읽는 입력 (I7 실험을 고정)', () => {
  async function lumaAt(file: string, t: number): Promise<number> {
    const { stdout } = await run('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'signalstats,metadata=print:file=-', '-f', 'null', '-'])
    return Number(stdout.match(/lavfi\.signalstats\.YAVG=([0-9.]+)/)![1])
  }

  test.each([
    ['HEVC mp4', async (dir: string) => {
      const p = path.join(dir, 'hevc.mp4')
      await run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:d=2', '-c:v', 'libx265', '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', p])
      return p
    }, [1920, 1080]],
    ['회전 메타데이터가 있는 H.264', async () => fx.rotated, [1080, 1920]],
  ] as const)('%s 를 변환 없이 렌더링하면 검은 화면이 아니고 크기가 맞다', async (_name, make, size) => {
    const dir = work()
    const src = await make(dir)
    const info = await probeVideo(src)
    const canvas = { width: size[0], height: size[1] }
    const { projectDir } = await buildProject({ workDir: dir, sourcePath: src, info, canvas, kept: [{ start: 0, end: 2 }], cues: [], reframe: chooseReframeMode(info, canvas), style: STYLE })
    const out = path.join(dir, 'out.mp4')
    await renderProject(projectDir, { outPath: out, quality: 'draft' })
    const o = await probeVideo(out)
    expect([o.width, o.height]).toEqual(size)
    expect(o.hasAudio || !info.hasAudio).toBe(true)
    expect(await lumaAt(out, 1)).toBeGreaterThan(20)
  }, 300_000)
})

describe('hyperframes 통합', () => {
  test('check 를 통과하고 draft 렌더가 캔버스 크기·길이·오디오를 지킨다', async () => {
    const { projectDir } = await buildProject(input({ crop: [{ t: 0, centerX: 0.5 }, { t: 4, centerX: 0.6 }] }))
    await run('hyperframes', ['check'], { cwd: projectDir, timeoutMs: 5 * 60_000 })
    const out = path.join(path.dirname(projectDir), 'out.mp4')
    const r = await renderProject(projectDir, { outPath: out, quality: 'draft' })
    expect(r.outPath).toBe(out)
    expect(r.wallSec).toBeGreaterThan(0)
    const info = await probeVideo(out)
    expect([info.width, info.height]).toEqual([1080, 1920])
    expect(info.durationSec).toBeGreaterThan(3.8)
    expect(info.durationSec).toBeLessThan(4.2)
    expect(info.hasAudio).toBe(true)
  }, 600_000)
})
