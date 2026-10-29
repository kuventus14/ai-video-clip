import fs from 'node:fs'
import path from 'node:path'
import type { Canvas, VideoInfo } from './types.ts'

const ROOT = path.resolve(import.meta.dirname, '../..')
/** 채널 띠 설정 파일. 사용자가 채널명을 바꾸거나 띠를 끄려면 이 파일만 고치면 된다 */
export const BRAND_FILE = path.join(ROOT, 'assets/brand/brand.json')
const FONT_PKGS = [
  { pkg: path.join(ROOT, 'node_modules/@fontsource/black-han-sans'), css: '400.css' },
  { pkg: path.join(ROOT, 'node_modules/@fontsource/anton'), css: '400.css' },
]

/**
 * 릴스 기본 띠(시안 1 "스트로크 샤인", 2026-10-29 사용자 결정): 검은 위·아래 띠, 위에는 영상 제목, 아래에는 채널명.
 * 흰 글자에 빨간 테두리를 두르고 글자가 하나씩 튀어나온 뒤 회색 빛이 계속 지나간다.
 */
export interface BrandBand {
  /** 아래 띠 위쪽의 빨간 이름표(한글 채널명) */
  channelKo: string
  /** 아래 띠의 큰 영문 채널명 */
  channelEn: string
  /** 테두리·이름표 색 */
  accent: string
}

interface BrandFile extends Partial<BrandBand> {
  enabled?: boolean
  /** 띠를 입힐 용도. 기본은 세로(릴스·숏츠)만 */
  purposes?: ('short' | 'post')[]
}

/** 설정 파일을 읽어 이번 용도에 띠를 입힐지 정한다. 파일이 없거나 꺼져 있거나 채널명이 비면 undefined(띠 없이 지금처럼). */
export function loadBrandBand(purpose: 'short' | 'post', file = BRAND_FILE): BrandBand | undefined {
  let cfg: BrandFile
  try {
    cfg = JSON.parse(fs.readFileSync(file, 'utf8')) as BrandFile
  } catch {
    return undefined
  }
  if (cfg.enabled === false) return undefined
  if (!(cfg.purposes ?? ['short']).includes(purpose)) return undefined
  const channelKo = (cfg.channelKo ?? '').trim()
  const channelEn = (cfg.channelEn ?? '').trim()
  if (!channelKo && !channelEn) return undefined
  return { channelKo, channelEn, accent: cfg.accent ?? '#e3262f' }
}

export interface BrandLayout {
  videoTop: number
  videoBottom: number
  /** 제목 글자 한 줄의 위쪽 y */
  titleTop: number
  /** 아래 띠 묶음(이름표 + 영문 채널명)의 위쪽 y */
  channelTop: number
  /** 영상 안쪽 위(훅 질문·소개 줄·소제목 묶음이 놓일 자리) */
  stackTop: number
  /** 영상 안쪽 아래(자막 두 줄이 들어갈 자리의 위쪽 y) */
  captionTop: number
  /** 기준 화면(1080x1920) 대비 배율 */
  scale: number
}

/** 띠 사이에 영상을 둘 최대 높이(1920 기준). 이보다 긴 영상(세로 원본 등)은 가운데를 기준으로 위아래를 잘라 이 높이에 맞춘다 */
const MAX_VIDEO_H = 800

/**
 * 영상은 화면 폭을 다 쓰고 가운데에 놓는다. 가로 영상은 자르지 않고(16:9 → 608px), 그보다 세로로 긴 영상은 800px 로 잘라 띠를 남긴다.
 */
