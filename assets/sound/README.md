# 배경음악·효과음 (이 폴더)

저작권 때문에 **음원 파일은 이 저장소에 넣지 않았어요.** 음악 없이도 앱은 그대로 돌아가요(계획 승인 화면에 "음원이 아직 없어요"라고 나와요).
음악을 쓰고 싶으면 **내려받는 사람이 직접** 음원을 넣어요. 음원마다 라이선스가 다르니 쓰기 전에 각 사이트의 약관을 확인하세요.

## 넣는 법
1. 쓸 음원 파일을 이 폴더 아래에 둬요: 배경음악은 `bgm/`, 효과음은 `sfx/` (mp3·wav 모두 가능).
2. `sources.example.json` 을 `sources.json` 으로 복사하고, 곡마다 항목을 적어요.
   - `kind`: `bgm` 또는 `sfx`
   - `id`: 소문자·숫자·하이픈 (곡마다 달라야 해요)
   - `file`: 이 폴더 안의 파일 경로
   - `title`·`author`·`sourceUrl`(https 주소)·`license`: 출처 표시용. `license` 는 `CC0`, `Pixabay License`, `Mixkit Free License` 중 하나
   - 배경음악은 `mood`(`calm`·`bright`·`energetic`), 효과음은 `role`(`whoosh`·`pop`·`impact`·`click`·`ding`)
3. 터미널에서 `npm run sound:measure` — 곡마다 길이·음량을 재서 `manifest.json` 과 `CREDITS.md` 를 만들어요. 앱을 다시 켜면 곡 목록에 나와요.

`sources.json`·`manifest.json`·`CREDITS.md`·`bgm/`·`sfx/` 는 `.gitignore` 에 들어 있어서 실수로 저장소에 올라가지 않아요.
효과음은 컷이 바뀔 때(`whoosh`)와 제목 카드가 나올 때(`pop`) 쓰여요. 배경음악은 목소리보다 작게, 말할 때는 자동으로 더 작게 깔려요.
