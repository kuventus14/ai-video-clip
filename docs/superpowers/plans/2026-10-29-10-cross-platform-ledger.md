# Ledger — plan: docs/superpowers/plans/2026-10-29-10-cross-platform.md
Branch: cross-platform (from main d231679). Executor: inline; final review: fresh Opus reviewer over the whole branch. Evidence: GitHub Actions on windows-latest / ubuntu-latest / macos-latest (the author has no Windows PC).
Why: 사용자 요청 2026-10-29 "맥이 아니라 윈도우나 어떤 컴퓨터에서도 되게 만들어줘 맥 없는 사람들은 못쓰는거잖아". 사용자는 윈도우 PC 로 직접 못 돌려 보고, hyperframes·whisper-cli 는 윈도우를 지원한다고 알고 있음 → "그냥 해".
Result: 맥 전용이던 곳(PATH 조립·도구 찾기·claude 호출 환경·앱 실행기·설치 안내·deep-filter 찾기)을 `src/core/platform.ts` 의 순수 함수(플랫폼을 인자로 받음)로 모으고, CI 세 OS 에서 시험. 세 OS 모두 통과(윈도우 1236개): 실제 ffmpeg, hyperframes check + draft 렌더(hyperframes.cmd 를 shell 로), 실제 whisper-cli(tiny 모델; 윈도우·리눅스), 앱 전체 켜기(`tests/app.e2e.test.ts`: 런처→next build/start→워커→영상 올리기→ffprobe→ready→종료→포트 해제), 한글·공백 경로의 .cmd 와 whisper-cli(윈도우).
Not verified on Windows: 진짜 `claude` 호출, yt-dlp, deep-filter 목소리 보정, 사람이 화면을 쓰는 것, 한국어 로캘/사용자 폴더 이름이 한글인 PC(CI 는 영어 로캘·RUNNER~1), Ctrl+C 경로(e2e 는 외부 taskkill).

## CI 가 먼저 알려 준 것
- 첫 실행: 세 OS 모두 실패 — hyperframes 미설치(→ CI 에 `npm i -g hyperframes`), 맥 전용 사람 인식(swiftc) 시험(→ skipIf 맥 아님), 윈도우: shebang 가짜 claude 실행 불가(→ spawnPlan 이 .js/.mjs 를 node 로 연다), 경로 구분자·`path.join` 비교 시험.
- `next dev` 는 next-server 자식을 따로 띄워 SIGTERM 에 남는다 → e2e 는 사용자가 쓰는 프로덕션(`npm run app`) 모드.
- whisper-cli(윈도우, 영어 로캘 러너): 한글이 든 임시 폴더 경로가 `?` 로 깨져 "input file not found" — 리뷰어 예측이 맞았음 → `whisperPaths`(임시 파일은 영어 이름 폴더 C:\Users\Public, 모델은 작업 폴더+파일 이름).
- CI 의 윈도우 작업이 모델 내려받기 단계에서 28분 멈춘 적이 있음(일시적, 취소 후 재실행 통과). timeout-minutes: 40 를 걸어 둠.

