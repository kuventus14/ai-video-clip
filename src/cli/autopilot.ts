import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { DEFAULT_ROOT, ensureFolders, FOLDERS, loadConfig } from '../autopilot/config.ts'
import { listVideos } from '../autopilot/folders.ts'
import { LAUNCHD_LABEL, LAUNCHD_PLIST, launchdPlist } from '../autopilot/launchd.ts'
import { accept, listPending, redo, reject, ReviewError, setDefaultReference } from '../autopilot/review.ts'
import { defaultDeps, pickReference, processVideo, watch } from '../autopilot/run.ts'
import { runEdit } from '../core/pipeline.ts'

const USAGE = `영상 넣으면 자동 편집 → 검토(수락·거절·다시 만들기)
사용법: npm run autopilot -- [명령] [--root <폴더>]

  (명령 없음)   '${FOLDERS.inbox}' 폴더를 지켜보며 영상이 들어오면 편집해요 (Ctrl+C 로 멈춤)
  once         지금 '${FOLDERS.inbox}' 폴더에 있는 영상만 편집하고 끝나요
  review       '${FOLDERS.done}' 폴더에서 검토를 기다리는 영상을 보여 줘요 (--json: 기계용)
  accept <파일>  수락: '${FOLDERS.accepted}' 폴더로 옮기고 '${FOLDERS.reference}' 폴더에 복사해요 (업로드를 켜 두었으면 올려요)
  reject <파일>  거절: 결과를 치워요 (원본은 보관)
  redo <파일> [--note "고칠 점"]  다시 만들기: 원본을 '${FOLDERS.inbox}' 폴더로 돌려놓아요
  set-default-reference <영상>  '${FOLDERS.reference}' 폴더가 비었을 때 따라 할 기본 레퍼런스를 정해요
  install      맥을 켜면 자동으로 지켜보게 등록해요 (터미널을 닫아도 계속 돌아요)
  uninstall    자동 실행을 해제해요
  --root <폴더>  자동 편집 폴더 (기본: ${DEFAULT_ROOT})

업로드 연결: npm run connect -- youtube | instagram | status
`

const REPO = path.resolve(import.meta.dirname, '..', '..')

function install(root: string) {
  if (process.platform !== 'darwin') {
    console.log('자동 실행 등록은 맥에서만 돼요. 이 컴퓨터에서는 터미널에서 npm run autopilot 을 켜 두세요.')
    return
  }
  fs.mkdirSync(path.dirname(LAUNCHD_PLIST), { recursive: true })
  fs.writeFileSync(LAUNCHD_PLIST, launchdPlist({ node: process.execPath, repo: REPO, root, path: process.env.PATH ?? '/usr/bin:/bin', home: os.homedir() }))
  const uid = String(process.getuid?.() ?? '')
  try {
    execFileSync('launchctl', ['bootout', `gui/${uid}/${LAUNCHD_LABEL}`], { stdio: 'ignore' })
  } catch {}
  execFileSync('launchctl', ['bootstrap', `gui/${uid}`, LAUNCHD_PLIST])
  // 바탕화면에 바로가기(맥은 바탕화면 폴더를 백그라운드 프로그램이 못 읽게 막아서, 진짜 폴더는 홈에 두고 바로가기만 놓는다)
  const shortcut = path.join(os.homedir(), 'Desktop', path.basename(root))
  if (!root.startsWith(path.join(os.homedir(), 'Desktop')) && !fs.existsSync(shortcut)) {
    try {
      fs.symlinkSync(root, shortcut)
      console.log(`바탕화면에 '${path.basename(root)}' 바로가기를 만들었어요.`)
    } catch {}
  }
  console.log(`✔ 등록했어요. 이제 '${path.join(root, FOLDERS.inbox)}' 에 영상을 넣으면 알아서 편집해요.`)
  console.log(`  진행 기록: ${path.join(root, FOLDERS.work, 'autopilot.log')}`)
}

function uninstall() {
  if (process.platform !== 'darwin') return
  try {
    execFileSync('launchctl', ['bootout', `gui/${process.getuid?.()}/${LAUNCHD_LABEL}`], { stdio: 'ignore' })
  } catch {}
  fs.rmSync(LAUNCHD_PLIST, { force: true })
  console.log('✔ 자동 실행을 해제했어요. (폴더와 영상은 그대로예요)')
}