export function brandLayout(info: Pick<VideoInfo, 'width' | 'height'>, canvas: Canvas): BrandLayout {
  const s = canvas.height / 1920
  const h = Math.round(Math.min(MAX_VIDEO_H * s, canvas.width / (info.width / info.height)))
  const videoTop = Math.round((canvas.height - h) / 2)
  const videoBottom = videoTop + h
  return {
    videoTop,
    videoBottom,
    titleTop: Math.round(videoTop - 190 * s),
    channelTop: Math.round(videoBottom + 44 * s),
    stackTop: Math.round(videoTop + 24 * s),
    captionTop: Math.round(videoBottom - 0.085 * canvas.height - 28 * s),
    scale: s,
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** 테두리·글자·빛 세 층을 일부러 겹쳐 그린다 — hyperframes check 의 겹침·가림 검사에서 뺀다 */
const ALLOW = 'data-layout-allow-overlap data-layout-allow-occlusion'

/** 글자 하나하나를 span 으로 나눈다(하나씩 튀어나오게). 띄어쓰기도 자리를 지키게 둔다 */
const chars = (text: string) => Array.from(text).map((c) => `<span class="bb-ch" ${ALLOW}>${escapeHtml(c)}</span>`).join('')

/** 한 줄에 maxW 안에 들도록 글자 크기를 줄인다. 한글 1em, 그 밖 0.62em, 띄어쓰기 0.3em 으로 어림한다 */
export function fitBandFont(text: string, basePx: number, maxW: number): number {
  const em = Array.from(text).reduce((w, c) => w + (c === ' ' ? 0.3 : c.charCodeAt(0) < 128 ? 0.62 : 1), 0)
  return em * basePx > maxW ? Math.floor(maxW / em) : basePx
}

/** 띠 글꼴(Black Han Sans·Anton)을 프로젝트 fonts/ 에 두고 @font-face 규칙(woff2 만)을 돌려준다 */
export function installBrandFonts(projectDir: string): string {
  const dest = path.join(projectDir, 'fonts')
  fs.mkdirSync(dest, { recursive: true })
  const rules: string[] = []
  for (const f of FONT_PKGS) {
    const files = path.join(f.pkg, 'files')
    for (const name of fs.readdirSync(files)) if (name.endsWith('-400-normal.woff2')) fs.copyFileSync(path.join(files, name), path.join(dest, name))
    rules.push(
      fs
        .readFileSync(path.join(f.pkg, f.css), 'utf8')
        .replace(/,\s*url\([^)]*\.woff\)\s*format\('woff'\)/g, '')
        .replaceAll('font-display: swap', 'font-display: block')
        .replaceAll('./files/', 'fonts/'),
    )
  }
  return rules.join('\n')
}

/** 위 띠(제목)·아래 띠(채널명)의 HTML·CSS·타임라인 트윈 */
export function brandParts(o: { title: string; brand: BrandBand; totalSec: number; canvas: Canvas; layout: BrandLayout }): { html: string; css: string; js: string[] } {
  const { brand, layout: l, canvas: c, totalSec } = o
  const s = l.scale
  const fmt = (n: number) => String(+n.toFixed(3))
  const titlePx = fitBandFont(o.title, Math.round(124 * s), c.width - 120 * s)
  const enPx = fitBandFont(brand.channelEn, Math.round(128 * s), c.width - 90 * s)
  const stroke = Math.round(22 * s)
  const shine = 'linear-gradient(105deg, transparent 0%, transparent 42%, rgba(150,150,150,.95) 48%, rgba(150,150,150,.95) 52%, transparent 58%, transparent 100%)'
  const tagH = brand.channelKo ? Math.round(94 * s) : 0

  const layers = (id: string, text: string) =>
    ['s', 'f', 'sh'].map((k) => `<div class="bb-l bb-${k}" ${ALLOW}>${k === 'sh' ? escapeHtml(text) : chars(text)}</div>`).join('')
  const html = [
    `    <div id="bb-top" class="bb-band" style="top:0;height:${l.videoTop}px"></div>`,
    `    <div id="bb-bot" class="bb-band" style="top:${l.videoBottom}px;height:${c.height - l.videoBottom}px"></div>`,
    o.title ? `    <div id="bb-title" class="bb-text" ${ALLOW} style="top:${l.titleTop}px;font-size:${titlePx}px;font-family:'Black Han Sans',sans-serif;letter-spacing:-0.02em">${layers('bb-title', o.title)}</div>` : '',
    brand.channelKo ? `    <div id="bb-tag" style="top:${l.channelTop}px"><span>${escapeHtml(brand.channelKo)}</span></div>` : '',
    brand.channelEn ? `    <div id="bb-ch" class="bb-text" ${ALLOW} style="top:${l.channelTop + tagH}px;font-size:${enPx}px;font-family:'Anton',sans-serif;letter-spacing:0.02em">${layers('bb-ch', brand.channelEn)}</div>` : '',
  ].filter(Boolean).join('\n')

  const css = `
      .bb-band { position: absolute; left: 0; right: 0; background: #000; }
      .bb-text { position: absolute; left: 0; right: 0; height: 1.15em; line-height: 1.1; white-space: nowrap; pointer-events: none; }
      .bb-l { position: absolute; left: 0; right: 0; top: 0; text-align: center; }
      .bb-s { color: ${brand.accent}; -webkit-text-stroke: ${stroke}px ${brand.accent}; }
      .bb-f { color: #ffffff; }
      .bb-sh { color: transparent; background: ${shine}; background-size: 260% 100%; background-position: 130% 0; -webkit-background-clip: text; background-clip: text; opacity: 0; }
      .bb-ch { display: inline-block; white-space: pre; }
      #bb-tag { position: absolute; left: 0; right: 0; display: flex; justify-content: center; pointer-events: none; }
      #bb-tag span { background: ${brand.accent}; color: #fff; font-family: 'Black Han Sans', sans-serif; font-size: ${Math.round(60 * s)}px; line-height: 1; padding: ${Math.round(18 * s)}px ${Math.round(34 * s)}px ${Math.round(16 * s)}px; border-radius: ${Math.round(12 * s)}px; letter-spacing: 0.04em; }`

  // 등장(0.1~1.2초) 뒤에는 빛이 1.5초마다 지나간다 — 영상 길이만큼 반복 횟수를 정해 끝없이 돌지 않게 한다
  const sweep = (sel: string, from: number) => {
    const n = Math.floor((totalSec - from) / 1.5)
    return n >= 1
      ? `tl.fromTo("${sel}", { backgroundPosition: "130% 0" }, { backgroundPosition: "-30% 0", duration: 1.1, ease: "power1.inOut", repeat: ${n - 1}, repeatDelay: 0.4, immediateRender: false }, ${fmt(from)});`
      : ''
  }
  const js: string[] = []
  if (o.title) {
    js.push(`tl.from("#bb-title .bb-s .bb-ch, #bb-title .bb-f .bb-ch", { scale: 0, opacity: 0, duration: 0.45, ease: "back.out(2.2)", stagger: { each: 0.05, grid: [2, ${Array.from(o.title).length}], axis: "x" } }, 0.1);`)
    js.push(`tl.set("#bb-title .bb-sh", { opacity: 1 }, 0.95);`, sweep('#bb-title .bb-sh', 1.0))
  }
  if (brand.channelKo) js.push(`tl.from("#bb-tag span", { y: ${Math.round(-40 * s)}, opacity: 0, duration: 0.4, ease: "power3.out" }, 0.35);`)
  if (brand.channelEn) {
    js.push(`tl.from("#bb-ch .bb-s .bb-ch, #bb-ch .bb-f .bb-ch", { y: ${Math.round(80 * s)}, opacity: 0, duration: 0.45, ease: "back.out(1.8)", stagger: { each: 0.035, grid: [2, ${Array.from(brand.channelEn).length}], axis: "x" } }, 0.45);`)
    js.push(`tl.set("#bb-ch .bb-sh", { opacity: 1 }, 1.25);`, sweep('#bb-ch .bb-sh', 1.6))
  }
  return { html, css, js: js.filter(Boolean) }
}
