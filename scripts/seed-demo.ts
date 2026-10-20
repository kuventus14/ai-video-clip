/**
 * 화면을 눈으로 확인하기 위한 시연 데이터. VAE_DATA_DIR(기본 data-demo)에 모든 상태의 작업을 만든다.
 * 영상·썸네일은 ffmpeg 로 만든 3초짜리 합성 화면이다. 실행: npm run seed:demo
 * 안전장치: 폴더 이름이 data-demo 로 끝나지 않으면 실제 데이터일 수 있어 거부한다.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { openDb } from '../src/db/db.ts'
import { Jobs, type Job } from '../src/db/jobs.ts'
import type { Recommendation } from '../src/shared/types.ts'

const dataDir = path.resolve(process.env.VAE_DATA_DIR ?? 'data-demo')
if (!dataDir.endsWith(`${path.sep}data-demo`)) {
  console.error(`시연 데이터는 이름이 data-demo 인 폴더에만 만들어요. 지금 VAE_DATA_DIR 은 ${dataDir} 예요.`)
  process.exit(1)
}
fs.mkdirSync(dataDir, { recursive: true })

const db = openDb(dataDir)
const jobs = new Jobs(db, dataDir)

// 켜져 있는 개발 서버가 같은 DB 를 보고 있을 수 있어, 폴더를 지우지 않고 내용만 비운다.
db.exec('DELETE FROM jobs')
fs.rmSync(path.join(dataDir, 'jobs'), { recursive: true, force: true })

type Shape = 'portrait' | 'landscape'
const SIZE: Record<Shape, string> = { portrait: '360x640', landscape: '640x360' }
const INFO: Record<Shape, { durationSec: number; width: number; height: number }> = {
  portrait: { durationSec: 56.8, width: 1080, height: 1920 },
  landscape: { durationSec: 184.3, width: 1920, height: 1080 },
}

function ffmpeg(args: string[]): void {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' })
}

/** 3초짜리 합성 영상(무늬 + 소리). hue 로 작업마다 색을 달리한다. */
function makeVideo(file: string, shape: Shape, hue: number): void {
  ffmpeg(['-f', 'lavfi', '-i', `testsrc2=s=${SIZE[shape]}:d=3:r=24`, '-f', 'lavfi', '-i', 'sine=f=330:d=3', '-vf', `hue=h=${hue}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file])
}

function makeThumb(video: string, file: string): void {
  ffmpeg(['-ss', '1', '-i', video, '-frames:v', '1', '-q:v', '4', file])
}

function recThumb(hueA: number, hueB: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hueA} 55% 38%)"/><stop offset="1" stop-color="hsl(${hueB} 60% 22%)"/></linearGradient></defs><rect width="320" height="180" fill="url(#g)"/><path d="M135 62l56 28-56 28z" fill="#fff" fill-opacity=".85"/></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

const RECOMMENDATIONS: Recommendation[] = [
  { id: 'rec1', url: 'https://www.youtube.com/watch?v=demo0000001', title: '롱아이언, 이것만 바꾸면 거리가 20야드 늘어요', channel: '골프 연구소', viewCount: 361521, durationSec: 58, thumbnail: recThumb(215, 250) },
  { id: 'rec2', url: 'https://www.youtube.com/watch?v=demo0000002', title: '체중 이동 3초 만에 이해하기 | 아이언 스윙', channel: '라운드 데일리', viewCount: 148200, durationSec: 47, thumbnail: recThumb(160, 200) },
  { id: 'rec3', url: 'https://www.youtube.com/watch?v=demo0000003', title: '아마추어가 롱아이언을 못 치는 진짜 이유', channel: '프로의 한 수', viewCount: 88350, durationSec: 62, thumbnail: recThumb(25, 330) },
  { id: 'rec4', url: 'https://www.youtube.com/watch?v=demo0000004', title: '벙커 탈출 한 번에 끝내는 법', channel: '골프 연구소', viewCount: 52100, durationSec: 39, thumbnail: recThumb(280, 230) },
  { id: 'rec5', url: 'https://www.youtube.com/watch?v=demo0000005', title: '드라이버 슬라이스 고치는 그립 위치', channel: '스윙 노트', viewCount: 8835, durationSec: 71, thumbnail: recThumb(340, 20) },
  { id: 'rec6', url: 'https://www.youtube.com/watch?v=demo0000006', title: '퍼팅 라인 읽는 방법 (초보 필수)', channel: '라운드 데일리', viewCount: null, durationSec: 55, thumbnail: recThumb(100, 140) },
]

const SUMMARY = {
  topic: '롱아이언 스윙 교정',
  genre: '골프 레슨',
  oneLine: '롱아이언 비거리를 늘리는 체중 이동 레슨',
  hookTitle: '롱아이언, 왜 안 맞을까?',
  searchQueries: ['롱아이언 레슨 쇼츠', '체중 이동 아이언 스윙', '골프 아이언 비거리 늘리는 법'],
}

const PLAN_CARD = [
  '이렇게 이해했어요: 레퍼런스의 편집 스타일을 최대한 따라 해요.',
  '• 자막: 한 줄에 한 문장씩, 화면 아래쪽에 큰 글씨(흰색, 핵심 단어는 노란색)로 넣어요',
  '• 제목 카드: 처음 3초 안에 "롱아이언, 왜 안 맞을까?" 를 크게 띄워요',
  '• 컷 속도: 말이 끊기는 구간을 잘라 45~50초 안팎으로 줄여요 (비슷하게만 가능해요)',
  '• 화면 구도: 릴스·숏츠용이라 세로 9:16 으로 만들고, 사람이 가운데 오도록 맞춰요',
  '• 전환 효과: "줌 인으로 넘어가기" 는 이번 버전에서 반영하지 못했어요',
  '• 배경 음악: 이번 버전에서는 지원하지 않아요',
]

const REPORT = {
  qa: {
    passed: false,
    findings: [
      { id: 'caption-low-confidence', severity: 'medium', message: '자막 "체중이동이" 는 음성 인식 확신이 낮아요. 직접 들어보고 확인해 주세요.', atSec: 12.4 },
      { id: 'quality-upscale', severity: 'info', message: '원본이 720p 라서 1080p 로 키웠어요. 글자 주변이 조금 부드러워 보일 수 있어요.' },
    ],
  },
  attempts: 2,
  reframe: 'person',
  purpose: { resolved: 'short' },
  output: { durationSec: 44.2, width: 1080, height: 1920 },
  appliedCorrections: [
    { index: 3, text: '롱아이언은 체중 이동이 핵심이에요', reason: '"롱 아이런" 오타를 고쳤어요' },
    { index: 7, text: '임팩트 직전까지 왼발에 체중을 실어요', reason: '"임펙트" 를 표준 표기로 고쳤어요' },
  ],
  suggestions: [{ index: 9, text: '다운스윙에서 손목을 유지해요', reason: '"다운 스윙" 은 붙여 쓰는 편이 더 자연스러워요' }],
  unchecked: ['소리 크기가 구간마다 고른지', '배경 음악과 말소리가 겹치는지', '화면 전환이 어색한 곳이 있는지'],
}

interface Seed {
  patch: Partial<Omit<Job, 'id' | 'createdAt'>>
  shape?: Shape
  hue?: number
  withResult?: boolean
  /** 지금 상태가 된 지 몇 초 됐는지(진행 화면의 경과 시간). 없으면 만든 시각 */
  statusAgoSec?: number
  /** 요약의 한 줄(= 목록의 제목). 요약이 있는 작업만 */
  oneLine?: string
  /** 지금으로부터 몇 시간 전에 만들었는지 */
  hoursAgo: number
  log?: [string, string][]
}

const base = (name: string, shape: Shape): Partial<Omit<Job, 'id' | 'createdAt'>> => ({ sourceName: name, sourceInfo: INFO[shape], purposeGuess: { purpose: shape === 'portrait' ? 'short' : 'post', confidence: shape === 'portrait' ? 0.88 : 0.74, reasons: shape === 'portrait' ? ['세로 영상이에요', '1분 안쪽이에요'] : ['가로 영상이에요', '3분 이상이에요'] } })

const SEEDS: Seed[] = [
  { hoursAgo: 0.1, shape: 'portrait', hue: 0, patch: { ...base('롱아이언_레슨.mp4', 'portrait'), status: 'ready' } },
  { statusAgoSec: 75, hoursAgo: 0.3, shape: 'portrait', hue: 60, patch: { ...base('벙커샷_연습.mov', 'portrait'), status: 'analyzing', stage: '말을 글로 옮기는 중', description: '벙커에서 공을 한 번에 빼내는 연습 영상' }, log: [['probe', '영상 정보를 확인했어요'], ['analysis', '음성을 글로 옮기는 중']] },
  { oneLine: '퍼팅 라인 읽는 법, 초보용', hoursAgo: 0.6, shape: 'portrait', hue: 120, patch: { ...base('퍼팅_라인.mp4', 'portrait'), status: 'awaiting_reference', summary: SUMMARY, recommendations: RECOMMENDATIONS, description: '퍼팅 라인 읽는 법' } },
  { oneLine: '추천이 없는 영상 테스트', hoursAgo: 0.8, shape: 'portrait', hue: 150, patch: { ...base('추천없음_테스트.mp4', 'portrait'), status: 'awaiting_reference', summary: SUMMARY, recommendations: [], description: '추천 목록이 비어 있는 경우' } },
  { oneLine: '롱아이언 체중 이동 핵심 3초', hoursAgo: 1, shape: 'portrait', hue: 180, patch: { ...base('롱아이언_릴스.mp4', 'portrait'), status: 'awaiting_plan', summary: SUMMARY, description: '롱아이언 체중 이동', referenceSource: RECOMMENDATIONS[0]!.url, requestText: '제목 카드와 자막 스타일을 따라 해 주세요', planCard: PLAN_CARD, purpose: 'short', purposeChoice: 'auto' } },
  { oneLine: '드라이버 슬라이스 잡는 그립', statusAgoSec: 193, hoursAgo: 1.5, shape: 'portrait', hue: 240, patch: { ...base('드라이버_슬라이스.mp4', 'portrait'), status: 'producing', stage: '자막을 입히는 중', summary: SUMMARY, referenceSource: RECOMMENDATIONS[1]!.url, planCard: PLAN_CARD, purpose: 'short' }, log: [['plan', '계획을 만들었어요'], ['produce', '말이 끊기는 구간을 잘랐어요'], ['produce', '자막을 입히는 중']] },
  { hoursAgo: 2, shape: 'portrait', hue: 300, withResult: true, patch: { ...base('롱아이언_릴스_편집본.mp4', 'portrait'), status: 'awaiting_confirm', summary: SUMMARY, referenceSource: RECOMMENDATIONS[0]!.url, planCard: PLAN_CARD, purpose: 'short', report: REPORT, attempts: 2 } },
  { hoursAgo: 26, shape: 'landscape', hue: 30, withResult: true, patch: { ...base('레슨_풀버전.mp4', 'landscape'), status: 'confirmed', summary: { ...SUMMARY, oneLine: '아이언 스윙 전체 레슨(가로 영상)' }, purpose: 'post', planCard: PLAN_CARD, report: { ...REPORT, purpose: { resolved: 'post' }, output: { durationSec: 171.4, width: 1920, height: 1080 }, qa: { passed: true, findings: [] }, suggestions: [], appliedCorrections: [] }, attempts: 1, confirmedAt: new Date(Date.now() - 25 * 3600_000).toISOString() } },
  { hoursAgo: 24 * 4, shape: 'portrait', hue: 90, withResult: true, patch: { ...base('퍼팅_꿀팁.mp4', 'portrait'), status: 'confirmed', summary: { ...SUMMARY, oneLine: '퍼팅 라인 읽는 세 가지 방법' }, purpose: 'short', planCard: PLAN_CARD, report: { ...REPORT, qa: { passed: true, findings: [] }, suggestions: [] }, attempts: 1, confirmedAt: new Date(Date.now() - 24 * 4 * 3600_000).toISOString() } },
  { oneLine: '비공개 레퍼런스 링크 테스트', hoursAgo: 24 * 9, shape: 'portrait', hue: 200, patch: { ...base('비공개_레퍼런스_테스트.mp4', 'portrait'), status: 'failed', failedPhase: 'plan', summary: SUMMARY, referenceSource: 'https://www.instagram.com/reel/PRIVATE/', errorMessage: '레퍼런스 영상을 내려받지 못했어요. 비공개 계정이거나 링크가 잘못됐을 수 있어요. 다른 링크를 넣거나 영상 파일을 직접 올려 주세요.' } },
]

for (const seed of SEEDS) {
  const job = jobs.create()
  const dir = jobs.jobDir(job.id)
  const shape = seed.shape ?? 'portrait'
  const source = path.join(dir, 'source.mp4')
  makeVideo(source, shape, seed.hue ?? 0)
  const thumb = path.join(dir, 'thumb.jpg')
  makeThumb(source, thumb)
  const patch: Partial<Omit<Job, 'id' | 'createdAt'>> = { ...seed.patch, sourcePath: source, thumbPath: thumb }
  if (seed.oneLine && patch.summary) patch.summary = { ...(patch.summary as typeof SUMMARY), oneLine: seed.oneLine }
  if (seed.withResult) {
    const result = path.join(dir, 'result.mp4')
    makeVideo(result, shape, (seed.hue ?? 0) + 40)
    patch.resultPath = result
  }
  jobs.update(job.id, patch)
  for (const [stage, message] of seed.log ?? []) jobs.log(job.id, stage, message)
  // 만든 시각을 과거로 돌린다(기록 화면의 "어제"·날짜 표시를 보려고)
  const created = new Date(Date.now() - seed.hoursAgo * 3600_000).toISOString()
  const since = seed.statusAgoSec === undefined ? created : new Date(Date.now() - seed.statusAgoSec * 1000).toISOString()
  db.prepare('UPDATE jobs SET created_at = ?, updated_at = ?, status_changed_at = ? WHERE id = ?').run(created, since, since, job.id)
}

db.close()
console.log(`시연 데이터 ${SEEDS.length}개를 ${dataDir} 에 만들었어요.`)
