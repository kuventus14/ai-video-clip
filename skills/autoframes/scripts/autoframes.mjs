#!/usr/bin/env node
// autoframes — 영상 자동 편집 앱(ai-video-clip)의 로컬 API 를 대화로 쓰게 해 주는 작은 도구. 맥·윈도우·리눅스, Node 22+.
// 출력은 일부러 짧게 요약한다(Claude Code 가 긴 JSON 을 읽느라 토큰을 쓰지 않게). 자세한 사용은 SKILL.md.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const PORT = process.env.VAE_PORT || '4848'
const BASE = `http://127.0.0.1:${PORT}`
const PID_FILE = path.join(os.tmpdir(), `autoframes-app-${PORT}.pid`)
const LOG_FILE = path.join(os.tmpdir(), `autoframes-app-${PORT}.log`)

// ---------- 보여 주기(순수 함수 — 시험한다) ----------

export const STATUS_KO = {
  created: '만드는 중', queued_probe: '영상 확인 대기', probing: '영상 확인 중', ready: '영상 확인 끝(시작 대기)',
  queued_analysis: '분석 대기', analyzing: '분석 중', awaiting_reference: '자막·레퍼런스 고르기(내 차례)',
  queued_plan: '계획 대기', planning: '계획 세우는 중', awaiting_plan: '계획 승인(내 차례)',
  queued_produce: '제작 대기', producing: '제작 중', awaiting_confirm: '결과 확인(내 차례)', confirmed: '확정됨', failed: '실패',
}
/** 사용자(또는 이 도구)가 움직여야 하는 상태 — status --wait 은 여기서 멈춘다 */
export const WAITING = new Set(['ready', 'awaiting_reference', 'awaiting_plan', 'awaiting_confirm', 'confirmed', 'failed'])

const NEXT = {
  ready: 'start <id> [--description "…"] [--purpose auto|post|short] [--reference <링크>]',
  awaiting_reference: 'captions <id> 로 자막을 보고(틀린 곳은 --save 로 파일에 받아 고친 뒤) plan <id> [--reference <링크>|--reference-file <파일>|--reference none] [--request "…"] [--captions-file 파일.json]',
  awaiting_plan: 'approve <id> [--bgm 곡id|none] [--sfx on|off] [--audio original|voice|mic] [--captions auto|off] [--position top|middle|bottom] [--quality draft|looks|delivery] [--title "…"] [--hook-question "…"]',
  awaiting_confirm: 'confirm <id> | plan <id> --request "고칠 점"(수정 요청) | other <id>(반대 용도 버전) | remix <id> --bgm-gain N --sfx-gain N(소리 크기) | result <id> --save <폴더>',
  confirmed: 'result <id> --save <폴더> (영상 파일 받기)',
  failed: 'retry <id>',
}
const WORKING = 'status <id> --wait (끝나길 기다리기)'

