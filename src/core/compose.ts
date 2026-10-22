import fs from 'node:fs'
import path from 'node:path'
import { run } from './exec.ts'
import type { AppliedStyle } from './interpret.ts'
import type { Canvas, CaptionCue, CropKeyframe, ReframeMode, Span, VideoInfo } from './types.ts'

const ROOT = path.resolve(import.meta.dirname, '../..')
const FONT_PKG = path.join(ROOT, 'node_modules/@fontsource/noto-sans-kr')
const GSAP = path.join(ROOT, 'node_modules/gsap/dist/gsap.min.js')

const fmt = (n: number) => String(+n.toFixed(3))
const px = (n: number) => `${+n.toFixed(2)}px`

/**
 * 원본 비율과 캔버스 비율로 리프레임 전략을 고른다. **원본은 자르지 않는다**: 비율이 같으면(±0.05) 그대로, 다르면 영상 전체를
 * 가운데에 두고 남는 곳(가로→세로는 위아래, 세로→가로는 양옆)을 같은 장면을 흐리게 채운다.
 * 사람을 따라 자르는 'track' 은 코드에 남아 있지만 더는 고르지 않는다(2026-10-22 사용자 결정).
 */
export function chooseReframeMode(src: { width: number; height: number }, canvas: Canvas): ReframeMode {
  const sa = src.width / src.height
  const ta = canvas.width / canvas.height
  return Math.abs(sa - ta) < 0.05 ? 'none' : 'blur-fill'
}

/** 편집 대본을 그림으로 옮긴 것. 시각은 모두 **출력(컷·훅 반영 후, 속도 적용 전) 기준** 초. */
export interface RenderScript {
  /** 영상 내내 위에 고정되는 흰 박스 제목 */
  title: string
  /** 0 ~ sec 구간에 보여 주는 핑크 큰 질문(맨 앞에 붙인 훅 장면 위) */
  hook?: { sec: number; question: string }
  /** 훅 직후 3초 안팎 보여 주는 소개 줄 */
  openingLines: { text: string; color: 'yellow' | 'cyan' | 'white' }[]
  /** 노란 소제목: start~end 동안 */
  sections: { start: number; end: number; label: string }[]
  /** 핑크 중간 질문(2.5초) */
  questions: { start: number; text: string }[]
  /** 노란 박스 리액션(2.5초) */
  reactions: { start: number; text: string }[]
  /** 자막에서 노란색으로 강조할 단어 */
  emphasis: string[]
  /** 맨 앞에 붙인 훅 장면의 길이(자막은 이 뒤부터) */
  hookSec: number
}

export interface OverlayLayout {
  /** 영상 위·아래에 흐린 배경 띠가 충분히 있어서 글자를 띠 안에 둘 수 있나 */
  band: boolean
  videoTop: number
  videoBottom: number
  /** 제목·소개·소제목·질문 묶음의 위쪽 y(px) */
  titleTop: number
  /** 묶음의 높이(px) 추정 */
  stackHeight: number
  /** 자막 글자 영역의 위쪽 y(px). null 이면 지금처럼 화면 가장자리 기준으로 둔다 */
  captionTop: number | null
  /** 리액션 박스의 위쪽 y(px) */
  reactionTop: number
}

const BAND_MIN_TOP = 260
const BAND_MIN_BOTTOM = 200

/** 글자 한 칸의 폭(em). 한글·한자는 1, 그 밖(영문·숫자·기호)은 0.6 쯤으로 어림한다. */
const emWidth = (text: string): number => Array.from(text).reduce((w, c) => w + (/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af\u4e00-\u9fff\u3040-\u30ff]/.test(c) ? 1 : 0.6), 0)

/** 문구가 한 줄에 maxWidthPx 안에 들도록 글자 크기를 줄인다(기본의 70% 아래로는 줄이지 않는다 — 그 아래는 줄바꿈). */
export function fitFontPx(text: string, basePx: number, maxWidthPx: number): number {
  const em = emWidth(text)
  if (em * basePx <= maxWidthPx) return basePx
  return Math.max(Math.round(basePx * 0.7), Math.floor(maxWidthPx / em))
}