## 최종 리뷰(Opus, 2026-10-29): Critical 0 · Important 6 · Minor 9 — 판정 "수정 후 병합"
Fixed: 
- I1 `scripts/web.mjs` 가 종료 신호를 next 에 안 넘겨 `npm run web:dev` 를 SIGTERM 으로 끄면 next 가 포트를 잡은 채 남음(맥·리눅스 회귀) → `forwardSignals` + 시험.
- I2 윈도우에서 `detached` 는 DETACHED_PROCESS 라 windowsHide 가 무시되고 Next 의 하위 도구마다 검은 창 → `childSpawnOptions`(윈도우는 detached 없이 숨김 콘솔) + 시험.
- I3 콘솔 창을 닫으면(SIGHUP) 자식이 보이지 않게 남음 → `createHangupHandler` + 시험.
- I4 윈도우 whisper-cli 가 한글 경로를 못 읽음 → CI 에서 재현해 `whisperPaths` 로 해결(위).
- I5 윈도우는 열린 파일을 못 바꾸고 못 지움 → 다시 섞기의 rename 을 `renameWithRetry`(EPERM·EBUSY·EACCES 재시도), 작업 삭제 `rmSync` 에 maxRetries.
- I6 PowerShell 기본 실행 정책이 `npm` 을 막음 → README 에 한 줄.
- Minor: DEP0190 경고(shell 이면 한 줄 글자로 `spawnArgs`), .cmd 인자 따옴표(역슬래시로 끝나는 인자 두 배, 줄바꿈 거절), PATHEXT 는 .com/.exe/.bat/.cmd 만, Linux PATH 는 사용자 PATH 를 앞에, README 확인 범위 문구, 빈 VAE_PORT, Get-FileHash 확인을 실패하면 throw, CI(permissions: contents: read, persist-credentials: false, timeout-minutes, curl -f, 낡은 주석).
Rulings:
- 윈도우 `--prompt`(한글 힌트)는 막지 않는다 — 한국어 윈도우(CP949)에서는 되고 힌트가 인식 품질에 도움이 됨. 영어 로캘에서는 힌트가 깨질 뿐 실패하지는 않음(CI 시험: 한글 힌트로 통과). 비용: 비한국어 윈도우에서 힌트 효과 없음.
- 윈도우에서 종료는 신호가 없어 한 번에 바로 끈다(진행 중 작업은 "중단됐어요"). README 에 적음.
- `.cmd` 실행은 shell 로(npm 전역 도구가 .cmd). 앱이 정한 인자만 넘기고 사용자 글은 넘기지 않음(claude 프롬프트는 stdin, claude 는 .exe).
Deferred minors:
- taskkill 을 PATH 가 아니라 %SystemRoot%\System32 로 지정; 런처의 Ctrl+C 안내문("처리 중인 작업이 있으면 끝날 때까지 기다려요")이 윈도우에서는 사실과 다름, 포트 안내는 PowerShell 문법만; `NOT_NEEDED` 가 env.ts·setup.ts 에 중복, `envValue`·`getEnv` 중복; `.gitattributes` 에 앞으로 생길 .cmd/.bat/.ps1 은 CRLF; Linux 용 claude 설치 명령(install.sh) 안내; cleanEnv 에 프록시·CA 변수(HTTP(S)_PROXY, NODE_EXTRA_CA_CERTS, CLAUDE_CONFIG_DIR) 없음(맥도 같음); CI 의 `npm i -g hyperframes`·whisper 릴리스(b5454)·HF 모델 해시 검사 없음; whisper-bin-x64.zip 은 VC++ 런타임이 필요할 수 있음(미확인); 윈도우에서 Claude Code 가 --tools '' 여도 git-bash 를 찾는지 미확인.

## 병합 뒤 추가 확인 (사용자 요청 "윈도우에서 아직 확인하지 못한 것 확인해 줄 수 없어?", 2026-10-29, 브랜치 windows-verify)
워크플로 `.github/workflows/external-check.yml`(수동 실행 또는 windows-verify 브랜치 push, windows-latest + ubuntu-latest), 시험 `tests/external.test.ts`(VAE_EXTERNAL=1)·`tests/app.ui.e2e.test.ts`(VAE_UI_E2E=1, playwright 는 CI 에서 `npm i --no-save`).
Windows 결과(Linux 도 같게 통과): yt-dlp 2026.10.26 실제 검색 40개 · deep-filter 0.5.6(README 명령 그대로 설치+해시 OK)으로 `enhanceVoice` 3.6초, 길이 유지, 소리 있음 · Claude Code 2.1.312 를 `~/.local/bin` PATH 추가 없이 우리 코드가 찾아 `cleanEnv` 로 실행, 로그인 없이 호출하면 "Not logged in · Please run /login"(실행·인자 `--tools ''`·git-bash 문제 없음) · Chromium 으로 /new 에서 영상 올리기 → "분석 시작" 활성, 화면 오류 0개, 캡처(한글 글꼴 포함)가 맥과 같음.
못 한 것: 로그인한 AI 응답(토큰 필요 — CI 에 넣지 않음), 한국어 로캘(시스템 언어를 못 바꿈), Ctrl+C 경로, 사람이 쓰는 것.
