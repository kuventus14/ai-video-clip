# SDD ledger — plan: docs/superpowers/plans/2026-10-20-01-edit-core.md
Spec: docs/superpowers/specs/2026-10-20-video-autoeditor-design.md (reachable, read)
Setup: Ruling: 새 로컬 저장소라 워크트리 대신 `edit-core` 브랜치에서 작업(main 에는 설계·계획 문서 커밋만) — 기존 코드가 없고 사용자가 로컬 git init·커밋을 승인함 — 비용: 없음. 끝에서 main 병합은 사용자에게 묻는다.
Pre-flight: T2 types/VideoInfo → T3,4,6,7,8,10,11,14,15,16 — 이름·필드 일치.
Pre-flight: T4 Transcript → T6 describeVideo / T12 planCuts / T16·T17 — 일치.
Pre-flight: T5 askClaude → T6,8,9,15,16 (deps.ask 주입 형태 동일) — 일치.
Pre-flight: T8 StyleSpec·StyleField·FEASIBILITY → T9 interpretRequest/deriveAppliedStyle — 일치.
Pre-flight: T9 AppliedStyle(maxChars,padSec,transition,captions,hookTitle) → T12 padSec, T13 maxChars, T14 BuildInput.style, T15 maxChars, T16 QaInput.maxChars — 일치.
Pre-flight: T10 PersonTrack → T11 computeCropPath, T15 checkFraming, T16 — 일치.
Pre-flight: T11 CropPath.keyframes(원본 시간) → T13 remapKeyframes → T14 BuildInput.crop(출력 시간) — T17 이 변환을 담당(계획에 명시됨) — 일치.
Pre-flight: T12 CutPlan.kept → T13 remap*, T14 BuildInput.kept — 일치.
Pre-flight: T11 computeCropPath 옵션 ↔ T17 'recrop' 재작업(시정수×2, 데드밴드×1.5, 가장 큰 인물 우선): **불일치** — T11 시그니처에 평활 옵션이 없음. Ruling: T11 의 `o` 에 `smoothing?: { timeConstantSec?: number; deadband?: number; preferLargest?: boolean }` 를 추가(기본값 0.6 / 0.04 / false) — T17 재작업이 그 값을 넘김 — 비용: 시그니처 인자 하나.
Pre-flight: T14 renderProject ↔ T16/T17 — 일치. T15 → T16 — 일치.
Task 1: complete (commits b241c1a..f5290e7, tests: npx vitest run →    Duration  175ms (tests 34%, transform 28%, import 27%, worker 10%))
Task 2: Ruling: run() 기본 env 에 흔한 설치 위치 PATH 보강을 추가(defaultSearchPath 를 exec.ts 로 옮김, env.ts 는 재수출) — GUI·서비스로 실행돼도 brew 도구를 찾게 하려고, 시험(PATH 가 비어 있어도 ffmpeg 실행) RED→GREEN — 비용: 없음
Task 2: Ruling: ensureFixtures 에 회전 메타데이터용 'rotated' 픽스처를 추가 — 계획의 '회전 메타데이터가 있으면 교환' 동작을 시험하려고 — 비용: 없음
Task 2: complete (commits f5290e7..7df248d, tests: npx vitest run →    Duration  17.27s (tests 85%, transform 10%, import 5%))
Task 3: complete (commits 7df248d..af63c63, tests: npx vitest run →    Duration  13.09s (tests 86%, transform 5%, import 5%, worker 4%))
Task 4: complete (commits af63c63..ab4b1ad, tests: npx vitest run →    Duration  944ms (tests 94%, import 3%, transform 2%, worker 1%))
Task 4: 실샘플(INTEGRATION=1) 전사 확인 — 83단어·5세그먼트, 저신뢰 단어 '동화연칠(0.45)'·'요렁이(0.36)' 가 실제 오인식으로 보임 → T15 저신뢰 점검이 유효함
Task 5: Ruling: AskOpts 에 선택 필드 env(자식에 더 넘길 환경변수)를 추가 — 자식 환경을 화이트리스트로 짓기 때문에 가짜 claude 가 읽는 FAKE_CLAUDE_* 를 시험에서 넘길 통로가 필요했고, 시험 전용 분기를 프로덕션 코드에 넣지 않으려고 — 비용: 옵션 하나
Task 5: 실제 claude -p 한 번 호출로 확인 — 래퍼가 {"ok":true} 를 스키마 검증까지 통과해 돌려줌(약 6초)
Task 5: complete (commits ab4b1ad..65674ef, tests: npx vitest run →    Duration  1.06s (tests 93%, import 5%, transform 2%, worker 1%))
Task 6: 실샘플로 describeVideo(설명 없음, 실제 claude + 프레임 6장) 확인 — topic '롱아이언 백스윙 꿀팁'·genre '골프 레슨'·검색어 5개, 약 11초. 전사 오인식을 화면으로 보정함
Task 6: complete (commits 65674ef..b948a62, tests: npx vitest run →    Duration  989ms (tests 88%, import 8%, transform 3%, worker 1%))
Task 7: Ruling: 계획의 클래스 이름 'ReferenceError' 를 'ReferenceFetchError' 로 바꿈 — 자바스크립트 내장 ReferenceError 를 가려 instanceof·catch 가 혼동될 수 있음 — 후속 작업(T17 시험 등)에서도 이 이름을 씀 — 비용: 이름 하나
Task 7: 실제 유튜브(ovvnJ4Y2tR0) 앞 3분 내려받기 INTEGRATION=1 통과 (약 90초, 합성 시험 11개는 기본 실행)
Task 7: complete (commits b948a62..12aa38a, tests: npx vitest run →    Duration  1.07s (tests 86%, import 10%, transform 3%, worker 1%))
Task 8: 시험 영상의 빨강→초록은 밝기가 비슷해 ffmpeg 장면 감지에 안 잡혀 합성 영상을 검정→흰색→회색으로 바꿈(코드 결함 아님). 실샘플 analyzeReference(실제 claude) 확인 — 세로·컷 0개(원테이크)·자막 하단/흰색+노란 강조·제목 카드 '프로님의 롱아이언 꿀팁'·구조 6단계, 약 10초
Task 8: complete (commits 12aa38a..a2b45d9, tests: npx vitest run →    Duration  1.73s (tests 90%, import 7%, transform 2%, worker 1%))
Task 9: Ruling: 계획이 정의하지 않은 EditPlan.adjust 의 실제 반영을 deriveAppliedStyle 에 추가 — 컷 '더 빠르게/느긋하게'는 padSec ×0.6(최소 0.08, 빠르게면 펀치 줌)/×1.5(최대 0.5), 자막 '더 크게/작게'는 크기 한 단계 — 스펙의 '자연어 입력이 편집에 반영된다'를 만족시키려면 카드 표시만으론 부족했음. 시험 RED→GREEN(4개 실패→27/27) — 비용: 키워드 정규식 기반이라 모호한 문구는 무시됨(카드엔 표시)
Task 9: 실제 claude 로 interpretRequest 확인 — '자막만 따라 하고 컷은 더 빠르게, 카메라 워크도' → take[captions], adjust[pacing], unsupported[카메라 워크] 정확
Task 9: complete (commits a2b45d9..f6f8ffc, tests: npx vitest run →    Duration  1.85s (tests 91%, import 7%, transform 2%, worker 1%))
Task 10: 실샘플(INTEGRATION=1) 사람 인식 확인 — 1080x1920, 227샘플 중 human 검출 118(52%)·face 8, 두 사람(x≈0.01 코치 / x≈0.6 학생, 높이 ≈0.28)이 잡히고 일부 구간(예: 8.8s)은 검출 없음 → T11 의 '검출 없는 구간 유지·복귀' 규칙이 실제로 필요함
Task 10: complete (commits f6f8ffc..9d70972, tests: npx vitest run →    Duration  2.66s (tests 93%, import 5%, transform 1%))
Task 11: Ruling: 크롭 창에 최대 이동 속도(초당 0.4, 정규화 원본 폭 기준)를 추가 — 계획의 '컷 없이 0.2→0.8 이동 시 연속 키프레임 차이 ≤0.1' 시험은 시정수 0.6초의 지수 이동만으론 만족되지 않음(첫 키프레임 차이 ≈0.2). 속도 제한은 급한 패닝 방지라는 의도에도 맞음. 또 검출 시작 이동 임계(데드밴드 0.04)와 멈춤 임계(데드밴드/4)로 히스테리시스를 둠 — 정밀하게 중앙에 맞추려고 — 비용: 파라미터 하나
Task 11: Ruling: 컷 시각의 점프는 키프레임 두 개(컷−0.001초에 이전 값, 컷 시각에 새 값)로 표현 — GSAP 이 키프레임 사이를 선형 보간하므로 한 개만 두면 직전 0.25초 동안 훑어 보임 — 비용: 없음(T14 가 키프레임을 그대로 트윈)
Task 11: complete (commits 9d70972..883731a, tests: npx vitest run →    Duration  2.87s (tests 92%, import 6%, transform 1%, worker 1%))
Task 12: detectSilences 는 처음에 probeVideo(영상 스트림 필요)로 오디오 유무를 확인해 오디오 전용 파일에서 실패 → ffprobe 오디오 스트림 확인으로 수정(시험 RED→GREEN). 계획 밖 추가 규칙: 맨 앞/뒤 무음은 가장자리까지 제거, 0.3초 미만 조각 처리(말 없음→합침, 말 있음→짧은 쪽 제거 취소), 세 단어 미만 반복은 NG 로 안 봄. 실샘플: 무음 7개 중 단어 시간과 겹치는 곳은 보호되어 2구간(≈3초)만 제거
Task 12: complete (commits 883731a..892b843, tests: npx vitest run →    Duration  2.80s (tests 93%, import 5%, transform 1%))
Task 13: complete (commits 892b843..7e61175, tests: npx vitest run →    Duration  2.84s (tests 92%, import 5%, transform 2%, worker 1%))
Task 14: Ruling: 계획의 '@fontsource/noto-sans-kr 의 woff2(700) 복사'는 패키지가 한글을 유니코드 범위별 124조각(2.6MB)으로 나눠 둔다는 점을 몰랐음 → 700.css 의 @font-face 를 woff2 만 남겨 index.html 에 인라인하고 조각 woff2 전부를 프로젝트 fonts/ 에 둠(쓰는 조각만 로드됨). gsap 은 CDN 대신 npm(gsap 3.15)에서 lib/gsap.min.js 로 담아 네트워크 없이 렌더 — 결정성 규칙(렌더 중 네트워크 금지) 때문 — 비용: 프로젝트마다 약 3MB(하드링크 가능하면 0)
Task 14: 실제 hyperframes check 통과 + draft 렌더(4초 1080x1920, 약 10초) + 프레임 육안 확인 — 한글 볼드 자막·마지막 단어 강조색·제목 카드·크롭 좌→우 이동 모두 정상. 후속 메모(T17): 원본이 H.264 mp4 가 아니면(아이폰 HEVC .mov 등) 브라우저 디코딩이 실패할 수 있어 build 전에 ffmpeg 로 H.264 mp4 로 바꾸는 단계를 파이프라인에 둘 것(VideoInfo 에 codec 이 없으므로 그때 추가)
Task 14: complete (commits 7e61175..ae4c034, tests: npx vitest run →    Duration  13.23s (tests 95%, import 2%, transform 2%))
Task 15: Ruling: 계획 Interfaces 에 없던 순수 함수 checkAudioLevels(meanDb/maxDb→클리핑·너무 작음 medium)와 checkBlackSegments(0.5초 이상 검은 구간→high/rerender-quality)를 추가 — 계획 본문에 판정 규칙은 있는데 맡을 함수가 없었음 — 비용: 함수 둘. 또 해상도 high(>2.2배)는 fixHint 'none' 이라 T17 재작업 루프는 '조치 가능한(fixHint≠none) high' 가 있을 때만 돈다(없으면 재작업 없이 리포트에 passed:false 로 전달)
Task 15: 실샘플로 proofreadCues(실제 claude) 확인 — '백싱→백스윙'·'요렁이→요령이' 정확, 그러나 의심 단어 힌트를 주자 '동화연칠 → 동작 연습'처럼 틀린 추측 교정도 생김(실제 발화는 '롱아이언 칠 때'로 보임). 교정기만 믿으면 위험 → 음성 인식 단계의 용어 힌트가 더 신뢰됨
Task 15: Ruling: proofreadCues ctx 에 선택 필드 suspectWords(신뢰도 낮은 단어)를 추가 — 교정 품질을 높이려고(시험 RED→GREEN) — 비용: 필드 하나. 사후 메모: 교정 결과는 자동 적용하되 리포트에 모두 남길 것(T16/T17)
Task 4/15: Ruling: transcribe 에 선택 옵션 prompt(분야 용어 힌트→whisper-cli --prompt)를 추가 — 실험: 힌트 '롱아이언, 백스윙, 골프 레슨' 으로 '백싱'→'백스윙' 3곳이 바로잡히고 '동화연칠'→'동아이언 칠'로 가까워짐 — 시험 RED→GREEN, 실샘플 확인. T17 흐름 반영 필수: 설명이 있으면 처음부터 힌트로 전사, 없으면 1차 전사→describeVideo→저신뢰 단어가 많으면(≥5개) 요약의 topic·genre·검색어로 힌트를 만들어 재전사 → 그 다음 교정
Task 15: complete (commits ae4c034..7762e36, tests: npx vitest run →    Duration  13.86s (tests 96%, import 3%, transform 1%))
Task 16: complete (commits 7762e36..ceac7be, tests: npx vitest run →    Duration  14.17s (tests 97%, import 2%, transform 1%))
Task 17(준비): VideoInfo 에 선택 필드 videoCodec·rotation 추가, ensureH264(HEVC·mov·회전 → H.264 mp4, 원본 보존)를 media.ts 에 추가(시험 RED→GREEN), QaInput.skipCaptions 추가 — 장부의 후속 메모(T14)와 captions 'off' 처리를 위해. 커밋 완료
Task 17: Ruling: 단계 순서를 probe→(normalize)→transcribe→(reference)→purpose→understand→plan… 으로 함 — 레퍼런스를 용도 인식 전에 분석해야 detectPurpose 가 레퍼런스 비율을 쓸 수 있음(스펙 5-1). normalize 는 변환이 일어날 때만 emit 해서 계획의 순서 시험은 그대로 성립 — 비용: 없음
Task 17: Ruling: 자막 교정을 첫 렌더 전에 한 번 적용(proofreadCues)하고 검수가 남긴 교정 제안은 '조치 가능' 으로 취급해 재작업을 돌림(높음 아닌 medium 교정도) — 계획은 high 만 재작업하게 돼 있어 오타가 그대로 나갈 수 있었음(스펙 안티골) — 비용: 교정 LLM 호출 1~2회 추가. 재작업 규칙: 조치 가능(fixHint≠none)한 high 또는 교정 제안이 있을 때만, 최대 2회
Task 17: Ruling: EditOptions.onPlan(planCard, purpose) 콜백 추가(렌더 전 카드 출력, 시험 RED→GREEN), EditResult 에 appliedCorrections·summary·reframe 추가, report.json 에 purpose.guess·history 등 기록, keepWork 옵션 — CLI 가 '카드를 출력만 하고 진행' 하려면 도중 출력 통로가 필요했고, 교정 투명성을 위해 — 비용: 없음
Task 17: complete (commits ceac7be..bcdb136, tests: npx vitest run →    Duration  16.52s (tests 96%, import 4%))
Task 18: 실제 샘플로 e2e 확인 — (1) 세로 short: 1080x1920 h264+aac, 55.4초(원본 56.8), 검수 통과, 117초 (2) 가로 post(세로 원본→blur-fill): 1920x1080, 53.3초, 양옆 블러 배경 정상, 131초 (3) 가로 의사영상(샘플을 가로 캔버스 오른쪽에 배치)→short: 인물 따라가는 크롭 확인, 1차 검수에서 구도(framing) high → recrop 재작업 → 2차 통과, 자막 '백스윙' 정확, 교정 1건('동아이언'→'롱아이언'), 182초 (4) 사람 없는 합성 영상→short: crop-no-person 경고 + 중앙 크롭 확인. 시험: INTEGRATION=1 npx vitest run → 251/251 통과, tsc 오류 0
Task 18: Ruling: 사람이 나오는 가로 원본이 없어 '샘플을 가로 캔버스(1920x1080) 오른쪽에 배치한 의사 가로 영상'으로 인물 크롭을 확인함 — 실제 가로 촬영본(사람이 크게 나오는)으로는 사용자가 주면 다시 확인해야 함 — 비용: 실촬영본에서 크롭 품질이 다를 수 있음. 또 계획 카드가 레퍼런스 없을 때 '레퍼런스를 따른다'고 말하던 문제와 조정만 있을 때 '지정한 항목 없음' 문구를 시험(RED→GREEN) 후 고침
Task 18: complete (commits bcdb136..a86acf8, tests: npx vitest run →    Duration  16.04s (tests 97%, import 2%, transform 1%))
Final: 수정 한 번에 진행(시험 먼저). RED 확인 — 구현을 git stash 로 치우고 새 시험을 돌려 36개 실패 확인(Bash 일시 장애로 구현 전 RED 를 못 돌려 이렇게 확인함) 후 복원, 그 뒤 GREEN. 최종: INTEGRATION=1 npx vitest run → 293/293, tsc 오류 0
Final: fixed C1(--out/work 영구 삭제) — "(C1) --out 폴더에 원래 있던 work 폴더와 파일은 건드리지 않는다" RED→GREEN. 작업 폴더를 `<out>/.vae-work-<무작위>` 로 만들고 그 폴더만 지움
Final: fixed I1(장면 전환 감지 3분 한계) — "(I1) 장면 전환 감지는 원본 전체 길이를 본다" RED→GREEN
Final: fixed I2(두 사람 크롭 흔들림) — "(I2) 대상 선택에 히스테리시스" 3개 RED→GREEN (합집합 진입 0.9·이탈 1.05 히스테리시스 + 한 사람 모드는 직전 따르던 사람과 가장 가까운 박스를 계속 따름) + cropReversalsPerSec 지표
Final: fixed I3(클로즈업 구도 오탐) — "(I3) 클로즈업" 3개 RED→GREEN (몸 박스 폭>0.8 이면 얼굴 박스로 판정, 얼굴이 없으면 info 만)
Final: fixed I4(원본의 검은 구간·이미 최고 화질에서 헛 재렌더) — qa "(I4) 원본에도 있던 검은 구간"·remapSpans·pipeline "(I4) 화질 재작업은 looks → delivery 로 한 번 올리고…" RED→GREEN (원본 검은 구간은 필요할 때만 원본을 감지해 제외, delivery 에서는 화질 재작업 없음)
Final: fixed I5(교정 재렌더 폭주·근거 없는 추측 자동 적용) — qaChecks "isSafeCorrection/partitionCorrections", qa "(I5) 이미 교정돼 사라진 단어…", pipeline "(I5) 원문과 너무 다른 교정은…"·"(I5) 검수가 매번 교정을 내놓아도…" RED→GREEN (글자 유사도 ≥0.6 만 자동 적용, 나머지는 제안으로 리포트에; 교정 때문에 도는 재작업 1회; 의심 단어는 현재 자막에 남은 것만)
Final: fixed I6(카드와 실제 적용값 불일치) — interpret "(I6)" 시험들·pipeline "(I6) 요청 해석에는 레퍼런스가 있는지 알린다" RED→GREEN (전환은 레퍼런스의 주된 전환만 따름, 반영 못 한 조정은 '반영하지 못했어요' 표시, 레퍼런스 없으면 프롬프트·take 비움)
Final: fixed I7(H.264 변환 비용) — 실험: hyperframes 0.8.181 은 HEVC·회전 메타데이터 영상을 변환 없이 정상 렌더링(프레임 육안 확인). media "HEVC … 변환하지 않는다"·"회전 …도 그대로" RED→GREEN, compose 통합 시험 2개로 고정. 변환은 h264·hevc 가 아닌 코덱에만 + preset veryfast
Final: fixed I8(검수 공백) — 계획 자체의 공백을 최소 보완: checkDuration(숏츠 >180초 경고)·crop-jitter 경고·report.json 'unchecked'(검수하지 않은 항목 4개) RED→GREEN. 나머지(재전사 대조·싱크·화면 밖 잘림·비트레이트)는 구현하지 않고 리포트에 '검수하지 않음' 으로 정직하게 표기
Final: fixed M4(재평가: 몇 분 걸려 만든 영상을 교정 LLM 호출 하나 실패로 잃음 → Important) — qa "(M4)"·pipeline "(M4)" RED→GREEN (실패해도 info 로 알리고 계속)
Final: fixed M3(재평가: 재묶기가 적용한 교정을 되돌리면서 리포트는 '적용됨'이라 거짓 보고 → Important) — "(M3) 이미 교정을 적용했다면 recaption 재묶기로…" RED→GREEN
Final: Ruling: I7 에서 계획의 '모든 비-H.264/비-mp4/회전 영상을 H.264 로 변환' 을 폐기 — 실험으로 불필요함이 확인됐고 4K 영상 변환이 수십 분 걸림 — 비용: 실험하지 않은 코덱(av1·vp9 등)은 hyperframes 가 못 읽으면 렌더 단계에서 오류가 날 수 있음(변환 대상은 h264·hevc 제외 전부라 이 경우는 변환됨)
Final: Ruling: 자동 적용 교정의 안전 기준을 '띄어쓰기 뺀 글자 유사도 ≥0.6' 으로 정함 — 근거 없는 모델 추측이 자막에 들어가는 것(동화연칠→동작 연습 같은)을 막고 '백싱→백스윙' 같은 실제 교정은 통과시키는 값(실샘플 사례로 확인) — 비용: 맞는 큰 교정이 제안으로만 남아 사용자가 직접 고쳐야 함
Final: Ruling: 전환 효과를 컷 속도와 분리(레퍼런스 주된 전환만 따름) — 카드·스펙 5 의 '정직성' 요구 — 비용: 컷이 빠른 레퍼런스에서 펀치 줌이 자동으로 안 들어감(이전엔 들어갔음)
Final: minor (deferred): M1 렌더 전 `hyperframes check` 미실행(T14 통합 시험에서만 확인)
Final: minor (deferred): M2 레퍼런스 가져오기 — 긴 레퍼런스가 앞 3분으로 잘린다는 알림 없음, 채널·재생목록 URL 은 --playlist-items 1 없이 시간 제한까지 대기, --ignore-config 없음, 봇 확인 오류가 'private' 으로 안내됨, 내려받은 파일 probe 실패 시 ToolError 그대로
Final: minor (deferred): M5 Ctrl+C 로 중단하면 finally 가 안 돌아 <out>/.vae-work-*/ref 에 레퍼런스 파일이 남음(재실행해도 새 폴더라 안 지워짐)
Final: minor (deferred): M6 전사 언어 ko 고정(외국어 음성은 음차 자막)
Final: minor (deferred): M7 llm.ts 가 ANTHROPIC_API_KEY 를 자식에 넘김(설정돼 있으면 API 과금으로 바뀜, 지금은 미설정)
Final: minor (deferred): M8 recrop 재작업이 평활만 강하게 함 / M9 5-1 단순화(말하는 사람→가장 큰 사람, 눈에 띄는 영역→중앙)가 카드·리포트에 안 드러남
Final: minor (deferred): M10 문구 — purpose.ts '레퍼런스이'→'레퍼런스가', pipeline '정사각라서'→'정사각이라서', 저신뢰 경고가 이미 교정된 원래 단어를 가리킬 수 있음(I5 수정으로 대부분 해소)
Final: minor (deferred): M11 시험이 임시 폴더(compose-*·pipeline-*·ref-* 등)를 안 지움 / M12 CLI 가 --reference 파일 경로를 전사 뒤에야 확인 / M13 시간 초과 때 직계 자식만 SIGKILL(고아 Chrome·ffmpeg 가능)
Final: Ruling(declined): 카드 승인·수정(스펙 5-3)·미리보기 후 delivery 렌더(5-4)·추천·DB·History·업로드 — Plan 2·3 범위로 계획이 정함 — 비용: 이 CLI 단독으로는 사용자가 카드를 보고 중단하는 것 외엔 수정 불가
Final: Ruling(declined): BGM·효과음·하단바 — 계획 Global Constraints 가 범위 밖으로 정했고 사용자에게 알림 — 비용: 레퍼런스의 음악·오버레이 느낌은 못 따라 함
Final: Ruling(declined): 10분·blur-fill(클립 2배) 장시간 렌더의 디스크·RAM 사용량 미측정 — 8GB 맥에서 장시간 렌더는 시험 환경에서 위험해 안 돌림 — 비용: 10분 영상에서 메모리 부족·디스크 과다 가능성. Plan 2 전에 10분 합성 영상으로 실측해 README 에 적을 것
Final: Ruling(declined): 아이폰 HDR(HLG·Dolby Vision) 색 처리, 음악만 있는 오디오에서 whisper 가 없는 말을 지어내는 현상 — 샘플·실모델 실행 필요 — 비용: HDR 영상 색이 밋밋할 수 있음 / 지어낸 자막은 저신뢰 경고와 교정 제안으로 일부 걸러짐
Final: Ruling(declined): 화면 녹화의 얼굴캠을 크롭이 따라가는 것, 사람 없는 가로→세로를 blur-fill 대신 중앙 크롭, 출력 fps 30 고정, 같은 폴더 동시 실행, 카드 문자열 이스케이프(웹 화면 몫) — 스펙 규칙 그대로이거나 영향이 작음 — 비용: 낮음
