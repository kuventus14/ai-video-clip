# 막혔을 때

먼저 저장소에서 `npm run setup` 을 실행해요. 빠진 프로그램과 **이 컴퓨터에 맞는** 설치 명령을 알려 줘요. 그 밖의 경우:

| 증상 | 원인 → 할 일 |
|---|---|
| `앱이 꺼져 있어요` | `AF app up`. 오래 걸리면 처음 빌드 중이에요(1~3분). 로그는 `AF app up` 이 알려 준 파일 |
| 포트 4848 을 이미 쓰고 있다 | 이미 앱이 켜져 있거나 다른 프로그램이에요. 다른 포트: 맥·리눅스 `VAE_PORT=4949`, 윈도우 PowerShell `$env:VAE_PORT=4949` 를 앞에 붙여 `AF` 와 `npm run app` 을 같은 값으로 |
| `Not logged in · Please run /login` | Claude Code 로그인이 안 된 거예요. **사용자가 직접** 터미널에서 `claude` 를 실행해 로그인해요 |
| 분석이 시작되지 않고 "대기"가 20초 넘게 | 처리 프로그램(워커)이 꺼져 있을 수 있어요. 앱을 `npm run app`(또는 `AF app up`)으로 켜야 둘이 같이 떠요 |
| 음성 인식 모델이 없다 | `npm run setup` 이 알려 주는 받기 명령(약 465MB)을 실행해요 |
| `whisper-cli`·`hyperframes`·`yt-dlp` 를 못 찾는다 | 설치 뒤 **새 터미널**을 열어야 PATH 가 갱신돼요(윈도우). 안내는 `docs/install-windows.md` |
| 윈도우에서 `npm` 이 "스크립트 실행이 비활성화" | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` 한 번, 또는 명령 프롬프트(cmd)에서 |
| 목소리 보정이 "설치돼 있지 않아요" | `deep-filter` 가 없어요. 설치 안내의 "목소리 보정 설치"를 하거나 `--audio original` 로 가요 |
| `음원 목록`·곡을 찾을 수 없다 | 음악 파일은 저장소에 없어요. `assets/sound/README.md` 대로 넣거나 `--bgm none` |
| 영상을 올리면 "형식·길이" 오류 | 1초~10분, mp4·mov·m4v·webm·mkv·avi 만 돼요. 긴 영상은 아직 줄여 주지 못해요 |
| 제작이 실패 / "중단됐어요" | 앱이 꺼졌거나 맥이 잠든 거예요. `AF retry <id>` |
| 윈도우에서 `Ctrl+C` 로 껐더니 작업이 "중단됐어요" | 윈도우는 끝까지 기다렸다 끌 수 없어요. `AF retry <id>` |
| 한글 폴더 이름 | 지원해요(윈도우의 음성 인식은 임시 파일을 영어 이름 폴더에 둬요). 그래도 안 되면 영어 이름 폴더로 옮겨 시도해 보고 알려 주세요 |

자세한 설치·실행·확인한 범위는 저장소 `README.md` 와 `docs/install-mac.md` · `docs/install-windows.md`.
