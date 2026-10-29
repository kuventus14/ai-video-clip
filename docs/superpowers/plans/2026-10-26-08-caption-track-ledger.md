# SDD ledger — plan: docs/superpowers/plans/2026-10-26-08-caption-track.md
Spec: docs/superpowers/specs/2026-10-20-video-autoeditor-design.md (reachable). Branch: caption-track (from main c528814). Executor: inline (executing-plans); final review via Workflow (multi-lens + adversarial verify) per ultracode.
Why: user twice asked "모든 자막을 수정할 수 있게" — checked on screen: the editor only edits the TEXT of lines the recognizer produced; the real 20 s job's recognition ended at 17.0 s (nothing for 17–20 s), no way to add lines, change times, split/merge.
Pre-flight (shared interfaces):
- T1→T2,T3,T4: CaptionLine {start,end,text} declared in shared/types.ts; captionLineProblems used by the zod/route (T2) and the UI (T4) — same rules (160 chars, ≥0.2 s, no overlap, within video+0.5 s, ≤800 lines).
- T1→T3: applyCaptionTrack/cutTranscriptFor/removedSpans consumed by planPhase/producePhase; legacy transcript_edits path kept when no track (old jobs).
- T2→T4: GET /captions response shape changes to {durationSec, hasSpeech, original (with lowWords), lines, custom} — the Plan 6 CaptionReviewDto/CaptionPartDto and src/ui/captions.ts (index edits) are replaced; Plan 6 tests for them are updated.
- T4→T5: ReferencePicker is the editor screen; T5 opens it from the result screen (awaiting_confirm) — plan route already accepts awaiting_confirm; GET /captions gate gains awaiting_confirm (T2).
- Migration: 8 (caption_track); upload branch must become 9.
Rulings so far: none.
Task 1: complete (commits 77fc9bf..2c556be, tests: npx vitest run tests/captionTrack.test.ts tests/captionReview.test.ts tests/boundary.test.ts →    Duration  204ms (tests 42%, import 29%, transform 20%, worker 10%))
Task 2: complete (commits 2c556be..e27b716, tests: npx vitest run tests/db.test.ts tests/api.flow.test.ts tests/ui.api.test.ts tests/captionTrack.test.ts tests/boundary.test.ts →    Duration  799ms (tests 69%, import 16%, transform 13%, worker 2%))
Task 2 notes: GET /captions is a SUPERSET for now (old parts/edits kept so the Plan 6 screen keeps working until Task 4); size guard widened to 120 KB (parts+original+lines). Plan route rejects bad tracks with "자막 N번째 줄: …" (400); null clears track+legacy edits; captionTrack wins over captionEdits.
PAUSED (2026-10-26, user request): "남은 한도 10% 근처에서 멈췄다가 리셋 뒤 다시 시작". 5h limit was 88% used, resets 14:10 KST. State: Tasks 1–2 complete & committed (e27b716) on branch caption-track; tests 1053 green at last full run. NEXT: Task 3 (worker phases: planPhase/producePhase use applyCaptionTrack when job.captionTrack else legacy applyTranscriptEdits; deletedSpans via removedSpans; cutTranscript via cutTranscriptFor(raw.transcript, track); analysisPhase clears captionTrack too) — then T4 editor UI, T5 entry points, T6 real run + README, then final review via Workflow. Do not merge to main or push without the user asking.
Task 3: complete (commits e27b716..469baf0, tests: npx vitest run →    Duration  51.43s (tests 96%, import 3%, transform 1%))
Task 6: e2e (2026-10-29, 카카오톡 20초 샘플, 별도 데이터 폴더, npm run app): 인식 4줄(0~20초 연속, 17~20초 빈 구간은 이 샘플에서 안 생겨 4번째 줄 끝을 16.8로 줄여 만듦) → 화면에서 글자 2곳 고침·16.8~20.1 빈 구간에 줄 추가·시작 17.2로 옮김·2번 줄 나누기·나눈 뒤 합치기 → 계획(captionEditCount 5) → 승인·제작: 결과에 고친 글자·추가한 줄이 뜨고 컷 removed 0초(keptDurationSec 20.08) → 결과 화면 "자막 고치기"로 열면 저장된 5줄이 "고침 있음"으로 열림 → 마지막 줄 고쳐 다시 만들기 → 새 결과에 "오늘 영상은 여기까지예요", 컷 removed 0초. 화면: 데스크톱·375px 가로 넘침 없음, 콘솔 오류 없음, 이탈 경고 작동, 말 없는 영상은 편집기 숨김.
Task 6: Ruling: 시각 칸이 겹침으로 맞춰질 때(값이 그대로라) 칸이 입력값으로 남던 결함을 화면 확인 중 발견 — TimeField 가 커밋 뒤 항상 현재 값으로 다시 맞추고 "겹치지 않게 …초로 맞췄어요" 안내를 띄우게 고침 — 안 고치면 화면과 저장 값이 어긋남
Task 6: Ruling: 환경 — node_modules/@fontsource/noto-sans-kr/files 에 700-normal 조각 15개가 없었음(2026-10-26 12:48 이후 폴더 변경 없음, 원인 불명·iCloud 의심); hyperframes 가 오늘 08:50 0.8.181→0.8.214 로 올라가 check 가 폰트 404 를 오류로 쳐서 compose 통합 시험 2개 실패 → 같은 버전(5.3.1) 패키지에서 빠진 15개만 복원(node_modules 만, git 무관) — 다시 빠지면 같은 시험이 실패
Task 6: Ruling: 분석 때 설명 문구를 whisper --prompt 로 넘기면 말 없는 구간에서 설명을 그대로 받아 적는 환각이 남(pipeline.ts:283) — 이번 계획 범위 밖이라 안 고침, 제안으로 남김
Task 6: Ruling: 말이 전혀 인식 안 된 영상(hasSpeech=false, 줄 0개)은 편집기를 숨김 — 계획에 줄 추가 요구가 없고 워커의 빈 transcript 경로가 시험되지 않음 — 비용: 음악만 있는 영상에 사용자가 자막을 직접 넣을 길이 없음
Post-Task 6 (사용자 요청 2026-10-29 "말이 인식되지 않은 영상에도 자막을 직접 넣을 방법이 필요해"): (1) cutTranscriptFor 가 말 없는 영상(hasSpeech=false)이면 그대로 돌려줌 — 안 하면 줄을 넣는 순간 컷이 "말 있음"으로 보고 줄 밖 무음 구간을 전부 잘라냄(planCuts 시험으로 재현·RED→GREEN); (2) analysisPhase 의 "말 없는 영상 + 레퍼런스 → 곧바로 queued_plan" 건너뛰기를 없앰(항상 awaiting_reference 에서 멈춤); (3) CaptionReview 가 말 없는 영상에도 편집기를 보이고 안내 문구를 바꿈; (4) README. 실물: 소리 없는 20초 영상(카카오 샘플 -an)에 화면에서 0~3초·12~15초 줄 추가 → 계획(captionEditCount 2) → 제작: 두 줄 모두 결과에 나옴, 컷 removed 0초(20.08초 유지). 시험 1074개 통과.
Post-Task 6: Ruling: 음악만 있는 영상은 인식기(whisper small)가 "[구독과 좋아요는 필수!]" 같은 문구를 지어내 hasSpeech=true 로 나옴 — 그 줄을 기존 기능(지우기·고치기·추가)으로 다루게 둠(말 없음 판정은 새로 안 만듦) — 비용: 환각 줄이 있는 영상은 그 줄 기준으로 컷이 계산됨(기존 동작)
Post-Task 6: 위 Task 6 의 "말이 전혀 인식 안 된 영상은 편집기를 숨김" Ruling 은 사용자 요청으로 뒤집힘(말 없는 영상에도 편집기를 보임, c8d2cd1).
Final review (Opus, 2026-10-29, c528814..c8d2cd1): 판정 "수정 후 병합". Critical 1·Important 2·Minor 6.
Final: fixed (Critical) 줄 끝을 말 바깥으로 늘리면 진짜 말이 retake 로 잘림 — tests/captionTrack.test.ts "문장부호로 끝나는 세 낱말 이상 줄…" RED→GREEN (원인: 보호 가짜 단어를 줄 글자 그대로 넣고 segments 를 다시 묶음 → 같은 문장 두 번으로 보임; 수정: 보호 단어 글자를 '·' 로, segments 는 원래 그대로)
Final: fixed (Important) 인식이 놓친 곳에 넣은 "아!" 줄이 FILLER 로 잘림 — "인식이 놓친 무음 구간에 넣은 짧은 감탄사 줄" RED→GREEN (같은 수정)
Final: fixed (Important) 줄을 말 바깥으로 늘려도 자막 시각이 안 바뀜 — "앞·뒤로 1초 넘게 늘리면 …" RED→GREEN. Ruling: 늘린 조각(말 앞·뒤 0.3초 이상 = 컷이 지키는 조각)에는 자막 단어도 놓는다(extensionPieces 를 컷과 자막이 같이 씀), 0.3초 미만으로 늘린 건 말한 구간에만 — Plan 6 C2(쉬는 구간이 잘려 자막이 사라짐)는 컷이 그 조각을 지키므로 되살아나지 않음; 비용: 0.3초 미만 늘림은 효과 없음
Final: minor (deferred): TimeField onBlur 가 값이 그대로여도 커밋 → 5.25 같은 값이 칸을 눌렀다 나오기만 해도 5.3 이 되어 "고침 있음"·이탈 경고가 뜸 (CaptionReview.tsx:34-38; text === sec1(value) 이면 커밋 안 하기)
Final: minor (deferred): 이모지가 앞에 있으면 나누기가 한 글자씩 밀림 — selectionStart 는 UTF-16, splitLine 은 코드포인트 (CaptionReview.tsx:114; Array.from(text.slice(0, caret)).length)
Final: minor (deferred): 화면이 800줄 한도를 검사하지 않음 — 나누기를 반복해 801줄이 되면 서버가 일반 문구로 거절 (captionTrack.ts lineProblems)
Final: minor (deferred): 계속 버튼이 막혔을 때 안내가 늘 "자막이 너무 긴 줄이 있어요" (ReferencePicker.tsx:212) — 겹침·0.2초 미만·영상 길이 밖 때문에도 막힘(화면이 막아 실제로는 닿기 어려움)
Final: minor (deferred): 손대지 않은 인식 줄의 문제(0.2초 미만·겹침)도 계속 버튼을 막을 수 있음 (ReferencePicker.tsx:94) — 실제 인식 결과 5개로는 0건, 이론상
Final: minor (deferred): 군더더기("음·어") 줄의 글자를 고치면 자막이 사라짐 (Plan 6 부터 있던 성질)
Final: Ruling: 판단 보류 항목 — 300줄 넘는 화면의 실제 렌더 비용(순수 계산은 800줄 2.8ms)·앱 안 링크 이동 시 이탈 경고 없음(Plan 6 부터)·감독의 덜어내기가 넣은 줄 구간을 뺄 수 있음(인식된 말과 같은 취급, 설계)·말 있는 영상에서 자막을 전부 지우면 감독 프롬프트에 "음성 없음"과 "지운 구간"이 같이 들어감(Plan 6 부터)·새 줄은 검수 교정이 안 바꾸는 시험은 hasUserVerifiedWord(신뢰도 ≥0.999 제외)에 기댐 — 그대로 둠 — 비용: 위 항목이 실제로 문제가 되면 별도 수정