export const mmss = (sec) => {
  const s = Math.max(0, Math.round(Number(sec) || 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
const PURPOSE_KO = { post: '게시물용(가로)', short: '릴스·숏츠용(세로)' }
const dbLabel = (db) => (db === 0 ? '기본' : `${db > 0 ? '+' : '−'}${Math.abs(db)}dB`)
const SEV = { high: '중요', medium: '확인', info: '참고' }

/** 작업 한 건을 짧은 글로 */
export function describeJob(d) {
  const L = []
  L.push(`작업 ${d.id}: ${STATUS_KO[d.status] ?? d.status} (${d.status})${d.stage ? ` — ${d.stage}` : ''}`)
  if (d.title) L.push(`제목: ${d.title}`)
  const purpose = d.purpose ?? d.purposeGuess?.purpose
  if (purpose) L.push(`용도: ${PURPOSE_KO[purpose] ?? purpose}${d.purpose ? '' : ' (자동 인식 — 직접 고른 값이 항상 우선이에요)'}`)
  if (d.sourceInfo) L.push(`영상: ${mmss(d.sourceInfo.durationSec)} · ${d.sourceInfo.width}×${d.sourceInfo.height}`)

  if (d.status === 'awaiting_reference' && d.recommendations?.length) {
    L.push('추천 레퍼런스(고르려면 plan --reference <링크>):')
    for (const [i, r] of d.recommendations.slice(0, 6).entries()) L.push(`  ${i + 1}. ${r.title}${r.channel ? ` — ${r.channel}` : ''} · ${r.viewCount ?? '?'}회 · ${mmss(r.durationSec)} · ${r.url}`)
  }
  if (d.status === 'awaiting_plan') {
    if (d.planCard?.length) L.push('이렇게 이해했어요:', ...d.planCard.map((x) => `  • ${x}`))
    const s = d.script
    if (s) L.push(`편집 구성: 제목 "${s.title}"${s.hookQuestion ? ` · 훅 질문 "${s.hookQuestion}"(${s.hookSec}초)` : ''} · 소개 ${s.openingLines?.length ?? 0}줄 · 소제목 ${s.sections?.length ?? 0}개 · 속도 ${s.speed}배`)
    L.push(`지금 선택: 자막 ${d.captionsMode}${d.captionPosition ? `(${d.captionPosition})` : ''} · 소리 ${d.audioMode} · 음악 ${d.bgmId ?? '없음'} · 효과음 ${d.sfxMode} · 화질 ${d.quality}`)
  }
  if (d.report && (d.status === 'awaiting_confirm' || d.status === 'confirmed')) {
    const r = d.report
    L.push(`검수: ${r.passed ? '통과' : '문제 있음'} · 만든 횟수 ${r.attempts}${d.resultInfo ? ` · 결과 ${mmss(d.resultInfo.durationSec)} ${d.resultInfo.width}×${d.resultInfo.height}` : ''}`)
    for (const f of (r.findings ?? []).filter((f) => f.id !== 'caption-suggestion').slice(0, 8)) L.push(`  [${SEV[f.severity] ?? f.severity}] ${f.atSec !== undefined ? `${mmss(f.atSec)} ` : ''}${f.message}`)
    if (r.appliedCorrections?.length || r.suggestions?.length) L.push(`  자막 교정: 자동 ${r.appliedCorrections?.length ?? 0}건 · 제안만 ${r.suggestions?.length ?? 0}건`)
    if (r.unchecked?.length) L.push(`  검수가 확인하지 않은 것: ${r.unchecked.slice(0, 6).join(' / ')} — 사용자가 직접 확인해야 해요`)
  }
  const sa = d.soundAdjust
  if (sa && (d.status === 'awaiting_confirm' || d.status === 'confirmed')) {
    L.push(sa.available
      ? `소리 크기: 음악 ${dbLabel(sa.bgmGainDb)}${d.sfxMode === 'on' && sa.sfxCount !== 0 ? ` · 효과음 ${dbLabel(sa.sfxGainDb)}` : ''} (AI 추천: 음악 ${dbLabel(sa.aiBgmGainDb)} · 효과음 ${dbLabel(sa.aiSfxGainDb)}${sa.aiReason ? ` — ${sa.aiReason}` : ''}) — AI 는 소리를 직접 듣지 못해요`
      : `소리 크기 조절 불가: ${sa.reason}`)
  }
  if (d.status === 'failed') L.push(`오류: ${d.error ?? '알 수 없음'}${d.failedPhase ? ` (단계: ${d.failedPhase})` : ''}`)
  else if (d.error && d.status === 'awaiting_confirm') L.push(`알림: ${d.error}`)
  L.push(`다음: ${NEXT[d.status] ?? WORKING}`)
  return L.join('\n')
}

/** 자막 줄을 번호·시각과 함께 한 줄씩 */
export function describeCaptions(c) {
  const L = [`자막 ${c.lines.length}줄 · 영상 ${mmss(c.durationSec)}${c.hasSpeech ? '' : ' · 말이 인식되지 않았어요(직접 넣을 수 있어요)'}${c.custom ? ' · 고친 자막이 저장돼 있어요' : ''}`]
  const low = new Map()
  for (const o of c.original ?? []) if (o.lowWords?.length) low.set(`${o.start}`, o.lowWords)
  c.lines.forEach((l, i) => {
    const w = low.get(`${l.start}`)
    L.push(`${i + 1}. ${l.start.toFixed(1)}–${l.end.toFixed(1)} ${l.text}${w ? `   ⚠ 의심: ${w.join(', ')}` : ''}`)
  })
  // 자막이 없는 구간(2초 이상) — 인식이 놓친 곳
  let t = 0
  const gaps = []
  for (const l of c.lines) {
    if (l.start - t >= 2) gaps.push(`${mmss(t)}–${mmss(l.start)}`)
    t = Math.max(t, l.end)
  }
  if (c.durationSec - t >= 2) gaps.push(`${mmss(t)}–${mmss(c.durationSec)}`)
  if (gaps.length) L.push(`자막이 없는 구간: ${gaps.join(', ')}`)
  return L.join('\n')
}

export function describeSounds(s) {
  const mood = { calm: '잔잔한', bright: '밝은', energetic: '신나는' }
  const L = [`배경음악 ${s.bgm.length}곡 · 효과음 ${s.sfxCount}개${s.bgm.length ? '' : ' (음원 파일이 없어요 — assets/sound/README.md)'}`]
  for (const t of s.bgm) L.push(`  ${t.id} — ${t.title} (${mood[t.mood] ?? t.mood}, ${mmss(t.durationSec)})`)
  return L.join('\n')
}

// ---------- 저장소 찾기 ----------

export function findRepo(o = {}) {
  const env = o.env ?? process.env
  const home = o.home ?? os.homedir()
  const cwd = o.cwd ?? process.cwd()
  const isRepo = (dir) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name === 'video-autoeditor' && fs.existsSync(path.join(dir, 'src', 'worker'))
    } catch {
      return false
    }
  }
  const cands = [env.AUTOFRAMES_HOME]
  for (let d = cwd; ; d = path.dirname(d)) {
    cands.push(d)
    if (path.dirname(d) === d) break
  }
  cands.push(...['ai-video-clip', 'dev/ai-video-clip', 'Desktop/ai-video-clip', 'Documents/ai-video-clip', 'Desktop/클로드 작업/video-autoeditor'].map((p) => path.join(home, p)))
  return cands.filter(Boolean).find(isRepo) ?? null
}

// ---------- 앱과 이야기하기 ----------

async function api(method, p, body) {
  let res
  try {
    res = await fetch(BASE + p, { method, headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined })
  } catch {
    throw new Error(`앱이 꺼져 있어요(${BASE}). 먼저 \`app up\` 으로 켜세요.`)
  }
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    // JSON 이 아니면 아래에서 일반 문구
  }
  if (!res.ok) throw new Error(json?.error ?? `요청이 실패했어요 (${res.status})`)
  return json
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function putFile(p, file) {
  const size = fs.statSync(file).size
  const res = await fetch(BASE + p, { method: 'PUT', body: Readable.toWeb(fs.createReadStream(file)), duplex: 'half', headers: { 'content-length': String(size), 'content-type': 'application/octet-stream' } })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(json?.error ?? `올리지 못했어요 (${res.status})`)
  return json
}

async function waitFor(id, timeoutSec) {
  const end = Date.now() + timeoutSec * 1000
  for (;;) {
    const d = await api('GET', `/api/jobs/${id}`)
    if (WAITING.has(d.status) || Date.now() > end) return d
    await sleep(3000)
  }
}

const up = async () => {
  try {
    return (await fetch(`${BASE}/api/jobs`)).ok
  } catch {
    return false
  }
}

async function appCmd(sub, flags) {
  if (sub === 'status') return console.log((await up()) ? `앱이 켜져 있어요: ${BASE}` : '앱이 꺼져 있어요')
  if (sub === 'down') {
    const pid = Number(fs.existsSync(PID_FILE) ? fs.readFileSync(PID_FILE, 'utf8') : 0)
    if (!pid) return console.log('이 도구로 켠 앱이 없어요(터미널에서 직접 켠 앱은 그 터미널에서 Ctrl+C).')
    // 맥·리눅스는 SIGINT(런처가 자식에게 종료를 알린다), 윈도우는 신호가 없어 트리째 끝낸다
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    else {
      try {
        process.kill(pid, 'SIGINT')
      } catch {
        // 이미 끝났다
      }
    }
    fs.rmSync(PID_FILE, { force: true })
    return console.log('앱을 껐어요.')
  }
  if (sub !== 'up') throw new Error('사용법: app up|status|down')
  if (await up()) return console.log(`앱이 이미 켜져 있어요: ${BASE}`)
  const repo = findRepo()
  if (!repo) throw new Error('저장소를 찾지 못했어요. `where` 로 확인하고, 없으면 설치부터(SKILL.md 의 "시작하기").')
  const log = fs.openSync(LOG_FILE, 'w')
  const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'app'], { cwd: repo, env: { ...process.env, VAE_PORT: PORT }, detached: process.platform !== 'win32', stdio: ['ignore', log, log], windowsHide: true, shell: process.platform === 'win32' })
  child.unref()
  fs.writeFileSync(PID_FILE, String(child.pid))
  const timeout = Number(flags.timeout ?? 420)
  for (let t = 0; t < timeout; t += 2) {
    if (await up()) return console.log(`앱이 켜졌어요: ${BASE} (로그: ${LOG_FILE})`)
    await sleep(2000)
  }
  throw new Error(`앱이 ${timeout}초 안에 켜지지 않았어요. 로그: ${LOG_FILE}\n${fs.readFileSync(LOG_FILE, 'utf8').slice(-600)}`)
}

