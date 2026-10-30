import fs from 'node:fs'
import path from 'node:path'
import { askClaude, extractJson, LlmError } from './llm.ts'
import { extractFrames } from './media.ts'
import { normalizeScript, SCRIPT_LIMITS, type EditScript } from './script.ts'
import type { StyleSpec } from './styleSpec.ts'
import type { Transcript, VideoInfo } from './types.ts'
import type { VideoSummary } from './understand.ts'

/** AI 에게 한 번에 보여 주는 사진 수의 상한(내 영상 + 레퍼런스) */
export const MAX_DIRECTOR_IMAGES = 28
const MAX_REF_IMAGES = 16
const TRANSCRIPT_CHARS = 6000

const f1 = (n: number) => n.toFixed(1)

export interface DirectInput {
  info: VideoInfo
  transcript: Transcript
  summary: VideoSummary
  sourcePath: string
  /** 레퍼런스 스타일 분석(없으면 기본 스타일로 짠다) */
  spec?: StyleSpec
  /** 레퍼런스 장면 사진(JPEG) — 원본 영상이 아니다 */
  refFrames?: string[]
  /** 작업 폴더(내 영상 사진을 임시로 둔다) */
  workDir: string
  /** 사용자가 자막에서 뺀 구간(말은 있다) — 훅·덜어내기로 고르지 않게 알려 준다 */
  deletedSpans?: { start: number; end: number }[]
  /** 결과 영상 길이 상한(릴스·숏츠는 60초). 원본이 더 길면 핵심만 남기게 하고, 짧으면 길이를 그대로 둔다 */
  maxOutputSec?: number
}

/** 내 영상에서 사진을 뽑을 시각: 영상 전체에서 고르게(0.1초 단위). */
export function planFrameTimes(durationSec: number, count: number): number[] {
  return Array.from({ length: count }, (_, k) => Math.round(((k + 0.5) / count) * durationSec * 10) / 10)
}

function sourceFrameCount(durationSec: number, refCount: number): number {
  const wanted = Math.max(4, Math.min(12, Math.ceil(durationSec / 4)))
  return Math.min(wanted, MAX_DIRECTOR_IMAGES - Math.min(refCount, MAX_REF_IMAGES))
}

/** 사용자가 자막에서 뺀 구간: 대본에는 빈 곳으로 보이지만 말이 있는 곳이라 감독이 쉬는 구간으로 착각하지 않게 알린다 */
function deletedBlock(spans?: { start: number; end: number }[]): string {
  if (!spans?.length) return ''
  return `\n\n사용자가 자막에서 뺀 구간(위 대본에서 빠져 있지만 말은 있는 곳입니다): ${spans.map((s) => `[${f1(s.start)}~${f1(s.end)}초]`).join(' ')} — 이 구간을 hook 으로 고르거나 drop 으로 덜어내지 마세요.`
}

function transcriptBlock(t: Transcript): string {
  if (!t.hasSpeech || !t.segments.length) return '음성 없음 — 화면만 보고 판단하세요. 말이 없으니 emphasis 는 비워 두세요.'
  const lines = t.segments.map((s) => `[${f1(s.start)}~${f1(s.end)}초] ${s.text.trim()}`)
  let out = ''
  for (const l of lines) {
    if (out.length + l.length > TRANSCRIPT_CHARS) return `${out}\n(이하 생략)`
    out += (out ? '\n' : '') + l
  }
  return out
}

