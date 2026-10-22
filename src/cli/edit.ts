import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { ToolError } from '../core/exec.ts'
import { LlmError } from '../core/llm.ts'
import { InputError, runEdit, type Quality, type Stage } from '../core/pipeline.ts'
import { ReferenceFetchError } from '../core/reference.ts'
import { checkSoundFlags } from '../core/sound.ts'
import { VoiceError } from '../core/voice.ts'
import { loadCatalog, SoundError } from '../shared/sound.ts'
import type { AudioMode } from '../shared/voice.ts'
import type { Purpose } from '../core/types.ts'

const USAGE = `영상 자동 편집
사용법: npm run edit -- --video <영상> --out <결과 폴더> [옵션]

  --video <경로>          편집할 영상 (필수)
  --out <폴더>            결과를 둘 폴더 (필수) — result.mp4, report.json 이 생겨요
  --reference <경로|링크>  레퍼런스 영상 파일 또는 유튜브·인스타 링크
  --description "<글>"    영상이 어떤 영상인지 한 줄 설명 (비우면 AI가 영상을 보고 판단)
  --purpose auto|post|short   게시물용(가로) / 릴스·숏츠용(세로). 기본 auto(자동 인식)
  --request "<글>"        레퍼런스에서 참고할 부분 (비우면 AI가 알아서)
  --quality draft|looks|delivery   렌더 화질. 기본 looks
  --captions auto|off     자막. 기본 auto
  --audio original|voice  소리. original(기본)은 원본 그대로, voice 는 소음을 줄이고 목소리 크기를 맞춰요
  --bgm <곡 id|none>      배경음악. 기본 none (assets/sound 의 곡 id)
  --sfx on|off            효과음. 기본 off
  --keep-work             작업 폴더를 지우지 않고 남겨요
`

const STAGE_LABEL: Record<Stage, string> = {
  probe: '영상 확인',
  normalize: '형식 변환',
  transcribe: '음성 인식',
  reference: '레퍼런스 분석',
  purpose: '용도 판단',
  understand: '영상 이해',
  plan: '편집 계획',
  cuts: '컷 계산',
  voice: '목소리 보정',
  track: '사람 위치 추적',
  build: '편집 프로젝트 만들기',
  render: '렌더링',
  mix: '배경음악·효과음 입히기',
  qa: '검수',
  rework: '검수 결과로 다시 작업',
  done: '완료',
}

function fail(message: string, code = 2): never {
  console.error(message)
  process.exit(code)
}

function parse() {
  try {
    return parseArgs({
      options: {
        video: { type: 'string' },
        out: { type: 'string' },
        reference: { type: 'string' },
        description: { type: 'string' },
        purpose: { type: 'string' },
        request: { type: 'string' },
        quality: { type: 'string' },
        captions: { type: 'string' },
        audio: { type: 'string' },
        bgm: { type: 'string' },
        sfx: { type: 'string' },
        'keep-work': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    }).values
  } catch (e) {
    return fail(`${(e as Error).message}\n\n${USAGE}`)
  }
}

async function main() {
  const v = parse()
  if (v.help) {
    console.log(USAGE)
    return
  }
  if (!v.video || !v.out) fail(USAGE)
  if (!fs.existsSync(v.video)) fail(`영상 파일을 찾을 수 없어요: ${v.video}`)
  if (v.purpose && !['auto', 'post', 'short'].includes(v.purpose)) fail('--purpose 는 auto, post, short 중 하나예요')
  if (v.quality && !['draft', 'looks', 'delivery'].includes(v.quality)) fail('--quality 는 draft, looks, delivery 중 하나예요')
  if (v.captions && !['auto', 'off'].includes(v.captions)) fail('--captions 는 auto 또는 off 예요')
  if (v.audio && !['original', 'voice'].includes(v.audio)) fail('--audio 는 original 또는 voice 예요')
  const sound = checkSoundFlags({ bgm: v.bgm, sfx: v.sfx }, loadCatalog())
  if (!sound.ok) fail(sound.message)

  const t0 = Date.now()
  const result = await runEdit({
    videoPath: path.resolve(v.video),
    outDir: v.out,
    reference: v.reference,
    description: v.description,
    purpose: v.purpose as Purpose | 'auto' | undefined,
    request: v.request,
    quality: v.quality as Quality | undefined,
    captions: v.captions as 'auto' | 'off' | undefined,
    audio: v.audio as AudioMode | undefined,
    bgm: sound.bgm,
    sfx: sound.sfx,
    keepWork: v['keep-work'],
    onStage: (s, detail) => console.log(`▶ ${STAGE_LABEL[s]}${detail ? ` — ${detail}` : ''}`),
    onPlan: (card, purpose) => {
      console.log(`\n용도: ${purpose === 'short' ? '릴스·숏츠용(세로)' : '게시물 영상용(가로)'}`)
      for (const line of card) console.log(`  ${line}`)
      console.log('')
    },
  })

  const high = result.qa.findings.filter((f) => f.severity === 'high')
  const medium = result.qa.findings.filter((f) => f.severity === 'medium')
  console.log(`\n✔ 결과: ${result.resultPath}  (${((Date.now() - t0) / 1000).toFixed(0)}초, 작업 ${result.attempts}회)`)
  console.log(`  검수: ${result.qa.passed ? '통과' : '문제가 남아 있어요'} — 중요 ${high.length}건, 확인 ${medium.length}건`)
  for (const f of [...high, ...medium]) console.log(`   ${f.severity === 'high' ? '‼' : '·'} ${f.message}${f.atSec !== undefined ? ` (${f.atSec.toFixed(1)}초)` : ''}`)
  if (result.appliedCorrections.length) console.log(`  자막 교정 ${result.appliedCorrections.length}건을 적용했어요 (report.json 에 기록)`)
  console.log(`  리포트: ${path.join(path.resolve(v.out), 'report.json')}`)
}

main().catch((e: unknown) => {
  if (e instanceof InputError || e instanceof ReferenceFetchError || e instanceof LlmError || e instanceof ToolError || e instanceof VoiceError || e instanceof SoundError) {
    console.error(`\n✖ ${e.message}`)
  } else {
    console.error('\n✖ 예상하지 못한 오류가 났어요')
    console.error(e)
  }
  process.exit(1)
})
