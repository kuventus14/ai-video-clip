# SDD ledger — plan: docs/superpowers/plans/2026-10-20-02-app-flow.md
Spec: docs/superpowers/specs/2026-10-20-video-autoeditor-design.md (reachable, read). 앞선 계획 장부: docs/superpowers/plans/2026-10-20-01-edit-core-ledger.md
Setup: Ruling: 브랜치 `app-flow`(edit-core 에서 분기)에서 작업, main 병합은 사용자 확인 전까지 보류 — 사용자가 계획 승인 시 브랜치 방침을 그대로 두라고 함 — 비용: 없음
Pre-flight: T2 shared/types.ts(JobStatus·Phase·Recommendation) → T4 core/search.ts 가 Recommendation 을 shared 에서 가져옴 — core→shared 방향은 경계 규칙(T1)이 허용(shared·db·web·ui 는 core/worker 를 안 가져옴) — 일치.
Pre-flight: T2 QUEUED_TO_RUNNING·PHASE_OF·QUEUED_OF → T5 워커, T7 retry — 이름 일치.
Pre-flight: T3 Analysis/Prepared(JSON) → T5 가 analysis.json·prepared.json 으로 저장·읽음, T7 other-version 이 같은 파일명을 복사 — 파일명 analysis.json·prepared.json 으로 고정.
Pre-flight: T5 probe 가 `ready` 로 보냄 ↔ T6 PUT video 는 `created` 에서만 허용, T7 start 는 `ready` 에서만 — 일치.
Pre-flight: T7 approve 가 captionsMode·quality 를 job 에 기록 ↔ T5 produce 가 job.captionsMode·job.quality 를 읽음 — 일치.
Pre-flight: T3 Prepared.referenceSource ↔ T5 plan 단계가 이전 prepared.json 의 referenceSource 와 비교해 knownSpec 재사용 — 일치.
Pre-flight: T7 other-version ↔ T6 DELETE: 자식 작업의 analysis.json 은 부모 작업 폴더의 절대 경로(sourcePath, 정규화 파일 source-h264.mp4)를 가리킴 — 부모를 삭제하면 자식이 깨짐 → **불일치**. Ruling: other-version 이 analysis.json 의 sourcePath 가 부모 jobDir 안이면 같은 상대 이름의 파일을 자식 jobDir 로 하드링크(안 되면 복사)하고 sourcePath 를 자식 경로로 다시 쓴다 — 비용: 하드링크라 디스크 증가 없음(복사 폴백 시 증가).
Pre-flight: T2 Job.summary: unknown ↔ T6 JobDto.summary 구체 타입 — toJobDto 가 zod 로 좁혀서 변환(알 수 없는 모양이면 null) — 일치.
Pre-flight: T8 stepForJob(job) 는 {status, failedPhase} 만 요구 → JobDto 와 호환 — 일치.
Task 1: Ruling: .claude/launch.json 에 계획이 적은 'worker' 구성을 넣지 않음 — launch.json 구성은 포트가 필요한데 워커는 포트가 없음(preview_start 용). 워커는 터미널 명령으로 실행 — 비용: 없음
Task 1: Ruling: src/core/llm.ts cleanEnv 의 빈 환경을 `{} as NodeJS.ProcessEnv` 로 바꿈 — Next 의 타입 정의가 ProcessEnv 에 NODE_ENV 를 필수로 추가해 web:build 의 타입 검사가 실패함. 동작 변화 없음 — 비용: 없음
Task 1: 메모: Write 가 tsconfig.json 을 거부(이전 복구로 파일이 바뀐 상태)해 Next 가 먼저 자동 수정함 → 그 결과를 Edit 으로 의도한 설정(module esnext·bundler, include app·components 추가)으로 고침. tsconfig.tsbuildinfo 도 .gitignore
Task 1: complete (commits 338f78d..94cfd01, tests: npx vitest run →    Duration  29.20s (tests 97%, import 2%))
Task 2: complete (commits 94cfd01..8405936, tests: npx vitest run →    Duration  34.95s (tests 97%, import 2%))
Task 3: Ruling: Prepared 에 purposeChoice·purposeGuess 를 추가 — report.json 의 purpose.userChoice·guess 가 produce 단계에서 필요하고, 레퍼런스가 정해진 뒤 prepare 에서 용도를 다시 정하므로 그 추정값을 보관해야 함 — 비용: 필드 둘
Task 3: Ruling: 계획의 produceEdit.onPlan 입력은 만들지 않음(runEdit 이 prepare 직후에 o.onPlan 호출) + produceEdit 에 선택 입력 workDir 추가(주면 그것을 쓰고 지우지 않음, 안 주면 outDir 안에 .vae-work-* 를 만들고 keepWork 가 아니면 지움) — 앱은 분석·계획·제작을 따로 부르고 CLI 는 작업 폴더 하나를 공유해야 해서 — 비용: 입력 하나
Task 3: Ruling: knownSpec 만 있고 레퍼런스 파일 정보가 없을 때 spec.orientation 으로 레퍼런스 크기를 대신해(portrait→1080x1920 등) 자동 용도를 판단 — 앱의 재계획(용도 바꾸기·같은 레퍼런스 재사용)에서 레퍼런스를 다시 받지 않기 위해 — 비용: 파일 기반 판단과 비율이 정확히 같지 않을 수 있음(방향만 반영)
Task 3: complete (commits 8405936..9d6b9f1, tests: npx vitest run →    Duration  29.83s (tests 97%, import 2%, transform 1%))
Task 4: 실제 유튜브 검색(INTEGRATION=1) 통과 — 질의 '롱아이언 레슨'(short) 결과 1개 이상, 모두 180초 이하, 조회수 내림차순
Task 4: complete (commits 9d6b9f1..6b5dff3, tests: npx vitest run →    Duration  28.68s (tests 96%, import 3%, transform 1%))
Task 5: Ruling: pipeline.ts 에 assertDurationOk(길이 1초~10분 검사)를 export 해 analyzeInput 과 워커 probe 단계가 같은 기준·같은 메시지를 쓰게 함(기존 시험 통과, 워커 시험 추가) — 올리자마자 10분 초과를 알려 주려고 — 비용: 없음. 워커 probe 는 InputError 로 failed(probe) 로 보냄
Task 5: 실제 워커 프로세스 확인 — 시작 로그, SIGINT 에 '진행 중인 작업을 끝내고 종료' 후 프로세스 종료, app.db(WAL) 생성
Task 5: complete (commits 6b5dff3..18f33bf, tests: npx vitest run →    Duration  29.61s (tests 96%, import 3%, transform 1%))
Task 6: Ruling: 계획의 Files 에 있던 src/web/schemas.ts 는 이 작업에서 만들지 않고 Task 7(요청 본문 검증이 처음 필요한 곳)에서 만듦 — 이 작업의 라우트는 본문 JSON 이 없음. 업로드 저장 도우미 saveUpload/uploadFailure/allowedExt/loadJob 는 src/web/http.ts 에 둠(계획은 파일 구성만 정함) — 비용: 없음
Task 6: Ruling: 레퍼런스 파일 업로드는 실행 중(probing·analyzing·planning·producing) 상태에서만 거절하고 그 밖의 상태에선 허용 — 계획 문구가 허용 상태를 정하지 않았고 레퍼런스는 ready·awaiting_*·failed(plan) 어디서든 바꿀 수 있어야 함 — 비용: 대기(queued_*) 중 교체는 허용(워커가 집기 전이라 문제 없음, 집은 뒤엔 실행 중으로 거절)
Task 6: 실제 서버 확인(next start, 임시 데이터 폴더) — 400MB 업로드(한글·공백·괄호 이름) 서버 최대 RSS 156MB, 디스크 source.mov 419430400바이트, Range 206 content-range 'bytes 100-199/419430400', 전체 내려받기 md5 일치, 다른 Origin POST 403
Task 6: complete (commits 18f33bf..de13b50, tests: npx vitest run →    Duration  28.41s (tests 96%, import 3%, transform 1%))
Task 7: Ruling: start·plan 의 reference 는 http(s) 링크·'uploaded'·비움 만 받고 그 밖의 문자열(내 컴퓨터의 경로·file://)은 400 — 계획은 '링크/경로' 라고만 적었는데, 웹 요청으로 임의의 로컬 파일을 편집 엔진(복사·분석)에 넣는 것은 불필요한 위험 — 비용: 로컬 파일 레퍼런스는 반드시 올려서(reference-file) 써야 함(CLI 는 그대로 경로 허용)
Task 7: other-version 은 Pre-flight 의 판단대로 구현 — analysis.json 의 sourcePath·info.path 가 부모 폴더 안이면(변환본 source-h264.mp4 포함) 자식 폴더로 하드링크하고 경로를 다시 씀, 부모를 지워도 자식 파일이 남는 것을 시험으로 확인. 새 작업은 상태 기계를 거치지 않고 queued_plan 으로 직접 씀(created→queued_probe 만 허용되므로)
Task 7: complete (commits de13b50..6c7d9fb, tests: npx vitest run →    Duration  29.06s (tests 95%, import 4%, transform 1%, worker 1%))
Task 8: complete (commits 6c7d9fb..783bcc1, tests: npx vitest run →    Duration  28.74s (tests 95%, import 3%, transform 1%))
Task 8: Ruling: impeccable 의 인터뷰·결정 페이지를 건너뜀 — 승인된 계획이 방향(도구형 앱, 시스템 글꼴, 영상이 주인공)을 이미 정했고 사용자가 멈추지 않는 실행을 요청함. PRODUCT.md 는 설계 문서에서 옮기고 추정 항목은 "(추정)" 표시 — 사용자가 나중에 바꾸고 싶으면 PRODUCT.md·design-notes 만 고치면 됨
Task 8: Ruling: lucide-react 의존성 추가(아이콘 한 벌) — 직접 그린 SVG 여러 개보다 일관됨, 번들은 import 한 것만 포함 — 비용: 의존성 1개
Task 8: Ruling: 계획에 없던 것 추가 — src/ui/poller.ts(폴링 로직을 훅에서 분리해 가짜 타이머로 시험), Skeleton 컴포넌트(스켈레톤 로더 요구), uploadReferenceFile, src/shared/types.ts 의 StartInput/PlanInput/ApproveInput(API 계약), --field-line 토큰(컨트롤 테두리 비문자 대비 3:1) — 모두 이후 Task 가 쓴다
Task 8: Ruling: formatKoreanDate 는 해가 다르면 "2025년 12월 31일" 로 연도를 붙임(계획은 "10월 18일" 만 언급) — 해를 넘긴 기록이 모호해지지 않도록
Task 8: Ruling: Field 는 'use client' 를 붙이지 않음 — render-prop(children 함수)을 서버 컴포넌트에서 넘길 수 있어야 함(붙이면 prerender 오류가 났음). useId 는 서버 컴포넌트에서도 동작
Task 8: Ruling: preview_start(name) 이 세션 시작 폴더(~/Desktop)의 launch.json 을 읽어 web-demo 를 못 찾았음(턴이 끝나야 작업 폴더가 옮겨짐) — 이 턴에서는 Bash 백그라운드로 `VAE_DATA_DIR=data-demo npm run web:dev` 를 띄우고 preview_start({url}) 로 확인한 뒤 종료함. Desktop/.claude/launch.json 은 건드리지 않음. 이후 Task 도 필요하면 같은 방법, 끝나면 서버를 꼭 끈다
Task 8: Ruling: src/web/context.ts 에 /*turbopackIgnore: true*/ 추가(경고만 사라지는 변경, 동작 불변), tsconfig include 에 scripts 추가, `next dev` 가 만든 AGENTS.md 를 같이 커밋(안 하면 매번 다시 생김)
Task 8: 눈으로 확인 — 라이트 1024(창 한계)·다크 1024·다크 모바일 375 스크린샷, 콘솔 오류 0, impeccable detect 0건. 1280 은 창이 1024 라 스크린샷 대신 scrollWidth(1269<1280) 로 가로 넘침 없음만 확인
Task 9: complete (commits 783bcc1..6cbe844, tests: npx vitest run →    Duration  27.61s (tests 96%, import 3%, transform 1%))
Task 9: Ruling: 카드의 "길이"를 위해 워커 producePhase 가 결과 영상을 probeVideo 로 재서 report.output{durationSec,width,height} 에 붙이고 DTO 에 resultInfo 를 추가함(계획에 없던 변경, RED→GREEN 시험 3개) — 원본 길이(sourceInfo)는 컷 뒤 길이와 달라 틀린 값을 보이게 됨. 못 재면 resultInfo=null 로 길이만 비고 작업은 실패하지 않음 — 비용: 워커에 ffprobe 한 번 더
Task 9: Ruling: format.ts 에 NEXT_ACTION(내 차례 문구)·progressState 추가, Button size 'icon' 추가, Steps compact 는 role=img 한 문장으로 읽음 — 행마다 여섯 칸을 읽으면 너무 길어서
Task 9: 눈으로 확인 — 데모 9개(진행 중 7·확정 2) 라이트/다크 1024, 모바일 375(가로 넘침 0), 빈 상태(빈 데이터 폴더로 서버 재시작), 서버 중단 시 새로 읽기 실패 안내 배너, Tab 순서·카드 포커스 링, 삭제 대화상자(Esc 닫힘·포커스 복귀·키보드 삭제 후 목록에서 사라짐, DELETE 200), 카드 href=/jobs/<id>, 이미지 9/9 로드, impeccable detect 0건. 초기 읽기 실패 화면(jobs=null)은 서버를 끈 채 첫 로드를 못 해 코드로만 확인
Task 10: complete (commits 6cbe844..69c791f, tests: npx vitest run →    Duration  27.60s (tests 95%, import 3%, transform 1%))
Task 10: Ruling: 실제 확인 중 발견한 결함 — 영상이 아닌 파일을 올리면 화면에 ffprobe 원문(서버의 절대 경로·영어 오류)이 그대로 떴음(Task 5 describeError 가 ToolError 를 통과시켰음). 워커 describeError 에서 ToolError 는 안내 문구만 화면용으로 쓰고 원문은 진행 기록에 남기도록 고침(시험 2개 RED→GREEN). CLI(src/cli/edit.ts)는 그대로
Task 10: Ruling: 확장자 허용 목록을 src/shared/media.ts(videoExtOf)로 옮기고 http.ts 가 같은 함수를 씀 — 화면이 통과시킨 파일을 서버가 거절하는 불일치를 시험(allowedExt 와 같은 판단)으로 묶음
Task 10: Ruling: 업로드 중 페이지를 떠나면(pagehide) keepalive DELETE 로 작업을 지움 — "올리는 중" 상태의 쓰레기 작업이 기록에 남지 않게. 업로드를 끝낸 뒤 시작하지 않고 떠난 작업은 ready 로 남아 기록에서 이어서 시작할 수 있음(→ Task 11 의 작업 화면이 ready 상태에서 시작 폼을 보여 줘야 함)
Task 10: Ruling: 계획의 "세그먼트"는 단일 컬럼(760px)의 3칸 세그먼트로 구현, 업로드 영역·설명·용도·레퍼런스·시작 막대(고정, 테두리 패널) 순서. 레퍼런스 파일 첨부는 영상을 먼저 올려 작업이 생긴 뒤에만 가능(그 전에는 안내 문구)
Task 10: 눈으로 확인 — ① 진행 막대(2→97 값이 계속 갱신, 700MB) ② 실제 샘플(한글 파일명, 17.6MB) 업로드→자동 인식 "릴스·숏츠용(세로) — 영상이 세로 비율이에요" 선택됨 ③ 가로 8초 합성→"게시물 영상용(가로)"+확신 낮음 권유 ④ 직접 릴스·숏츠 선택→분석 시작→API 의 purposeChoice=short·설명·레퍼런스 저장, /jobs/<id> 로 이동 ⑤ .txt 는 클라이언트에서 거절(작업 생성 없음) ⑥ 업로드 중 취소→작업 삭제, 새로고침(진행 중)→작업·폴더 남지 않음 + 가짜 mp4→읽을 수 없다는 안내, 처리 프로그램 꺼짐 안내(15초) , 잘못된 링크 검사, 모바일 375 다크 가로 넘침 0, impeccable detect 0건. 1280 은 창이 1024 라 스크린샷 못 찍음. 시작은 워커를 끈 채 눌러 분석은 돌리지 않았으나, 워커를 다시 켜는 순간 대기 중이던 그 작업이 실제로 계획 단계까지 돌아 레퍼런스(가짜 링크)에서 실패함(의도치 않은 실행, 영향 없음)
Task 11: complete (commits 69c791f..0aec2c4, tests: npx vitest run →    Duration  29.77s (tests 96%, import 3%, transform 1%))
Task 11: Ruling: "경과 시간"을 위해 jobs.status_changed_at 컬럼(마이그레이션 2번, 기존 행은 updated_at 으로 채움)과 DTO statusSince 추가 — updated_at 은 로그를 쓸 때마다 움직여 시작 시각이 될 수 없음. 상태가 바뀔 때(transition·update 의 status·resetInterrupted)만 갱신(시험 3개 RED→GREEN). 실제 v1 데모 DB 를 새 코드로 열어 마이그레이션이 되는 것도 확인
Task 11: Ruling: ready 작업(올리고 시작은 안 한 작업)은 UploadForm 을 resume 모드로 작업 화면에 넣어 이어서 시작할 수 있게 함(계획에는 없던 연결) — 기록에서 돌아온 작업이 막히지 않도록. "다른 영상" 은 그 작업을 지우고 /new 로 보냄
Task 11: Ruling: FailedPanel 의 "다른 레퍼런스로 다시 요청" 은 onEditReference 가 있을 때만 보이게 만들었고 JobView 는 아직 넘기지 않음 — 입력 화면이 Task 12 에서 생기므로 Task 12 가 연결해야 함(안 하면 plan 단계 실패 때 이 버튼이 없음). awaiting_reference·awaiting_plan·awaiting_confirm·confirmed 는 Task 12·13 이 bodyFor 에 케이스를 추가할 때까지 "이 상태를 표시하지 못했어요" 로 보임
Task 11: Ruling: 폴러는 400(주소 오류)도 404 처럼 멈춤 — 다시 읽어도 같은 답이라 5초마다 두드리지 않도록(시험 추가)
Task 11: 눈으로 확인 — producing(경과 시간이 흐름·로그 3줄·예상 "약 2~3분")·analyzing·failed(plan) 화면, 단계 눈금자 위치·실패 표시, 재시도 클릭→queued_plan 으로 DB 가 바뀌고 진행 패널("순서를 기다리는 중이에요")로 자동 전환, ready→resume 폼에서 [분석 시작]→같은 주소에서 진행 패널로 전환, 없는 id(404)·잘못된 id(400)→안내 화면, 모바일 375 다크 가로 넘침 0, impeccable detect 0건. 콘솔 오류는 서버를 일부러 껐다 켠 흔적과 일부러 부른 404/400 뿐. 1280 은 창이 1024 라 스크린샷 못 찍음
Task 12: complete (commits 0aec2c4..17feadf, tests: npx vitest run →    Duration  28.41s (tests 94%, import 5%, transform 1%, worker 1%))
Task 12: Ruling: "설명 수정 안내" 는 안내 문구만(새 영상에서 설명을 더 적어 다시 올리기, 바라는 점은 참고 요청에) — 분석 뒤에 설명을 고쳐 재분석하는 API 가 Task 7 에 없고(awaiting_reference 에서 queued_analysis 전환 불가), whisper 를 다시 돌려야 해서 이번 범위 밖으로 둠. 비용: 이해가 틀리면 영상을 다시 올려야 함 → 최종 보고의 개선 후보
Task 12: Ruling: "[계속]"과 "[레퍼런스 없이 계속]" 은 버튼 하나의 라벨 전환(고른 게 있으면 "이 레퍼런스로 계속", 없으면 "레퍼런스 없이 계속", 링크 칸에 글자가 있으면 고른 것으로 침) — 주 행동 하나를 지킴
Task 12: Ruling: 용도를 바꾸면 곧바로 plan 을 부르지 않고 "이 용도로 계획 다시 만들기" 버튼을 거치게 하고, 바꾼 채로는 승인 버튼을 막음 — 실수로 눌러 계획을 다시 만드는 비용(수십 초)과 옛 계획으로 승인하는 불일치를 막음
Task 12: Ruling: 계획이 이미 있는 작업(awaiting_plan)에서 "레퍼런스 바꾸기" 로 선택 화면을 다시 여는 길과 plan 실패의 "다른 레퍼런스로 다시 요청" 을 같은 ReferencePicker 로 구현(Task 11 의 onEditReference 연결 완료). 업로드 화면의 링크·파일·용도·시작 막대를 공용 부품(ReferenceInput·PurposeChooser·ActionBar)으로 뽑아 UploadForm 을 그 위로 옮김
Task 12: 눈으로 확인 — 데모: 추천 6개 선택/해제(aria-pressed·"선택함" 배지·버튼 라벨 변화), 추천 0개 안내, 링크 검증(공백뿐=없음, "abc"=오류+입력칸으로 이동), 링크+요청으로 계속→DB 에 저장되고 queued_plan, 계획 카드(긴 한국어 줄바꿈, 3줄 노란 강조), 용도 바꾸기→재요청 버튼+승인 막힘, 자막 끔·화질 최종→승인→queued_produce(captionsMode=off, quality=delivery), plan 실패→"다른 레퍼런스로 다시 요청"→선택 화면(이전 링크 채움, 취소 버튼). 실제 분석(워커, 샘플 영상, 28초): 음성 인식→영상 이해→"비슷한 인기 영상을 찾는 중"→awaiting_reference, 진짜 유튜브 추천 4개가 실제 썸네일로 표시됨. 모바일 375 다크 가로 넘침 0, impeccable detect 0건. 썸네일 로드 실패 대체(onError)는 오프라인을 만들 수 없어 코드로만 확인. 1280/1024 스크린샷은 창 폭 한계(1024 미만 520px 으로 나옴)로 못 찍고 좁은 배치만 확인
Task 13: complete (commits 17feadf..457688b, tests: npx vitest run →    Duration  27.52s (tests 94%, import 4%, transform 1%))
Task 13: Ruling: 계획의 "원문 → 수정" 을 위해 엔진의 partitionCorrections 가 각 교정에 고치기 전 글(original)을 붙이도록 바꿈(Plan 1 코드 변경 — qaChecks·pipeline 시험의 기대값 5곳을 새 모양으로 고치고 RED→GREEN). 교정은 항상 partitionCorrections 를 거쳐 applied/suggestions 로 가므로 한 곳이면 충분. DTO 는 original 을 선택 필드로 통과시키고 옛 리포트(original 없음)도 읽힘(시험). 비용: report.json 에 필드 하나 늘어남
Task 13: Ruling: 자막 제안(caption-suggestion) 항목은 검수 항목 목록에서 빼고 "고치지 않은 제안" 에만 보임(같은 내용이 두 번 나오지 않게). 검수 요약은 통과 표시여도 중요·확인 항목이 있으면 "확인할 것 N건" — 리포트가 없으면 통과라고 하지 않음. 교정 이유 코드(typo|term|spacing)는 한국어(오탈자·전문 용어·띄어쓰기)로 바꿔 보임
Task 13: Ruling: "접어서 항상 보이게" 는 <details open>(기본 펼침, 접을 수 있음)으로 구현. 다른 버전 버튼은 반대 용도만 "다른 버전도 만들기 — 게시물 영상용(가로)" 로(한국어 조사 오류를 피하려고 문장형 대신). 수정 요청은 이전 요청 + 줄바꿈 + 새 글(mergeRequest)
Task 13: Ruling: 확정·수정 요청 같은 동작 뒤 busy 를 풀지 않아 확정 후 "다른 버전" 버튼이 막히는 결함을 눈으로 확인하다 발견해 고침(성공 시에도 setBusy(null))
Task 13: 눈으로 확인 — 세로(9:16, 300×533)·가로(16:9, 490×276) 결과 플레이어 비율, 재생 메타데이터·시킹(currentTime=2 → seeked, Range 206), 검수 요약·중요1/확인2/참고1·교정3(긴 문장 줄바꿈)·제안1·확인하지 않는 4가지가 시연 데이터와 일치, 확정 클릭→confirmed(배너·업로드 자리 비활성·내려받기 링크 download=…), 다른 버전 클릭→새 작업(parent 연결, purposeChoice 반대, queued_plan)으로 이동해 진행 패널, 수정 요청→"기존 요청\n새 요청" 으로 queued_plan, 모바일 375 다크 가로 넘침 0, impeccable detect 0건. 시연용 분석 파일은 seed 가 최소 analysis.json 을 써 줌. 1280/1024 스크린샷은 창 폭 한계로 못 찍음
Task 14: complete (commits 457688b..472e5db, tests: npx vitest run →    Duration  28.68s (tests 94%, import 4%, transform 2%))
Task 14: Ruling: 실행 스크립트는 scripts/app.mjs + 시험할 수 있는 scripts/app-lib.mjs(줄 접두어·빌드 필요 판단·포트 확인·인자 해석, 시험 12개)로 나눔. Ctrl+C 는 터미널이 자식에게 이미 보내므로 다시 보내지 않고 기다림, SIGTERM(kill)은 자식에게 전달. 워커가 예상치 못하게 죽으면 3초 뒤 다시 켬(2분에 5번 넘게 죽으면 포기) — 워커가 조용히 죽으면 모든 작업이 멈추는 것처럼 보이기 때문
Task 14: Ruling: 실제 확인에 쓴 data/ 의 작업 6개(내가 만든 시험 작업, 그중 확정 2개 포함)는 확인이 끝난 뒤 앱의 삭제 API 로 지워 사용자가 빈 기록으로 시작하게 함. data/e2e-* 등 Plan 1 때의 폴더는 건드리지 않음
Task 14: 눈으로·실제로 확인 — Step 2(세로 전체 흐름, 실제 앱·워커·유튜브 추천·실제 렌더): 업로드→자동 인식 "릴스·숏츠용(세로)"→설명→분석(awaiting_reference 까지 약 40초, 추천 4개)→추천 1위 선택+요청 "자막 스타일만 따라 하고 컷은 더 빠르게"→계획 카드(약 24초: 레퍼런스 내려받기·분석·계획)→자막 끔→승인→제작 완료(약 100초, 렌더 99초)→결과 1080×1920 h264+aac 56.7초, 검수 리포트가 report.json 과 일치(captions-off 참고 1건, 확인하지 않는 4가지), 확정→기록 "확정한 영상"에 나타남, DB status 흐름 ready→queued_analysis→analyzing→awaiting_reference→queued_plan→planning→awaiting_plan→queued_produce→producing→awaiting_confirm→confirmed. Step 3(다른 버전): 새 작업이 "편집 계획" 4초 만에 awaiting_plan(레퍼런스·요청 유지, 레퍼런스 다시 안 받음, 계획 카드에 "원본이 세로라서 가로 화면 가운데에 두고 양옆을 블러 배경으로 채워요")→승인→1920×1080(블러 배경 프레임으로 확인, 120초)→확정→기록에 2개. Step 4: ① 렌더 중 kill -9 → 런처가 코드 137 을 알리고 워커를 다시 켬(고아 렌더 프로세스 없음), 작업은 "제작 단계에서 멈췄어요 — 작업이 중간에 멈췄어요", 다시 시도→완료 ② 존재하지 않는 인스타 릴스 링크→plan 실패 "비공개이거나 로그인이 필요한 영상이에요. 영상을 mp4 파일로 직접 올려 주세요."+[다른 레퍼런스로 다시 요청] ③ yt-dlp 를 실패하는 가짜로 가림→분석은 성공하고 추천 0개, 화면이 "추천을 불러오지 못했어요…"+링크/파일/레퍼런스 없이 계속이 모두 동작(없이 계속→2초 만에 기본 스타일 계획). Step 5(10분): 합성 세로 1080×1920 10분(287MB, 3.5초 소리+6.5초 무음 반복)→가로 용도(블러)→분석 21초, 계획 3초, 제작 570초(렌더 553+검수 12), 결과 4분 8초(무음 60곳 컷) 1920×1080 135MB, 워커+렌더 프로세스 RSS 합 최대 889MB, 디스크 사용량 최대 +3.0GB(렌더 중), 작업 폴더 427MB — README "한계" 에 기록. 음성이 많은 10분 영상의 분석 시간은 못 쟀음(소리만 있어 whisper 가 빨리 끝남). Step 6: INTEGRATION=1 npx vitest run 522/522 통과, web:build 성공
Task 14: 사용 중 확인된 한계(최종 보고용): 추천 목록에 같은 제목 영상이 중복으로 나올 수 있음(Task 4 검색 단계), 요청 "컷은 더 빠르게" 는 계획 카드에는 말로 나오지만 실제 컷 수는 무음 제거 기준 그대로(removed 1)
Final: fixed Ctrl+C 한 번에 진행 중인 작업이 죽음(런처 신호 이중 전달·SIGTERM→tsx 재전달·도구까지 같은 프로세스 그룹) — createSignalHandler 시험 3개 RED→GREEN, suite 529/529, 실제 확인(렌더 중 Ctrl+C 1회→렌더 완료·awaiting_confirm·모두 정상 종료 / 2회→렌더 도구까지 전부 종료)
Final: fixed 같은 확장자 레퍼런스 파일 교체가 무시됨(경로 고정 이름) — "같은 확장자로 다시 올리면 새 이름" 등 시험 4개 RED→GREEN, suite 529/529
Final: fixed DNS 리바인딩(Origin==Host 우회)·읽기 무방비 — Host 허용 목록 시험 RED→GREEN, 모든 API(GET·media 포함)에 적용, suite 529/529
Final: fixed 기록 카드가 결과 화면보다 낙관적 — reviewBadgeFor 시험 RED→GREEN(JobCard 가 verdictOf 와 같은 판정을 씀), suite 529/529
Final: minor (deferred): created 작업이 브라우저 비정상 종료 뒤 기록에 "올리는 중"으로 남음(작업 화면은 설명하지만 기록 줄은 아님) — 업로드 PUT 실패 시 서버가 지우거나 오래된 created 는 "업로드가 끊겼어요"로 표시
Final: minor (deferred): 중단·강제 종료된 제작의 out/.vae-work-* 임시 폴더가 남음(수백 MB~GB 추정) — producePhase 시작 때 지우기
Final: minor (deferred): 업로드 오류 문구 중복(" 다시 올려 주세요" 이중)·디스크 가득(ENOSPC)을 "업로드가 끊겼어요"로 안내
Final: minor (deferred): other-version 두 번 누르면 자식 작업 2개, approve 에 계획 버전 조건이 없어 다른 탭이 방금 다시 만든 계획을 못 본 채 승인할 수 있음(statusSince 를 조건에 넣기)
Final: minor (deferred): DB 마이그레이션 버전 읽기가 잠금 밖이라 웹·워커가 새 DB 를 동시에 열면 한쪽이 던질 수 있음(스스로 회복) / Jobs.remove 확인과 삭제 사이 틈
Final: minor (deferred): 수정 요청(이전 요청 4000자 + 새 글 3000자)이 plan 한도 4000자를 넘으면 원인 모를 400
Final: minor (deferred): "추천을 불러오지 못했어요" 문구가 검색 0건·검색 안 함에도 쓰임 / 읽을 수 없는 영상·10분 초과 같은 확정적 실패에도 "다시 시도"가 주 버튼 / 수정 요청 뒤 이전 결과로 돌아갈 길이 없음(알려진 한계로 적기)
Final: minor (deferred): README "Node 22+"(node:sqlite 는 22.13+)·제작 예상 시간(화면은 원본 길이×2~3, README 는 결과 길이×2~3)·package.json 버전 범위 표기
Final: Ruling: 리뷰어가 판단하지 않은 1280/1024 폭 화면 — 나도 창 폭 한계로 못 찍었고 그대로 둠 — 디자인 패스(design-taste inspect.mjs 1440/768/390)에서 실제 폭으로 확인하기로 함, 틀리면 좁은 폭에서 배치가 어색할 수 있음
Final: Ruling: 리뷰어가 판단하지 않은 편집 결과 품질("컷은 더 빠르게" 미반영)·추천 같은 제목 중복·고아 렌더 프로세스(1번 수정으로 그룹째 종료됨)·두 클라이언트 동시 PUT·워커 없이 웹만 켠 경우·성능 — 엔진·범위 밖이거나 사용 규모상 그대로 둠, 비용은 "알려진 한계"로 README·최종 보고에 남김
Design: user asked for a full visual redesign (functionality unchanged) on branch app-design (worktree ../video-autoeditor-design). Skills used: design-taste-frontend, frontend-design, impeccable (ui-ux-pro-max NOT used).
Design: Ruling: dark-only "편집실" direction (supersedes the earlier light/dark-by-OS design notes) — video is the protagonist on a true-black stage, amber = "now/my turn", white pill = commit action — cost if wrong: one token file + notes doc to revert; component class names kept so a light theme can return by swapping tokens.
Design: Ruling: allowed scrim gradient on thumbnails, playhead bloom and blurred-poster ambient backlight despite the skill's app-screen "no gradients/glow" rule — the user explicitly asked for motion-graphics/expressive design — cost if wrong: remove 3 CSS rules.
Design: Ruling: kept h1 at 44px on the home page although inspect.mjs warns (>32px) — expressive title by request — cost if wrong: one class.
Design: Ruling: Pretendard Variable (dynamic-subset woff2, served locally from node_modules) replaces the system font stack — Korean UI quality; no CDN/network dependency — cost if wrong: swap --font-stack.
Design: verified in browser pane with real tools: upload -> analyze -> reference -> plan -> render -> review -> confirm; home hover preview; QA markers; 545 tests pass | 4 skipped, tsc clean, web:build OK. Fixed copy "점 N개" -> "검수가 짚은 N곳 — 점을 눌러 확인".
Design: minor (deferred): result timeline uses resultInfo.durationSec for marker positions; if the result file's real duration differed (only seen with truncated demo data) markers would sit off — real results come from ffprobe so they match.