async function main() {
  const { values: v, positionals } = parseArgs({
    allowPositionals: true,
    options: { root: { type: 'string' }, note: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
  })
  if (v.help) return console.log(USAGE)
  const root = path.resolve(v.root ?? DEFAULT_ROOT)
  const cmd = positionals[0] ?? 'watch'
  ensureFolders(root)
  // 설정 파일이 없으면 만들고, 잘못됐으면 바로 알려 준다(지켜보기 중에는 기록에 남기고 고칠 때까지 기다린다)
  if (cmd !== 'watch') loadConfig(root)

  if (cmd === 'install') return install(root)
  if (cmd === 'uninstall') return uninstall()
  const deps = defaultDeps(runEdit)
  const target = positionals.slice(1).join(' ')
  const needTarget = () => {
    if (!target) throw new ReviewError(`파일 이름을 적어 주세요. 예: npm run autopilot -- ${cmd} "스윙_릴스.mp4"`)
    return target
  }
  if (cmd === 'review') return review(root, Boolean(v.json))
  if (cmd === 'accept') {
    const r = await accept(root, needTarget(), deps)
    console.log(`✔ 수락했어요: ${r.acceptedPath}`)
    console.log(`  레퍼런스에도 넣었어요: ${r.referencePath} (다음 편집부터 이 영상을 따라 해요)`)
    for (const [k, u] of Object.entries(r.upload)) console.log(`  ${k === 'youtube' ? '유튜브' : '인스타그램'}: ${u.ok ? ('url' in u ? u.url : u.id) : `실패 — ${u.error}`}`)
    return
  }
  if (cmd === 'reject') {
    reject(root, needTarget())
    return console.log('✔ 거절했어요. 결과를 치웠고 원본은 보관해 두었어요.')
  }
  if (cmd === 'redo') {
    const back = redo(root, needTarget(), v.note)
    return console.log(`✔ 다시 만들게요: ${back}${v.note ? `\n  고칠 점: ${v.note}` : ''}\n  자동 실행이 켜져 있으면 곧 편집을 시작해요(아니면 npm run autopilot -- once).`)
  }
  if (cmd === 'set-default-reference') {
    const dest = setDefaultReference(root, path.resolve(needTarget()))
    return console.log(`✔ 기본 레퍼런스로 정했어요: ${dest}\n  '${FOLDERS.reference}' 폴더가 비어 있을 때 이 영상을 따라 해요.`)
  }
  if (cmd === 'once') {
    const videos = listVideos(path.join(root, FOLDERS.inbox))
    if (!videos.length) console.log(`'${FOLDERS.inbox}' 폴더에 영상이 없어요.`)
    for (const f of videos) await processVideo(root, f, deps)
    return
  }
  if (cmd !== 'watch') return console.log(USAGE)
  let stopping = false
  process.on('SIGINT', () => (stopping ? process.exit(130) : ((stopping = true), console.log('\n지금 하던 영상까지만 마치고 멈춰요(바로 끄려면 한 번 더 Ctrl+C).'))))
  process.on('SIGTERM', () => process.exit(0))
  await watch(root, deps, { stop: () => stopping })
}

function review(root: string, json: boolean) {
  const items = listPending(root)
  const ref = pickReference(root, loadConfig(root))
  if (json) return console.log(JSON.stringify({ root, nextReference: ref ?? null, pending: items }, null, 2))
  console.log(`다음 편집에 쓸 레퍼런스: ${ref ? path.basename(ref) : '없음(앱 기본 스타일)'}`)
  if (!items.length) return console.log(`'${FOLDERS.done}' 폴더에 검토를 기다리는 영상이 없어요.`)
  for (const [k, p] of items.entries()) {
    console.log(`\n${k + 1}. ${p.name}${p.failed ? ' (편집 실패)' : ''}`)
    if (p.title) console.log(`   제목: ${p.title}`)
    if (p.failed) console.log(`   이유: ${p.failed}`)
    if (p.reference) console.log(`   따라 한 레퍼런스: ${p.reference}`)
    if (p.qaHigh?.length) console.log(`   검수에서 나온 중요 문제: ${p.qaHigh.join(' / ')}`)
    console.log(`   파일: ${p.path}`)
  }
  console.log(`\n수락: npm run autopilot -- accept "파일이름"   거절: reject   다시 만들기: redo "파일이름" --note "고칠 점"`)
}

main().catch((e: unknown) => {
  console.error(`\n✖ ${(e as Error).message ?? e}`)
  process.exit(1)
})
