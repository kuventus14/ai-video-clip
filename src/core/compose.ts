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

/** 원본 비율과 캔버스 비율로 리프레임 전략을 고른다. */
export function chooseReframeMode(src: { width: number; height: number }, canvas: Canvas): ReframeMode {
  const sa = src.width / src.height
  const ta = canvas.width / canvas.height
  if (Math.abs(sa - ta) < 0.05) return 'none'
  return sa > ta ? 'track' : 'blur-fill'
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

function captionHtml(cue: CaptionCue, i: number, start: number, dur: number, highlight?: string): string {
  const words = cue.text.split(' ').map(escapeHtml)
  if (highlight && words.length > 1) words[words.length - 1] = `<span style="color:${highlight}">${words.at(-1)}</span>`
  return `    <div id="cap-${i}" class="clip caption" data-start="${fmt(start)}" data-duration="${fmt(dur)}" data-track-index="2"><span class="text">${words.join(' ')}</span></div>`
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
    if (end - start >= 0.05) captions.push(captionHtml(cue, n, start, end - start, style.captions.highlightColor))
  })

  const hook = style.hookTitle
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
  if (style.hookTitle) js.push('tl.from("#hook .hook-box", { y: -30, opacity: 0, duration: 0.35, ease: "power3.out" }, 0.1);')
  js.push('window.__timelines["main"] = tl;')

  const cap = style.captions
  const align = cap.position === 'top' ? 'flex-start' : cap.position === 'middle' ? 'center' : 'flex-end'
  const edgePad = Math.round(c.height * (portrait ? 0.17 : 0.09))
  const capPad = cap.position === 'middle' ? '' : `padding-${cap.position === 'top' ? 'top' : 'bottom'}:${edgePad}px;`
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
      .caption { position: absolute; inset: 0; display: flex; justify-content: center; align-items: ${align}; ${capPad} padding-left: 6%; padding-right: 6%; pointer-events: none; }
      .caption .text { font-family: 'Noto Sans KR', sans-serif; font-weight: 700; font-size: ${cap.sizePx}px; line-height: 1.25; text-align: center; color: ${cap.color}; word-break: keep-all; -webkit-text-stroke: ${Math.max(4, Math.round(cap.sizePx / 10))}px rgba(0,0,0,0.85); paint-order: stroke fill; text-shadow: 0 4px 14px rgba(0,0,0,0.6); }
      .hook { position: absolute; inset: 0; display: flex; justify-content: center; align-items: flex-start; padding-top: ${Math.round(c.height * (portrait ? 0.1 : 0.08))}px; pointer-events: none; }
      .hook-box { font-family: 'Noto Sans KR', sans-serif; font-weight: 700; font-size: ${hookSize}px; line-height: 1.2; color: #fff; background: rgba(0,0,0,0.62); padding: 0.35em 0.7em; border-radius: 0.3em; text-align: center; word-break: keep-all; max-width: 88%; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-width="${c.width}" data-height="${c.height}" data-duration="${fmt(totalSec)}">
    <div id="punch"><div id="inner">
${videos.join('\n')}
    </div></div>
${captions.join('\n')}
${hook}
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
