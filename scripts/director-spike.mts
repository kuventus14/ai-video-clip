// 편집 감독이 실제 영상에서 쓸 만한 대본을 내는지 눈으로 확인하는 수동 시험(AI 를 실제로 부른다).
//   npx tsx scripts/director-spike.mts <내 영상> [레퍼런스 영상 파일]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { directEdit, extractReferenceFrames } from '../src/core/director.ts'
import { analyzeInput } from '../src/core/pipeline.ts'
import { analyzeReference } from '../src/core/styleSpec.ts'
import { probeVideo } from '../src/core/media.ts'

const [video, reference] = process.argv.slice(2)
if (!video) {
  console.error('사용법: npx tsx scripts/director-spike.mts <내 영상> [레퍼런스 영상 파일]')
  process.exit(2)
}
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'director-spike-'))
const t0 = Date.now()
const lap = (what: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${what}`)

const analysis = await analyzeInput({ videoPath: path.resolve(video), workDir: work })
lap(`분석 끝: ${analysis.info.durationSec.toFixed(1)}초, 장르 "${analysis.summary.genre}", 주제 "${analysis.summary.topic}", 대본 ${analysis.transcript.segments.length}줄`)

let spec, refFrames: string[] | undefined
if (reference) {
  const info = await probeVideo(path.resolve(reference))
  spec = await analyzeReference({ path: path.resolve(reference), info })
  refFrames = await extractReferenceFrames(path.resolve(reference), info.durationSec, path.join(work, 'ref-frames'))
  lap(`레퍼런스 분석 끝: 스타일 훅="${spec.hook.description}", 사진 ${refFrames.length}장`)
}

const t1 = Date.now()
const { script, notes } = await directEdit({ info: analysis.info, transcript: analysis.transcript, summary: analysis.summary, sourcePath: analysis.sourcePath, spec, refFrames, workDir: work })
lap(`편집 감독 끝 (AI 호출 ${((Date.now() - t1) / 1000).toFixed(0)}초)`)
console.log('\n=== 편집 대본 ===')
console.log(JSON.stringify(script, null, 2))
console.log('\n=== 정리 노트 ===')
console.log(notes.length ? notes.map((n) => `- ${n}`).join('\n') : '(없음)')
console.log('\n=== 대본(음성 인식) ===')
for (const s of analysis.transcript.segments) console.log(`[${s.start.toFixed(1)}~${s.end.toFixed(1)}] ${s.text}`)
fs.rmSync(work, { recursive: true, force: true })