// ---------- 명령 ----------

const OPTS = {
  description: { type: 'string' }, purpose: { type: 'string' }, reference: { type: 'string' }, 'reference-file': { type: 'string' }, request: { type: 'string' },
  'captions-file': { type: 'string' }, 'captions-reset': { type: 'boolean' }, save: { type: 'string' }, json: { type: 'boolean' },
  captions: { type: 'string' }, position: { type: 'string' }, audio: { type: 'string' }, bgm: { type: 'string' }, sfx: { type: 'string' }, quality: { type: 'string' },
  title: { type: 'string' }, 'hook-question': { type: 'string' }, 'bgm-gain': { type: 'string' }, 'sfx-gain': { type: 'string' },
  wait: { type: 'boolean' }, timeout: { type: 'string' }, start: { type: 'boolean' },
}

const show = async (id, flags) => console.log(describeJob(flags.wait ? await waitFor(id, Number(flags.timeout ?? 540)) : await api('GET', `/api/jobs/${id}`)))

export async function main(argv) {
  const { positionals: [cmd, arg] = [], values: f } = parseArgs({ args: argv, options: OPTS, allowPositionals: true })
  const need = (v, what) => {
    if (!v) throw new Error(`${what} 이(가) 필요해요`)
    return v
  }
  switch (cmd) {
    case 'where': {
      const repo = findRepo()
      if (!repo) throw new Error('저장소를 찾지 못했어요(AUTOFRAMES_HOME 으로 지정하거나, SKILL.md 의 "시작하기"대로 받으세요).')
      return console.log(repo)
    }
    case 'app':
      return appCmd(arg, f)
    case 'sounds':
      return console.log(describeSounds(await api('GET', '/api/sound')))
    case 'new': {
      const file = path.resolve(need(arg, '영상 파일 경로'))
      if (!fs.existsSync(file)) throw new Error(`파일이 없어요: ${file}`)
      const job = await api('POST', '/api/jobs')
      await putFile(`/api/jobs/${job.id}/video?name=${encodeURIComponent(path.basename(file))}`, file)
      const d = await waitFor(job.id, 180)
      console.log(describeJob(d))
      if (f.start && d.status === 'ready') {
        const s = await api('POST', `/api/jobs/${job.id}/start`, { description: f.description, purposeChoice: f.purpose ?? 'auto', reference: f.reference ?? null })
        console.log(`\n분석을 시작했어요 → ${STATUS_KO[s.status]}. 기다리려면: status ${job.id} --wait`)
      }
      return
    }
    case 'start': {
      const d = await api('POST', `/api/jobs/${need(arg, '작업 id')}/start`, { description: f.description, purposeChoice: f.purpose ?? 'auto', reference: f.reference ?? null })
      return console.log(`분석을 시작했어요 → ${STATUS_KO[d.status]}. 기다리려면: status ${arg} --wait`)
    }
    case 'status':
      return show(need(arg, '작업 id'), f)
    case 'list': {
      const jobs = await api('GET', '/api/jobs')
      return console.log(jobs.map((j) => `${j.id}  ${STATUS_KO[j.status] ?? j.status}  ${j.title}`).join('\n') || '작업이 없어요')
    }
    case 'captions': {
      const c = await api('GET', `/api/jobs/${need(arg, '작업 id')}/captions`)
      if (f.save) {
        fs.writeFileSync(f.save, JSON.stringify(c.lines, null, 2))
        console.log(`자막 ${c.lines.length}줄을 ${f.save} 에 저장했어요. 고친 뒤: plan ${arg} --captions-file ${f.save}`)
      }
      return console.log(f.json ? JSON.stringify(c.lines) : describeCaptions(c))
    }
    case 'plan': {
      const body = {}
      if (f.reference !== undefined) body.reference = f.reference === 'none' ? null : f.reference
      if (f['reference-file']) {
        await putFile(`/api/jobs/${need(arg, '작업 id')}/reference-file?name=${encodeURIComponent(path.basename(f['reference-file']))}`, path.resolve(f['reference-file']))
        body.reference = 'uploaded'
      }
      if (f.request !== undefined) body.request = f.request
      if (f.purpose) body.purposeChoice = f.purpose
      if (f['captions-file']) body.captionTrack = JSON.parse(fs.readFileSync(f['captions-file'], 'utf8'))
      if (f['captions-reset']) body.captionTrack = null
      const d = await api('POST', `/api/jobs/${need(arg, '작업 id')}/plan`, body)
      return console.log(`계획을 요청했어요 → ${STATUS_KO[d.status]}. 기다리려면: status ${arg} --wait`)
    }
    case 'approve': {
      const body = {}
      if (f.captions) body.captions = f.captions
      if (f.position) body.captionPosition = f.position
      if (f.audio) body.audio = f.audio
      if (f.bgm !== undefined) body.bgm = f.bgm === 'none' ? null : f.bgm
      if (f.sfx) body.sfx = f.sfx
      if (f.quality) body.quality = f.quality
      const edits = {}
      if (f.title) edits.title = f.title
      if (f['hook-question']) edits.hookQuestion = f['hook-question']
      if (Object.keys(edits).length) body.scriptEdits = edits
      const d = await api('POST', `/api/jobs/${need(arg, '작업 id')}/approve`, body)
      return console.log(`제작을 시작했어요 → ${STATUS_KO[d.status]} (영상 길이의 2~3배쯤 걸려요). 기다리려면: status ${arg} --wait`)
    }
    case 'remix': {
      const id = need(arg, '작업 id')
      const cur = (await api('GET', `/api/jobs/${id}`)).soundAdjust
      if (!cur) throw new Error('음악도 효과음도 쓰지 않은 작업이에요')
      const num = (v, fallback) => (v === undefined ? fallback : Number(v))
      await api('POST', `/api/jobs/${id}/remix`, { bgmGainDb: num(f['bgm-gain'], cur.bgmGainDb), sfxGainDb: num(f['sfx-gain'], cur.sfxGainDb) })
      return console.log(describeJob(await waitFor(id, 120)))
    }
    case 'confirm':
      return console.log(describeJob(await api('POST', `/api/jobs/${need(arg, '작업 id')}/confirm`)))
    case 'other':
      return console.log(`반대 용도의 새 작업을 만들었어요:\n${describeJob(await api('POST', `/api/jobs/${need(arg, '작업 id')}/other-version`))}`)
    case 'retry':
      return console.log(`다시 시도해요 → ${STATUS_KO[(await api('POST', `/api/jobs/${need(arg, '작업 id')}/retry`)).status]}. 기다리려면: status ${arg} --wait`)
    case 'result': {
      const id = need(arg, '작업 id')
      const d = await api('GET', `/api/jobs/${id}`)
      if (!d.media?.result) throw new Error('아직 결과 영상이 없어요')
      const url = BASE + d.media.result
      if (!f.save) return console.log(`결과 영상 주소: ${url}\n파일로 받으려면: result ${id} --save <폴더>`)
      const dest = fs.existsSync(f.save) && fs.statSync(f.save).isDirectory() ? path.join(f.save, `autoframes-${id}.mp4`) : f.save
      const res = await fetch(url)
      if (!res.ok || !res.body) throw new Error(`내려받지 못했어요 (${res.status})`)
      fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
      return console.log(`저장했어요: ${dest} (${(fs.statSync(dest).size / 1048576).toFixed(1)}MB) — 인스타·유튜브 등에는 이 파일을 직접 올려 주세요(자동 업로드는 아직 없어요).`)
    }
    default:
      console.log('사용법: autoframes.mjs where | app up|status|down | sounds | list | new <영상> [--start …] | start <id> | status <id> [--wait] | captions <id> [--save 파일] | plan <id> … | approve <id> … | remix <id> … | confirm <id> | other <id> | retry <id> | result <id> [--save 폴더]')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`오류: ${e.message}`)
    process.exit(1)
  })
}
