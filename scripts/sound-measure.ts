import { writeManifest } from '../src/core/soundManifest.ts'
import { loadCatalog, SoundError, soundDir } from '../src/shared/sound.ts'

// assets/sound/sources.json(제목·작가·출처·라이선스)에 길이·음량을 재어 manifest.json 과 CREDITS.md 를 만든다.
// 음원을 더 넣으려면: 파일을 두고 → sources.json 에 항목을 적고 → npm run sound:measure
const dir = soundDir()
try {
  await writeManifest(dir)
  const c = loadCatalog(dir) // 만든 목록을 앱이 읽는 그대로 한 번 더 검증한다
  console.log(`${dir}\n  배경음악 ${c.bgm.length}곡, 효과음 ${c.sfx.length}개 — manifest.json·CREDITS.md 를 만들었어요`)
} catch (e) {
  if (e instanceof SoundError) {
    console.error(`✖ ${e.message}`)
    process.exit(1)
  }
  throw e
}