/** 대사 단어가 강조 단어를 포함하면 강조한다(조사가 붙어도). 한 글자 강조어는 오탐이 많아 쓰지 않는다. */
export function isEmphasized(word: string, emphasis: string[]): boolean {
  const w = word.replace(/[.,!?~"'“”‘’…]/g, '')
  return emphasis.some((e) => Array.from(e).length >= 2 && w.includes(e))
}

const OV_UNIT = (c: Canvas) => Math.min(c.width, c.height)
const OV_SIZES = (c: Canvas) => {
  const u = OV_UNIT(c)
  return { title: Math.round(u * 0.042), hook: Math.round(u * 0.058), open: Math.round(u * 0.037), sec: Math.round(u * 0.05), q: Math.round(u * 0.046), react: Math.round(u * 0.052), pad: Math.round(u * 0.012) }
}

/** 영상이 놓이는 사각형과 제목·자막·리액션의 자리를 정한다. */
export function overlayLayout(reframe: ReframeMode, info: Pick<VideoInfo, 'width' | 'height'>, canvas: Canvas, captionPosition: 'top' | 'middle' | 'bottom'): OverlayLayout {
  const H = canvas.height
  const W = canvas.width
  let videoTop = 0
  let videoBottom = H
  if (reframe === 'blur-fill') {
    const srcA = info.width / info.height
    if (srcA > W / H) {
      const h = W / srcA
      videoTop = (H - h) / 2
      videoBottom = videoTop + h
    }
  }
  const band = videoTop >= BAND_MIN_TOP && H - videoBottom >= BAND_MIN_BOTTOM
  const z = OV_SIZES(canvas)
  const titleBoxH = Math.round(z.title * 1.25 + 2 * z.pad)
  const stackHeight = titleBoxH + 14 + 3 * Math.round(z.open * 1.3) + 8
  const titleTop = band ? Math.max(48, Math.min(Math.round(0.1 * H), Math.round(videoTop - stackHeight - 30))) : Math.round(0.07 * H)
  let captionTop: number | null = null
  if (captionPosition === 'top') captionTop = Math.max(Math.round(0.26 * H), titleTop + stackHeight + 30)
  else if (captionPosition === 'middle') captionTop = Math.round(H / 2 - 40)
  else if (band) captionTop = Math.round(videoBottom + 0.035 * H)
  const reactionTop = band ? Math.round(videoBottom - (videoBottom - videoTop) * 0.2) : Math.round(0.62 * H)
  return { band, videoTop: Math.round(videoTop), videoBottom: Math.round(videoBottom), titleTop, stackHeight, captionTop, reactionTop }
}

export interface BuildInput {
  workDir: string
  sourcePath: string
  info: VideoInfo
  canvas: Canvas
  /** 원본 시간 기준으로 남길 구간 */
  kept: Span[]
  /** 출력 타임라인 기준 자막 */
  cues: CaptionCue[]
  /** 출력 타임라인 기준 크롭 키프레임 (reframe === 'track') */
  crop?: CropKeyframe[]
  reframe: ReframeMode
  style: AppliedStyle
  /** 편집 대본(오버레이 층). 없으면 지금 방식(자막과 선택적 제목 카드)만 그린다 */
  script?: RenderScript
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function linkOrCopy(from: string, to: string): void {
  try {
    fs.linkSync(from, to)
  } catch {
    fs.copyFileSync(from, to)
  }
}

let fontCss: string | null = null

/** 글꼴 조각(woff2)을 프로젝트 fonts/ 에 두고, 그 @font-face 규칙(woff2 만)을 돌려준다. */
function installFonts(projectDir: string): string {
  const dest = path.join(projectDir, 'fonts')
  fs.mkdirSync(dest, { recursive: true })
  const files = path.join(FONT_PKG, 'files')
  for (const f of fs.readdirSync(files)) if (f.endsWith('-700-normal.woff2')) linkOrCopy(path.join(files, f), path.join(dest, f))
  fontCss ??= fs
    .readFileSync(path.join(FONT_PKG, '700.css'), 'utf8')
    .replace(/,\s*url\([^)]*\.woff\)\s*format\('woff'\)/g, '')
    .replaceAll('./files/', 'fonts/')
  return fontCss
}

function captionHtml(cue: CaptionCue, i: number, start: number, dur: number, highlight?: string, emphasis?: string[]): string {
  const raw = cue.text.split(' ')
  const words = raw.map(escapeHtml)
  if (emphasis) {
    // 대본이 있으면 핵심 단어만 강조하고 팝업(scale) 트윈이 움직일 수 있게 inline-block 으로 둔다
    raw.forEach((w, k) => {
      if (isEmphasized(w, emphasis)) words[k] = `<span style="color:${highlight ?? '#FFD400'}">${words[k]}</span>`
    })
    return `    <div id="cap-${i}" class="clip caption" data-start="${fmt(start)}" data-duration="${fmt(dur)}" data-track-index="2"><span class="text pop">${words.join(' ')}</span></div>`
  }
  if (highlight && words.length > 1) words[words.length - 1] = `<span style="color:${highlight}">${words.at(-1)}</span>`
  return `    <div id="cap-${i}" class="clip caption" data-start="${fmt(start)}" data-duration="${fmt(dur)}" data-track-index="2"><span class="text">${words.join(' ')}</span></div>`
}

/** 대본의 오버레이 층(제목·훅 질문·소개 줄·소제목·질문·리액션)을 HTML 과 타임라인 트윈으로 만든다. */
function overlayParts(sc: RenderScript, totalSec: number, c: Canvas, layout: OverlayLayout): { stack: string; reactions: string; js: string[]; css: string } {
  const z = OV_SIZES(c)
  const maxW = c.width * 0.88
  const titleBoxH = Math.round(z.title * 1.25 + 2 * z.pad)
  const slotB = titleBoxH + 14
  const slotC = slotB + Math.round(z.sec * 1.25) + 6
  const fs = (text: string, base: number) => fitFontPx(text, base, maxW)
  const hookSec = Math.min(sc.hookSec, totalSec)
  const stackParts: string[] = []
  const js: string[] = []
  const enter = (id: string, start: number) => js.push(`tl.fromTo("#${id} .ov", { y: -12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.22, ease: "power3.out", immediateRender: false }, ${fmt(start)});`)

  stackParts.push(`      <div id="ov-title" class="clip ovc" style="top:0" data-start="0" data-duration="${fmt(totalSec)}" data-track-index="4"><div class="ov title-box" style="font-size:${fs(sc.title, z.title)}px">${escapeHtml(sc.title)}</div></div>`)

  if (sc.hook && hookSec > 0.2) {
    stackParts.push(`      <div id="ov-hook" class="clip ovc" style="top:${slotB}px" data-start="0" data-duration="${fmt(hookSec)}" data-track-index="5"><div class="ov hook-q" style="font-size:${fs(sc.hook.question, z.hook)}px">${escapeHtml(sc.hook.question)}</div></div>`)
    enter('ov-hook', 0)
  }

  // 소개 줄: 훅 직후 3.2초(훅이 없으면 0.3초부터)
  let openEnd = sc.hook ? hookSec : 0
  if (sc.openingLines.length) {
    const start = sc.hook ? hookSec : 0.3
    const dur = Math.min(3.2, totalSec - start)
    if (dur >= 0.8) {
      const lines = sc.openingLines.map((l) => `<div class="ol ${l.color[0]}" style="font-size:${fs(l.text, z.open)}px">${escapeHtml(l.text)}</div>`).join('')
      stackParts.push(`      <div id="ov-open" class="clip ovc" style="top:${slotB}px" data-start="${fmt(start)}" data-duration="${fmt(dur)}" data-track-index="5"><div class="ov open">${lines}</div></div>`)
      enter('ov-open', start)
      openEnd = start + dur
    }
  }

  // 소제목: 소개 줄과 겹치지 않게 소개가 끝난 뒤로 민다(다 겹쳐 사라지면 뺀다)
  let n = 0
  for (const s of sc.sections) {
    const start = Math.max(s.start, openEnd)
    const end = Math.min(s.end, totalSec)
    if (end - start < 0.4) continue
    stackParts.push(`      <div id="ov-sec-${n}" class="clip ovc" style="top:${slotB}px" data-start="${fmt(start)}" data-duration="${fmt(end - start)}" data-track-index="5"><div class="ov sec" style="font-size:${fs(s.label, z.sec)}px">${escapeHtml(s.label)}</div></div>`)
    enter(`ov-sec-${n}`, start)
    n++
  }
  n = 0
  let lastQEnd = 0 // 같은 자리에 뜨는 질문끼리는 앞의 것이 끝난 뒤로 민다
  for (const q of sc.questions) {
    const start = Math.max(q.start, openEnd, lastQEnd)
    const dur = Math.min(2.5, totalSec - start)
    if (dur < 0.8) continue
    lastQEnd = start + dur
    stackParts.push(`      <div id="ov-q-${n}" class="clip ovc" style="top:${slotC}px" data-start="${fmt(start)}" data-duration="${fmt(dur)}" data-track-index="6"><div class="ov q" style="font-size:${fs(q.text, z.q)}px">${escapeHtml(q.text)}</div></div>`)
    enter(`ov-q-${n}`, start)
    n++
  }

  const reactionParts: string[] = []
  n = 0
  let lastREnd = 0
  for (const r of sc.reactions) {
    const start = Math.max(r.start, lastREnd)
    const dur = Math.min(2.5, totalSec - start)
    if (dur < 0.8) continue
    lastREnd = start + dur
    reactionParts.push(`    <div id="ov-r-${n}" class="clip ovr" data-start="${fmt(start)}" data-duration="${fmt(dur)}" data-track-index="7"><div class="ov react" style="font-size:${fs(r.text, z.react)}px">${escapeHtml(r.text)}</div></div>`)
    js.push(`tl.fromTo("#ov-r-${n} .ov", { scale: 0.8, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.2, ease: "back.out(1.7)", immediateRender: false }, ${fmt(start)});`)
    n++
  }

  const stroke = Math.max(4, Math.round(z.hook / 9))
  const css = `
      #ov-stack { position: absolute; left: 0; right: 0; top: ${layout.titleTop}px; height: ${layout.stackHeight}px; pointer-events: none; }
      .ovc { position: absolute; left: 0; right: 0; display: flex; justify-content: center; }
      .ovr { position: absolute; left: 0; right: 0; top: ${layout.reactionTop}px; display: flex; justify-content: center; pointer-events: none; }
      .ov { font-family: 'Noto Sans KR', sans-serif; font-weight: 700; line-height: 1.25; text-align: center; word-break: keep-all; max-width: 88%; }
      .title-box { background: #ffffff; color: #111111; border-radius: ${Math.round(z.title * 0.16)}px; padding: ${z.pad}px ${Math.round(z.title * 0.6)}px; }
      .hook-q, .q { color: #ff5ca8; -webkit-text-stroke: ${stroke}px rgba(0,0,0,0.85); paint-order: stroke fill; text-shadow: 0 4px 14px rgba(0,0,0,0.5); }
      .sec { color: #ffd400; -webkit-text-stroke: ${stroke}px rgba(0,0,0,0.85); paint-order: stroke fill; text-shadow: 0 4px 14px rgba(0,0,0,0.5); }
      .ol { -webkit-text-stroke: ${Math.max(3, Math.round(z.open / 10))}px rgba(0,0,0,0.85); paint-order: stroke fill; text-shadow: 0 3px 10px rgba(0,0,0,0.5); }
      .ol.y { color: #ffd400; } .ol.c { color: #4dd8ff; } .ol.w { color: #ffffff; }
      .react { background: #ffd400; color: #111111; border-radius: ${Math.round(z.react * 0.2)}px; padding: ${Math.round(z.react * 0.22)}px ${Math.round(z.react * 0.55)}px; }
      .pop { display: inline-block; transform-origin: 50% 50%; }`
  return { stack: `    <div id="ov-stack">\n${stackParts.join('\n')}\n    </div>`, reactions: reactionParts.join('\n'), js, css }
}

export async function buildProject(i: BuildInput): Promise<{ projectDir: string; durationSec: number }> {
  const { canvas: c, info, style } = i
  const projectDir = path.join(i.workDir, 'project')
  fs.rmSync(projectDir, { recursive: true, force: true })
  fs.mkdirSync(path.join(projectDir, 'lib'), { recursive: true })
  linkOrCopy(i.sourcePath, path.join(projectDir, 'source.mp4'))
  fs.copyFileSync(GSAP, path.join(projectDir, 'lib/gsap.min.js'))
  const fontFaces = installFonts(projectDir)

  const totalSec = i.kept.reduce((s, k) => s + (k.end - k.start), 0)
  const portrait = c.height > c.width

  // 영상 요소들: 남은 구간마다 하나(blur-fill 은 배경 + 앞 영상 두 개)
  const audioAttr = info.hasAudio ? 'data-has-audio="true"' : 'muted'
  const scaledW = c.height * (info.width / info.height) // track: 높이를 캔버스에 맞춘 영상 폭
  const fgStyle =
    i.reframe === 'track'
      ? `position:absolute;left:0;top:0;width:${px(scaledW)};height:${px(c.height)}`
      : i.reframe === 'blur-fill'
        ? 'position:absolute;inset:0;width:100%;height:100%;object-fit: contain'
        : 'position:absolute;inset:0;width:100%;height:100%;object-fit: cover'
  const bgStyle = 'position:absolute;left:-10%;top:-10%;width:120%;height:120%;object-fit: cover;filter: blur(40px)'

  const videos: string[] = []
  const segStarts: number[] = []
  let outStart = 0
  i.kept.forEach((k, n) => {
    const len = k.end - k.start
    segStarts.push(outStart)
    const timing = `data-start="${fmt(outStart)}" data-duration="${fmt(len)}" data-media-start="${fmt(k.start)}"`
    if (i.reframe === 'blur-fill') {
      videos.push(`      <video id="seg-${n}-bg" src="source.mp4" ${timing} data-track-index="0" playsinline muted style="${bgStyle}"></video>`)
      videos.push(`      <video id="seg-${n}" src="source.mp4" ${timing} data-track-index="1" playsinline ${audioAttr} style="${fgStyle}"></video>`)
    } else {
      videos.push(`      <video id="seg-${n}" src="source.mp4" ${timing} data-track-index="0" playsinline ${audioAttr} style="${fgStyle}"></video>`)
    }
    outStart += len
  })

  // 자막: 영상 길이 안으로 자르고 너무 짧은 것은 버린다
  const captions: string[] = []
  i.cues.forEach((cue, n) => {
    const start = Math.max(0, cue.start)
    const end = Math.min(totalSec, cue.end)
    if (end - start >= 0.05) captions.push(captionHtml(cue, n, start, end - start, style.captions.highlightColor, i.script?.emphasis))
  })
  const capIds = captions.map((c) => c.match(/id="cap-(\d+)"/)![1]!)

  // 대본이 있으면 옛 제목 카드는 그리지 않는다(대본의 제목·훅 질문이 그 역할을 한다)
  const hook = style.hookTitle && !i.script
    ? `    <div id="hook" class="clip hook" data-start="0" data-duration="${fmt(Math.min(style.hookTitle.durationSec, totalSec))}" data-track-index="3"><div class="hook-box">${escapeHtml(style.hookTitle.text)}</div></div>`
    : ''

  // 타임라인: 크롭 이동, 컷마다 펀치 줌, 제목 카드 등장
  const js: string[] = ['const tl = gsap.timeline({ paused: true });']
  if (i.reframe === 'track') {
    const kf = [...(i.crop?.length ? i.crop : [{ t: 0, centerX: 0.5 }])].sort((a, b) => a.t - b.t)
    const xOf = (cx: number) => +(c.width / 2 - cx * scaledW).toFixed(2)
    js.push(`tl.set("#inner", { x: ${xOf(kf[0]!.centerX)} }, 0);`)
    for (let k = 0; k < kf.length - 1; k++) {
      const a = kf[k]!
      const b = kf[k + 1]!
      const dur = b.t - a.t
      if (dur < 1e-6 || xOf(a.centerX) === xOf(b.centerX)) continue
      js.push(`tl.fromTo("#inner", { x: ${xOf(a.centerX)} }, { x: ${xOf(b.centerX)}, duration: ${fmt(dur)}, ease: "none", immediateRender: false }, ${fmt(a.t)});`)
    }
  }
  if (style.transition === 'punch-zoom') {
    for (const t of segStarts.slice(1)) {
      js.push(`tl.fromTo("#punch", { scale: 1.06 }, { scale: 1, duration: 0.18, ease: "power2.out", immediateRender: false }, ${fmt(t)});`)
    }
  }
  if (style.hookTitle && !i.script) js.push('tl.from("#hook .hook-box", { y: -30, opacity: 0, duration: 0.35, ease: "power3.out" }, 0.1);')
  const layout = i.script ? overlayLayout(i.reframe, info, c, style.captions.position) : null
  const ov = i.script && layout ? overlayParts(i.script, totalSec, c, layout) : null
  if (ov) {
    // 자막 팝업: 큐마다 톡 튀어나온다(타이밍이 걸린 클립이 아니라 안쪽 글자를 움직인다)
    for (const id of capIds) {
      const start = Number(captions.find((x) => x.includes(`id="cap-${id}"`))!.match(/data-start="([^"]*)"/)![1])
      js.push(`tl.fromTo("#cap-${id} .text", { scale: 0.85, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.18, ease: "back.out(1.6)", immediateRender: false }, ${fmt(start)});`)
    }
    js.push(...ov.js)
  }
  js.push('window.__timelines["main"] = tl;')

  const cap = style.captions
  const align = cap.position === 'top' ? 'flex-start' : cap.position === 'middle' ? 'center' : 'flex-end'
  const edgePad = Math.round(c.height * (portrait ? 0.17 : 0.09))
  const capPad = cap.position === 'middle' ? '' : `padding-${cap.position === 'top' ? 'top' : 'bottom'}:${edgePad}px;`
  // 대본이 있으면 자막 위치를 영상 사각형·제목 묶음에 맞춰 위에서부터 잡는다(위·아래 띠 안, 또는 제목 묶음 아래)
  const capRule = layout && layout.captionTop !== null
    ? `.caption { position: absolute; inset: 0; display: flex; justify-content: center; align-items: flex-start; padding-top: ${layout.captionTop}px; padding-left: 6%; padding-right: 6%; pointer-events: none; }`
    : `.caption { position: absolute; inset: 0; display: flex; justify-content: center; align-items: ${align}; ${capPad} padding-left: 6%; padding-right: 6%; pointer-events: none; }`
  const hookSize = Math.round(cap.sizePx * 0.9)

  const html = `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${c.width}, height=${c.height}" />
    <title>video-autoeditor</title>
    <script src="lib/gsap.min.js"></script>
    <style>
${fontFaces}
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { margin: 0; width: ${c.width}px; height: ${c.height}px; overflow: hidden; background: #000; }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden; }
      #punch, #inner { position: absolute; inset: 0; transform-origin: 50% 50%; }
      ${capRule}
      .caption .text { font-family: 'Noto Sans KR', sans-serif; font-weight: 700; font-size: ${cap.sizePx}px; line-height: 1.25; text-align: center; color: ${cap.color}; word-break: keep-all; -webkit-text-stroke: ${Math.max(4, Math.round(cap.sizePx / 10))}px rgba(0,0,0,0.85); paint-order: stroke fill; text-shadow: 0 4px 14px rgba(0,0,0,0.6); }
      .hook { position: absolute; inset: 0; display: flex; justify-content: center; align-items: flex-start; padding-top: ${Math.round(c.height * (portrait ? 0.1 : 0.08))}px; pointer-events: none; }
      ${ov ? ov.css : ''}
      .hook-box { font-family: 'Noto Sans KR', sans-serif; font-weight: 700; font-size: ${hookSize}px; line-height: 1.2; color: #fff; background: rgba(0,0,0,0.62); padding: 0.35em 0.7em; border-radius: 0.3em; text-align: center; word-break: keep-all; max-width: 88%; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-width="${c.width}" data-height="${c.height}" data-duration="${fmt(totalSec)}">
    <div id="punch"><div id="inner">
${videos.join('\n')}
    </div></div>
${captions.join('\n')}
${ov ? `${ov.stack}\n${ov.reactions}\n` : ''}${hook}
    </div>
    <script>
      ${js.join('\n      ')}
    </script>
  </body>
</html>
`
  fs.writeFileSync(path.join(projectDir, 'index.html'), html)
  return { projectDir, durationSec: +totalSec.toFixed(3) }
}

export async function renderProject(
  projectDir: string,
  o: { outPath: string; quality?: 'draft' | 'looks' | 'delivery'; workers?: number },
): Promise<{ outPath: string; wallSec: number }> {
  fs.mkdirSync(path.dirname(o.outPath), { recursive: true })
  const t0 = Date.now()
  await run('hyperframes', ['render', '.', '--quality', o.quality ?? 'looks', '--workers', String(o.workers ?? 2), '--quiet', '-o', o.outPath], {
    cwd: projectDir,
    timeoutMs: 60 * 60_000,
  })
  return { outPath: o.outPath, wallSec: (Date.now() - t0) / 1000 }
}