function referenceBlock(refCount: number, firstRefImage: number, spec?: StyleSpec): string {
  if (!refCount && !spec) return '레퍼런스 없음 — 위 규칙으로 한국어 릴스에서 흔히 통하는 기본 스타일로 짜세요.'
  const s = spec
  const style = s
    ? [
        `- 훅: ${s.hook.description || '(설명 없음)'} (첫 ${s.hook.endSec}초)`,
        `- 자막: 위치 ${s.captions.position}, 크기 ${s.captions.size}, 글자색 ${s.captions.color}${s.captions.highlightColor ? `, 강조색 ${s.captions.highlightColor}` : ''}`,
        `- 첫머리 제목 카드: ${s.hookTitle.present ? `있음${s.hookTitle.text ? `("${s.hookTitle.text}")` : ''}` : '없음'}`,
        `- 전환: ${s.transitions.dominant}, 컷 ${Math.round(s.pacing.cutsPerMinute)}회/분`,
        s.structure.length ? `- 구성 흐름: ${s.structure.join(' → ')}` : '',
      ].filter(Boolean).join('\n')
    : ''
  return [
    refCount
      ? `레퍼런스 영상(이미지 ${firstRefImage}~${firstRefImage + refCount - 1}, 앞 6장은 첫 5초 안을 촘촘히)을 보고 **편집 방식**을 따라 하세요: 훅을 여는 방식, 고정 제목 박스가 있는지, 소제목·질문·리액션을 어떻게 연출하는지, 템포.`
      : '레퍼런스 장면 사진은 없지만 레퍼런스에서 측정한 스타일 요약이 있습니다. 아래 요약을 보고 **편집 방식**을 따라 하세요: 훅을 여는 방식, 고정 제목 박스가 있는지, 템포.',
    '레퍼런스의 문구·내용·제목을 베끼지 마세요. 연출 방식만 가져오고, 문구는 내 영상의 내용으로 새로 쓰세요.',
    style ? `레퍼런스 스타일 요약(측정 결과):\n${style}` : '',
  ].filter(Boolean).join('\n')
}

/** 편집 감독에게 보내는 지시문. 순수 함수 — 시험이 내용을 확인한다. */
/** 9번 규칙(drop): 길이 상한이 없으면 군더더기만, 원본이 상한보다 길면 핵심 요약, 상한 안이면 비워 둔다 */
function dropRule(dur: number, maxOutputSec?: number): string {
  const L = SCRIPT_LIMITS
  if (maxOutputSec === undefined) return `9. **drop**: 군더더기·반복·딴소리인 약한 구간(원본 시각 start~end). 합계는 전체 길이의 ${Math.round(L.dropMaxFraction * 100)}% 이하. 중요한 설명은 빼지 않습니다.`
  if (dur <= maxOutputSec) return `9. **drop**: 이 영상은 ${f1(dur)}초로 ${maxOutputSec}초 이하라 **길이를 그대로 둡니다** — drop 은 빈 배열([])로 두세요.`
  const keep = Math.max(maxOutputSec / 2, maxOutputSec - L.hookMaxSec - 6)
  return [
    `9. **drop (가장 중요)**: 이 영상은 ${f1(dur)}초인데 결과는 **반드시 ${maxOutputSec}초 이하**여야 합니다. 영상 전체를 요약하듯 **핵심만 남기고** 나머지를 drop 으로 빼세요.`,
    `   - 남기는 부분(전체 − drop 합계)이 **${Math.round(keep)}초 안팎**이 되게 하세요(훅 장면이 앞에 붙고, 말 사이 쉼은 따로 잘립니다). 대략 ${Math.round(dur - keep)}초를 빼야 합니다.`,
    '   - 남길 것: 핵심 설명(무엇을·왜·어떻게), 핵심 시범 동작, 결과 장면. 뺄 것: 인사·자기소개·반복 설명·준비 동작·딴소리·마무리 인사.',
    '   - 문장 중간을 자르지 말고 대본의 문장 경계(앞뒤 시각)에서 자르세요. 남은 부분만 이어 봐도 말이 자연스럽게 이어져야 합니다.',
    '   - sections·questions·reactions·hook 은 **남기는 부분 안의 시각**에 두세요.',
  ].join('\n')
}

