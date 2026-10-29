# SDD ledger — plan: docs/superpowers/plans/2026-10-29-09-sound-balance.md
Branch: sound-balance (from main ea2ccc1). Executor: inline (executing-plans); final review: fresh Opus reviewer over the whole branch (ea2ccc1..efe22c1).
Why: 사용자가 "음악 및 효과음 ai 판단해서 볼륨 조절해서 만들기, 추후 유저가 영상을 보고 볼륨 사이즈를 줄이거나 키울 수 있게" 요청 (2026-10-29). 쉬운 것부터 먼저 — 자동 편집 개발 순서 1번.
Result: 음악·효과음 크기 = 고정 규칙 + dB 오프셋(AI −6~+4, 사용자 −12~+6). 제작이 out/dry.mp4(소리 없는 렌더)+out/mix.json(섞는 방법)을 남기고(워커만, remixFiles), 결과 화면의 슬라이더 카드가 POST /api/jobs/:id/remix → produce 단계 재사용(remix_pending, 마이그레이션 9) → remixSound(소리만 다시 섞기, 임시 파일 → 이름 바꿔치기). 이 기능 이전에 끝난 작업은 다시 섞을 수 없음(화면에 이유 표시).
Known limits: (1) AI 는 소리를 직접 듣지 못하고 장르·말 비율·음악 분위기만 봄 — 추천일 뿐, (2) 말이 있는 구간에서 음악은 목소리 −14 LU 아래 + 더킹 6~8 dB 라서 +6 dB 를 올려도 통합 음량(LUFS)은 거의 안 변함(−23.5 → −23.4) — 변하는 건 목소리 대비 음악 바닥의 높이, (3) 다시 섞은 뒤 report.qa 의 오디오 검사는 낡은 값, (4) 보류 minor 는 아래 Final 줄.
Pre-flight: no conflicts (see below).
Spec: docs/superpowers/specs/2026-10-20-video-autoeditor-design.md (sound rules: plans/2026-10-22-04-sound-ledger.md)
Pre-flight: T1 produces clampGainDb/SOUND_GAIN_RANGE/MixInput gains → consumed by T2 (clamp), T3 (applySound gains), T4 (range check), T6 (range). T3 produces MixRecipe/remixSound/mix.json → consumed by T4 (existence check), T5 (worker call). T4 produces Job.remixPending/soundGain → T5. No conflicts found.
Task 1: Ruling: plan named tests/sound.shared.test.ts — repo already has tests/shared.sound.test.ts, put clampGainDb tests there — avoids a duplicate file — cost if wrong: none
Task 1: complete (commits 52c8e52..0e2720d, tests: npx vitest run tests/sound.test.ts tests/shared.sound.test.ts →    Duration  2.46s (tests 96%, import 3%))
Task 2: complete (commits 0e2720d..0f9c489, tests: npx vitest run tests/soundBalance.test.ts tests/boundary.test.ts →    Duration  144ms (import 54%, tests 32%, transform 9%, worker 5%))
Task 3: Ruling: temp file is result.tmp.mp4, not result.mp4.tmp — ffmpeg picks the muxer from the extension, ".tmp" fails — cost if wrong: none
Task 3: Ruling: decideSoundBalance/balanceSound dropped the `voice` input and bgm `lufs` — the decision runs before the attempt loop when no render exists to measure, and the rules are relative to the voice anyway — cost if wrong: AI sees no loudness hint
Task 3: Ruling: added balanceSound(i,{ask,catalog}) wrapper (looks up bgm title/mood in catalog, never throws) as the PipelineDeps entry — keeps pipeline tests off the real assets/sound — cost if wrong: one extra small function
Task 3: Ruling: applySound returns recipe as Omit<MixRecipe,'ai'>; pipeline adds the AI decision — applySound does not know the AI's recommendation (it only gets applied gains) — cost if wrong: none
Task 3: Ruling: no stage('mix') emitted before the loop for the AI call — existing stage-order tests assert [cuts,build,render,mix,qa,done]; the call is one low-effort claude -p — cost if wrong: progress panel shows previous stage for a few seconds
Task 3: Ruling: pipeline removes stale out/dry.mp4+mix.json when this run uses no sound — otherwise remix API would treat a job re-planned without music as remixable — cost if wrong: none
Task 3: Ruling: WorkerDeps.remixSound + tests/worker.test.ts fake added in Task 3 (needed for tsc green); the phases.ts branch stays in Task 5
Final: minor (deferred): speechRatio is measured against the source length, not the cut output — a talky video with long silences cut reads lower than it plays; AI recommendation is advisory
Task 3: complete (commits 0f9c489..9158543, tests: npx vitest run tests/sound.test.ts tests/soundBalance.test.ts tests/pipeline.phases.test.ts tests/pipeline.test.ts tests/pipeline.director.test.ts tests/worker.test.ts →    Duration  2.67s (tests 80%, import 14%, transform 6%))
Task 4: Ruling: added a 'bool' column kind in jobs.ts (INTEGER 0/1 ↔ boolean) — the existing 'int' kind would return numbers for Job.remixPending — cost if wrong: none
Task 4: Ruling: SOUND_NOT_REMIXABLE message + canRemix(resultPath) live in src/shared/sound.ts (fs-only) so the web DTO, the remix route and core remixSound share one definition — web cannot import core — cost if wrong: none
Task 4: Ruling: legacy-version migration tests in tests/db.test.ts also drop sound_gain/remix_pending when simulating old DBs (as earlier migrations did for their columns)
Task 4: Ruling: remix body is z.strictObject (unknown keys → 400); values rounded to 0.5 dB via clampGainDb server-side
Task 4: complete (commits 9158543..8bd1da4, tests: npx vitest run tests/db.test.ts tests/api.flow.test.ts tests/boundary.test.ts →    Duration  668ms (tests 84%, import 11%, transform 3%, worker 2%))
Task 5: Ruling: remix failure returns the job to awaiting_confirm with an errorMessage (remixPending/soundGain cleared, old result.mp4 untouched) instead of the plan's failed(produce) — a failed screen would hide a perfectly good result and block confirming it; the card shows the message — cost if wrong: plan's "retry continues remix" path is only used after a process crash (resetInterrupted → failed → retry keeps remixPending), still tested
Task 5: Ruling: on success the remix also rewrites out/report.json's `sound` and clears job.soundGain — keeps CLI-visible report and the DB report consistent, and the DTO reads current values from report.sound.balance
Task 5: complete (commits 8bd1da4..decc522, tests: npx vitest run tests/worker.test.ts tests/api.flow.test.ts tests/boundary.test.ts →    Duration  924ms (tests 81%, import 13%, transform 5%, worker 1%))
Task 6: Ruling: SOUND_GAIN_RANGE/clampGainDb moved to a node-free src/shared/soundGain.ts and re-exported from shared/sound.ts — shared/sound.ts imports node:fs, so a client component importing the value would break the Next client build; existing tests keep importing from shared/sound.ts — cost if wrong: none
Task 6: Ruling: added JobDto.remixing (remixPending && queued_produce|producing) and a ProgressPanel branch (no step list, "화면은 다시 만들지 않고 소리만 바꿔요") — the plan did not cover it; the generic panel said "렌더링 (지금) / 제작은 2~3배 걸려요" during a ~0.4 s audio-only remix — cost if wrong: one boolean in the DTO
Task 6: Ruling: sliders/AI line live in a Card under the player (left column); hidden for confirmed jobs; effect slider only when sfxMode==='on', music slider only when bgmId
Task 6: visual check (real app on :4851, data ~/dev/vae-verify/data, real 20 s sample): card renders; +6 dB apply → worker remix 0.4 s → back on result screen, <video src> got new ?v=, video stream md5 identical to dry, report.sound.balance bgmGainDb 6; AI-revert button; old job shows reason + disabled sliders; music-only job hides SFX slider; broken mix.json → result screen kept, alert text shown, result.mp4 md5 unchanged; 375 px width no horizontal overflow
Task 6: complete (commits decc522..e438c8d, tests: npx vitest run tests/ui.soundAdjust.test.ts tests/api.flow.test.ts tests/shared.sound.test.ts tests/boundary.test.ts →    Duration  851ms (tests 75%, import 18%, transform 6%, worker 1%))
Task 7: real run (20 s Kakao sample data/jobs/cf02d84d49/source.mp4, bgm bright-driving-ambition + sfx on, draft quality, real `claude -p` AI decision): out/ has result.mp4, report.json, dry.mp4, mix.json; AI chose bgm -3 dB / sfx -2 dB ("말이 100%라 …"). Remix via the real app/worker at bgm +6: 0.4 s, video stream md5 identical to dry.mp4 (-c:v copy), report.sound.balance updated. Music-only renders: -12/-6/0/+6 dB → -37.8/-31.8/-25.8/-19.8 LUFS (exactly 6 dB per 6 dB offset). Remix at the maximum (+6/+6) → integrated -23.4 LUFS (voice-dominated clip: -23.5 at default), peak -8.7 dBFS (limit 0.8 ≈ -1.9 dBFS holds).
Task 7: Note: with speech present the music bed sits ~14 LU under the voice and is ducked another 6-8 dB, so integrated loudness barely moves (-23.5 → -23.4) even at +6 dB; the offset changes the bed's relation to the voice (audible), not the clip's overall LUFS
Task 7: next build OK (remix route listed); client bundle does not pull node:fs (soundGain split)
Task 7: complete (commits e438c8d..efe22c1, tests: sh -c 'npx tsc --noEmit && npx vitest run' →    Duration  62.67s (tests 95%, import 4%, transform 1%))
Final review: fresh Opus reviewer (whole branch ea2ccc1..efe22c1) — no Critical; 1 Important, 11 Minor; verdict "ready to merge with fixes"
Final: fixed Important 1 (CLI deleted/overwrote dry.mp4+mix.json in the user's --out folder) — new ProduceInput.remixFiles, only producePhase sets it; test "remixFiles 를 안 주면(CLI)…" RED→GREEN, suite 1184/1184
Final: fixed (re-graded Minor 2 → Important: plan Global Constraint "도구 원문을 화면에 보이지 않는다") ffmpeg stderr in SoundError.message shown on the result card — SoundError.detail + describeError → log only; tests "ffmpeg 원문…detail 에만" and "섞기 도구(ffmpeg)의 원문은 화면 문구에 싣지 않고…" RED→GREEN, suite 1184/1184
Final: minor (deferred): 1 — failure after the swap (corrupt out/report.json, full disk) says "기존 결과는 그대로예요" though result.mp4 already has the new audio and the DB report/sliders show old gains (phases.ts remixPhase; fix: update DB report right after remixSound returns, log the file error only)
Final: minor (deferred): 3 — ?v=updatedAt also changes on 확정, restarting the player at 0:00 (fix: build ?v= from the result file's mtime in toJobDto — also covers download link/JobCard)
Final: minor (deferred): 4 — decideSoundBalance uses askClaude's 360 s default timeout with no stage; a hung claude -p freezes production on the previous stage label (fix: timeoutMs ≈ 60 s)
Final: minor (deferred): 5 — mix.json does not store bgm.lufs / sfx peakDb; after `npm run sound:measure` re-measures a track, revert-to-AI + apply no longer reproduces the original mix
Final: minor (deferred): 6 — dry.mp4 + mix.json stay after 확정 (a confirmed job can never remix) = a full duplicate video per confirmed job (fix: delete them in the confirm route, or document)
Final: minor (deferred): 7 — SFX slider shows whenever sfxMode==='on' even if the recipe has zero effects (sfx-none) (fix: expose effect count in the DTO)
Final: minor (deferred): 8 — "자막 고치기"/plan again → approve asks the AI again and drops the user's gains; other-version children don't inherit them (plan-sanctioned; fix: pass last applied gains to produceEdit as an override)
Final: minor (deferred): 10 — no automated real-ffmpeg end-to-end test of remixSound (video stream unchanged, peak at +6/+6); covered by fake-mix tests, the existing "hot" limiter test, the reviewer's scratch run and the manual real run in Task 7
Final: minor (deferred): 11 — src/web/media.ts stat-then-open race: a swap between stat and open (hover preview during a remix) can send a body that does not match Content-Length (pre-existing code; fix: open first, then fstat)
Final: Ruling: remix queued behind another job's long render still says "몇 초면 끝나요" — the existing 20 s queue hint covers it — cost if wrong: slightly optimistic text
Final: Ruling: progress bar jumps back to "제작" / history list shows "제작 중" during a remix — seconds long, spec silent — cost if wrong: cosmetic flicker
Final: Ruling: "AI 추천: 기본 크기 그대로" also shows when the AI call failed — documented in tests as intended, advisory only — cost if wrong: the line over-states that the AI judged "keep default"
Final: Ruling: web dirname(resultPath) vs worker jobDir/out can only disagree if the data folder is moved; then media link and remix both become unavailable together — cost if wrong: none seen
Final: Ruling: Next.js 16 route conventions — new route copies existing routes' shape and `next build` passes — cost if wrong: none seen
Post-review (사용자 요청 2026-10-29 "앞의 6개 고쳐줘" — 보류 minor 중 6개를 고침, 시험 1196개·tsc 통과):
Post-review: fixed minor 3 — 결과 영상 주소의 ?v= 를 updatedAt 대신 결과 파일 수정 시각으로(toJobDto) → 확정해도 재생이 처음으로 안 돌아감, 소리만 다시 섞으면 주소가 바뀜. 화면 확인: 같은 <video> 요소·주소·5초 위치 유지
Post-review: fixed minor 4 — decideSoundBalance 의 askClaude 에 timeoutMs 60초
Post-review: fixed minor 6 — 확정하면 dry.mp4·mix.json 삭제(removeRemixFiles, 못 지워도 확정은 막지 않음). 화면 확인: 확정 뒤 out/ 에 report.json·result.mp4 만 남음
Post-review: fixed minor 7 — JobDto.soundAdjust.sfxCount(리포트의 효과음 개수) → 0 이면 효과음 슬라이더·AI 추천 줄에서 효과음을 뺌. 화면 확인: 음악 슬라이더만 보임
Post-review: fixed minor 8 — 직접 조절한 크기(job.soundGain)를 approve 가 지우지 않고(remixPending 만 끔) producePhase 가 produceEdit(soundGain)으로 넘김 → 새 제작은 그 값으로 입히고(쓰는 소리에만, 범위 밖은 자름) AI 추천은 새로 받아 리포트·되돌리기용으로 남김
Post-review: fixed minor 1 — remixPhase 를 나눠서 remixSound 실패만 "기존 결과는 그대로" 로 안내; 소리가 바뀐 뒤에는 DB 리포트를 먼저 고치고 out/report.json 을 못 고치면(깨진 파일 등) 진행 기록에만 남김
Post-review: Ruling: 다시 섞기가 성공해도 실패해도 job.soundGain 은 지우지 않는다 — 실패해도 사용자가 원한 값이라 이후 새로 만들 때 쓰는 게 의도에 맞음(지금 영상엔 안 쓰였음) — 비용: 실패 직후 결과 화면 값과 soundGain 이 다름
Post-review: Ruling: 새 제작에서 AI 호출은 조절값이 있어도 한다 — 새 내용에 대한 추천을 "AI 추천으로 되돌리기"에 쓰려고 — 비용: 호출 1번(60초 제한)
Post-review: Ruling: other-version(새 작업)은 조절값을 물려받지 않는다 — 용도가 달라 새 영상이라서 — 비용: 새 작업은 AI 추천부터
Still deferred (minor 5·10·11 + 말 비율): 5 mix.json 에 곡 음량·효과음 최대치 미저장(sound:measure 로 다시 재면 되돌리기가 어긋남), 10 실제 ffmpeg 로 remixSound 를 끝까지 도는 자동 시험 없음, 11 media.ts stat→open 경합, speechRatio 는 원본 길이 기준