export function buildDirectorPrompt(i: { info: VideoInfo; transcript: Transcript; summary: VideoSummary; spec?: StyleSpec; refCount: number; frameTimes: number[]; deletedSpans?: { start: number; end: number }[]; maxOutputSec?: number }): string {
  const dur = i.info.durationSec
  const L = SCRIPT_LIMITS
  const n = i.frameTimes.length
  const photoList = i.frameTimes.map((t, k) => `이미지 ${k + 1} = ${f1(t)}초`).join(', ')
  return [
    '당신은 한국어 숏폼(릴스·숏츠) 전문 편집 감독입니다. 사람이 직접 편집한 것처럼 구성이 있는 영상으로 만들 **편집 대본**을 JSON 하나로 짜 주세요. 자막만 입히는 단순 편집이 아니라, 시청자가 끝까지 보게 만드는 구성(훅 → 흐름 → 결과)을 새로 짭니다.',
    '',
    `## 내 영상\n- 길이 ${f1(dur)}초, ${i.info.width}x${i.info.height}\n- 주제: ${i.summary.topic} / 장르: ${i.summary.genre} / 한 줄 요약: ${i.summary.oneLine}\n- 내 영상 사진: ${photoList} (이미지 1~${n})`,
    '',
    `## 음성 대본 (원본 영상 기준 시각)\n${transcriptBlock(i.transcript)}${deletedBlock(i.deletedSpans)}`,
    '',
    `## 레퍼런스\n${referenceBlock(i.refCount, n + 1, i.spec)}`,
    '',
    '## 만드는 규칙',
    `1. **hook**: 영상에서 결과·장면이 가장 인상적인 순간(예: 풀스윙, 공이 날아가는 결과, 가장 극적인 리액션)을 골라 **맨 앞에 먼저 보여 줄 ${L.hookMinSec}~${L.hookMaxSec}초 구간**(sourceStart~sourceEnd, 원본 시각)을 정합니다. 그 장면 위에 시청자의 호기심을 건드리는 큰 질문 한 줄(question, ${L.question}자 이하, 물음표로 끝)을 띄웁니다. 영상의 맨 앞 ${L.hookMaxSec}초는 고르지 마세요(본편이 어차피 거기서 시작합니다). 인상적인 장면이 없으면 hook 을 생략하세요.`,
    `2. **title**: 영상 내내 위에 고정되는 제목 박스 문구(${L.title}자 이하). 예: "프로님의 롱아이언 꿀팁" 같은 형식 — 내용은 내 영상에 맞게.`,
    `3. **openingLines**: 훅 직후 3초쯤 보여 줄 소개 줄 0~${L.maxOpening}개(각 ${L.opening}자 이하). 첫 줄은 주제, 둘째는 호기심, 셋째는 기대되는 결과.`,
    `4. **sections**: 영상 흐름을 3~${L.maxSections}단계로 나눠 각 시작 시각(atSec)과 짧은 소제목(label, ${L.section}자 이하)을 정합니다. 예시 패턴: "여기서 포인트!" → "체크 방법!" → "적용해보면!". 대본의 실제 흐름(설명 → 확인 → 적용)에 맞춥니다.`,
    `5. **questions**: 중간에 시선을 붙잡는 질문 0~${L.maxQuestions}개(text, ${L.question}자 이하). 해당 대사와 관련 있는 시각(atSec)에 둡니다. 예시 패턴: "아마추어는 백스윙이 짧다?".`,
    `6. **reactions**: 결과가 가장 인상적으로 나오는 순간에 리액션 자막 0~${L.maxReactions}개(text, ${L.reaction}자 이하). 예시 패턴: "와.. 이렇게 뻗는다고?!".`,
    `7. **emphasis**: 대사에 **실제로 나온** 핵심 단어(명사·수치·핵심 행동)만 최대 ${L.maxEmphasis}개 — 자막에서 노란색으로 강조됩니다.`,
    `8. **speed**: ${L.speedMin.toFixed(1)}~${L.speedMax} (말이 느슨하면 1.1 정도, 이미 빠르면 1.0).`,
    dropRule(dur, i.maxOutputSec),
    '10. **사실 규칙**: 영상의 대사와 화면에서 확인되는 내용만 씁니다. 숫자·기록·인물·브랜드를 지어내지 마세요. 과장·단정("100% 성공")도 금지.',
    '11. 모든 문구는 짧은 한국어. 시각은 모두 **원본 영상 기준 초**(소수 가능)이고 영상 길이 안이어야 합니다.',
    dur <= L.shortVideoSec ? `12. 이 영상은 ${L.shortVideoSec}초 이하로 짧습니다 — hook·openingLines·sections·questions·reactions·drop 은 비워 두고 title 과 emphasis, speed 만 채우세요.` : '12. 영상이 아주 짧거나 말이 없으면 억지로 채우지 말고 해당 항목을 비워 두세요(훅·소제목을 억지로 만들면 영상이 더 나빠집니다).',
    '',
    '## 출력 (JSON 한 개만, 다른 글 금지)',
    '{"version":1,"title":"…","hook":{"sourceStart":0.0,"sourceEnd":0.0,"question":"…"},"openingLines":["…"],"sections":[{"atSec":0.0,"label":"…"}],"questions":[{"atSec":0.0,"text":"…"}],"reactions":[{"atSec":0.0,"text":"…"}],"emphasis":["…"],"speed":1.1,"drop":[{"start":0.0,"end":0.0}]}',
  ].join('\n')
}

/**
 * 영상·대본·(레퍼런스)를 AI 편집 감독에게 보여 주고 편집 대본을 받는다. 대본은 정리(normalizeScript)해서 돌려준다.
 * JSON 객체가 아닌 응답(글만 오거나 배열)이면 쓸 게 없는 것이라 LlmError('invalid-json')로 던진다 — AI 호출 자체가 실패할 때(LlmError)와 같이
 * 부른 쪽이 기본 방식(컷+자막+옛 제목 카드)으로 되돌아가고 카드에 안내 줄이 생긴다. 객체인데 일부 항목만 못 쓰면 그 항목만 빼고 돌려준다.
 */
export async function directEdit(i: DirectInput, deps: { ask?: typeof askClaude; frames?: typeof extractFrames } = {}): Promise<{ script: EditScript; notes: string[] }> {
  const ask = deps.ask ?? askClaude
  const frames = deps.frames ?? extractFrames
  const refFrames = (i.refFrames ?? []).slice(0, MAX_REF_IMAGES)
  const times = planFrameTimes(i.info.durationSec, sourceFrameCount(i.info.durationSec, refFrames.length))
  const dir = path.join(i.workDir, 'director-frames')
  try {
    const own = await frames(i.sourcePath, times, dir)
    const prompt = buildDirectorPrompt({ info: i.info, transcript: i.transcript, summary: i.summary, spec: i.spec, refCount: refFrames.length, frameTimes: times, deletedSpans: i.deletedSpans, maxOutputSec: i.maxOutputSec })
    const text = await ask({ prompt, images: [...own, ...refFrames], effort: 'medium', model: process.env.VAE_DIRECTOR_MODEL || undefined })
    let raw: unknown = null
    try {
      raw = extractJson(text)
    } catch {
      raw = null
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new LlmError('invalid-json', 'AI 가 편집 대본을 읽을 수 있는 형식으로 주지 않았어요')
    return normalizeScript(raw, { durationSec: i.info.durationSec, fallbackTitle: i.summary.hookTitle || i.summary.genre || i.summary.topic, maxOutputSec: i.maxOutputSec })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

const dedupe = (times: number[], gap: number): number[] => {
  const out: number[] = []
  for (const t of [...times].sort((a, b) => a - b)) if (!out.length || t - out.at(-1)! >= gap) out.push(t)
  return out
}

/**
 * 레퍼런스 영상에서 AI 에게 보여 줄 장면 사진을 뽑는다: 첫 5초 안을 촘촘히(훅 연출을 보려고) + 전체에서 고르게, 최대 16장(JPEG).
 * 영상 자체는 남기지 않는다 — 부른 쪽은 사진만 작업 폴더에 둔다.
 */
export async function extractReferenceFrames(refPath: string, durationSec: number, outDir: string): Promise<string[]> {
  const inside = (t: number) => t > 0 && t < durationSec - 0.1
  const hook = [0.3, 0.8, 1.5, 2.5, 3.5, 5].filter(inside)
  const general = dedupe(Array.from({ length: 12 }, (_, k) => Math.round(((k + 0.5) / 12) * durationSec * 10) / 10).filter(inside), 0.1).filter((t) => hook.every((h) => Math.abs(h - t) >= 0.5))
  const room = Math.max(0, MAX_REF_IMAGES - hook.length)
  const picked = general.length <= room ? general : Array.from({ length: room }, (_, k) => general[Math.floor((k * general.length) / room)]!)
  const times = dedupe([...hook, ...picked], 0.1).slice(0, MAX_REF_IMAGES)
  return extractFrames(refPath, times.length ? times : [Math.max(0, durationSec / 2)], outDir)
}
