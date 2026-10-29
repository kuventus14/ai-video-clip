# 음악·효과음 AI 볼륨 + 결과 화면에서 조절 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 제작할 때 AI 가 영상 내용을 보고 배경음악·효과음 크기를 정하고, 결과 화면에서 유저가 두 볼륨을 슬라이더로 바꾸면 영상을 다시 그리지 않고 소리만 다시 섞는다.

**Architecture:** 지금 볼륨은 `src/core/sound.ts` 의 고정 상수(음악 = 목소리 −14 LU, 효과음 = 목소리 최대 −8 dB)다. 여기에 dB 오프셋 두 개(`bgmGainDb`, `sfxGainDb`)를 얹는다. 제작 단계가 (1) AI 가 정한 오프셋으로 섞고 (2) 소리 없는 원본 렌더 `out/dry.mp4` 와 섞는 방법 `out/mix.json` 을 남긴다. 다시 섞기는 새 상태를 만들지 않고 **기존 produce 단계를 재사용**한다(`remix_pending` 표시가 켜져 있으면 produce 가 렌더 대신 `remixSound` 만 돌린다). 웹은 core 를 가져올 수 없으므로(`tests/boundary.test.ts`) 섞기는 워커에서만 한다.

**Tech Stack:** TypeScript, ffmpeg(`-c:v copy` 소리만 다시 만들기), node:sqlite 마이그레이션 9번, Next.js route, Vitest, `askClaude`(claude -p).

**Spec:** `docs/superpowers/specs/2026-10-20-video-autoeditor-design.md` (소리 규칙은 `docs/superpowers/plans/2026-10-22-04-sound-ledger.md`)

## Global Constraints

- 배경음악·효과음을 고르지 않은 작업(`wantsSound` 거짓)에는 조절 카드를 보이지 않는다. 음원이 없어도 기존 경로는 그대로 돈다.
- 기존 시험이 쓰는 숫자(`volume=-20.00dB`, `-8.00dB`, `peakDb <= -0.9`)는 오프셋 0 일 때 그대로여야 한다.
- web·shared·app·ui 는 core 를 가져오지 못한다(경계 시험). 오프셋 범위·정리 함수는 `src/shared/sound.ts` 에 둔다.
- DB 마이그레이션은 9번이다(업로드 브랜치는 10번이 된다). `tests/db.test.ts` 의 버전 단언(8)을 9 로 올린다.
- 사용자에게 보이는 문구는 한국어, 도구 원문(ffmpeg stderr 등)을 그대로 보이지 않는다.
- 이미 끝난 옛 작업(`dry.mp4` 없음)은 다시 섞을 수 없다 — 화면에 이유를 보이고 조절 버튼을 막는다.

## Review Focus

- 다시 섞다 실패하면 기존 `result.mp4` 가 그대로 남아야 한다(임시 파일에 쓰고 성공해야 바꿔치기).
- 속도(tempo)가 1 이 아닌 작업의 효과음 시각이 다시 섞은 뒤에도 같아야 한다(레시피에 출력 시각으로 저장).
- 오프셋을 최대(+6 dB)로 올려도 합친 소리가 찌그러지지 않는다(limiter 뒤 최대치 ≤ −0.9 dBFS).
- 슬라이더를 연타해도 요청이 쌓이지 않는다(produce 중에는 거절, 화면은 진행 중 표시).
- 다시 섞은 영상을 브라우저가 옛 캐시로 보여 주지 않는다(`?v=updatedAt`).
- AI 가 이상한 값·글을 주면(범위 밖, 숫자 아님, 호출 실패) 오프셋 0 으로 되돌아가고 제작은 계속된다.

---

### Task 1: 오프셋을 받는 섞기

**Files:**
- Modify: `src/core/sound.ts` (`MixInput`, `buildMixArgs`, `ApplySoundInput`, `applySound`)
- Modify: `src/shared/sound.ts` (범위·정리)
- Test: `tests/sound.test.ts`, `tests/sound.shared.test.ts`(없으면 만든다)

**Interfaces:**
- Produces (shared): `export const SOUND_GAIN_RANGE = { min: -12, max: 6 } as const`, `export function clampGainDb(n: unknown): number`(숫자 아니면 0, 범위로 자르고 0.5 단위 반올림).
- Produces (core): `MixInput.bgmGainDb?: number`, `MixInput.sfxGainDb?: number`(기본 0). `ApplySoundInput.gains?: { bgmGainDb: number; sfxGainDb: number }`.

- [ ] **Step 1: 실패하는 시험** — `buildMixArgs` 에 `bgmGainDb: 3` 을 주면 음악 필터에 `volume=-17.00dB`(기준 −20.00 + 3), `sfxGainDb: -2` 면 효과음이 `-10.00dB`(기준 −8.00 − 2); 오프셋 없으면 기존 문자열 그대로. `clampGainDb`: `'x'`→0, 99→6, −99→−12, 2.74→2.5.
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/sound.test.ts tests/sound.shared.test.ts` / Expected: 새 시험만 FAIL.
- [ ] **Step 3: 구현** — `volume=` 인자에 오프셋을 더한다. `applySound` 는 `gains` 를 `MixInput` 으로 넘긴다.
- [ ] **Step 4: 통과 확인** — 같은 명령, 기존 시험 포함 전부 PASS.
- [ ] **Step 5: 커밋** — `feat(sound): 음악·효과음 크기 오프셋(dB)`

### Task 2: AI 가 크기를 정한다

**Files:**
- Create: `src/core/soundBalance.ts`
- Test: `tests/soundBalance.test.ts`

**Interfaces:**
- Consumes: `askClaude`/`extractJson`(`src/core/llm.ts`), `VideoSummary`(`src/core/understand.ts`), `AudioLevel`(`src/core/sound.ts`), `clampGainDb`(Task 1).
- Produces: `export interface SoundBalance { bgmGainDb: number; sfxGainDb: number; reason: string }`, `export function speechRatio(t: Transcript, durationSec: number): number`, `export async function decideSoundBalance(i: { summary: VideoSummary; speechRatio: number; voice: AudioLevel; bgm?: { title: string; mood: string; lufs: number }; sfxOn: boolean }, deps?: { ask?: typeof askClaude }): Promise<SoundBalance>`.

- [ ] **Step 1: 실패하는 시험** — (a) 가짜 `ask` 가 `{"bgmGainDb":-3,"sfxGainDb":1,"reason":"말이 많아요"}` → 그대로(AI 범위 −6~+4 로 자름). (b) `bgmGainDb: 99` → 4. (c) 글만 오거나 JSON 아님/`ask` 가 던짐 → `{0,0,''}`. (d) 음악 없으면(`bgm` undefined) `bgmGainDb` 0, 효과음 끄면 `sfxGainDb` 0 이고 `ask` 를 부르지 않는다(둘 다 없을 때). (e) `speechRatio`: 말 구간 합 / 길이, 말 없는 대본 0, 1 초과 없음. (f) 프롬프트에 장르·말 비율·음악 분위기·"기본 규칙 대비 dB 오프셋"이라는 기준이 들어 있다.
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/soundBalance.test.ts` / Expected: FAIL(모듈 없음).
- [ ] **Step 3: 구현** — 프롬프트는 "기본 규칙(음악=목소리 −14 LU)에서 얼마나 키우거나 줄일지"만 묻는다(말이 빽빽하면 음악 줄임, 말이 적고 활기찬 영상이면 키움). 모델·effort 는 `askClaude` 기본 중 `effort: 'low'`. 응답은 `extractJson`→필드별 `clampGainDb` 후 AI 범위로 한 번 더 자른다. `reason` 은 60자로 자른다.
- [ ] **Step 4: 통과 확인** — PASS.
- [ ] **Step 5: 커밋** — `feat(sound): AI 가 음악·효과음 크기 오프셋을 정한다`

### Task 3: 제작이 원본 렌더와 레시피를 남기고, 다시 섞는 함수

**Files:**
- Modify: `src/core/sound.ts`(`applySound` 가 `recipe` 반환, 새 `remixSound`), `src/core/pipeline.ts`(오프셋 결정·`dry.mp4`/`mix.json` 저장·리포트), `src/worker/worker.ts`(`WorkerDeps` 에 `remixSound`)
- Test: `tests/sound.test.ts`, `tests/pipeline.phases.test.ts`

**Interfaces:**
- Consumes: Task 1~2.
- Produces: `export interface MixRecipe { durationSec: number; hasAudio: boolean; voice: AudioLevel; bgmId: string | null; sfx: { trackId: string; atSec: number }[]; ai: SoundBalance }`(`atSec` 는 속도 적용 뒤 출력 시각). `applySound(...)` 반환에 `recipe` 추가. `export async function remixSound(i: { outDir: string; gains: { bgmGainDb: number; sfxGainDb: number } }, deps?: { catalog?: Catalog; mix?: typeof mixSound }): Promise<SoundReport>` — `out/dry.mp4`+`out/mix.json` 으로 `out/result.mp4.tmp` 에 섞고 성공하면 `result.mp4` 로 바꿔치기. `SoundReport` 에 `balance?: { bgmGainDb; sfxGainDb; aiBgmGainDb; aiSfxGainDb; reason }` 추가.

- [ ] **Step 1: 실패하는 시험** — (a) `applySound` 가 효과음 시각을 속도로 나눈 `recipe.sfx` 를 돌려준다. (b) `remixSound`: 가짜 `mix` 로 호출 → `mix` 가 받은 `bgmGainDb`/`sfxGainDb`·`voice`·sfx `atSec` 가 `mix.json` 의 값과 같고, 성공하면 `result.mp4` 가 새 파일, `mix` 가 던지면 `result.mp4` 는 그대로(옛 내용)·`.tmp` 정리·한국어 `SoundError`. (c) `dry.mp4`/`mix.json` 없으면 "이 작업은 소리만 다시 섞을 수 없어요" 류 한국어 `SoundError`. (d) 파이프라인: 음악을 고른 작업이 끝나면 `out/` 에 `result.mp4`·`report.json`·`dry.mp4`·`mix.json` 이 있고 `report.sound.balance` 가 있다; 음악·효과음 둘 다 없으면 `dry.mp4`/`mix.json` 이 없다.
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/sound.test.ts tests/pipeline.phases.test.ts` / Expected: 새 시험 FAIL.
- [ ] **Step 3: 구현** — 파이프라인은 시도 루프 앞에서 `decideSoundBalance` 를 한 번 부르고(`wantsSound` 일 때, 주입 가능한 의존성) 그 오프셋으로 `applySound`. 루프 마지막 시도의 섞기 직전 `renderedPath`(=소리 없는 원본)를 기억했다가 `result.mp4` 를 복사하는 자리에서 `dry.mp4` 로 복사하고 `mix.json` 을 쓴다. `keepWork` 와 무관하게 `out/` 에 둔다.
- [ ] **Step 4: 통과 확인** — PASS, 그리고 `npx vitest run tests/pipeline.test.ts` 가 깨지지 않는다.
- [ ] **Step 5: 커밋** — `feat(sound): 원본 렌더·섞기 레시피 보존과 다시 섞기`

### Task 4: DB·상태·다시 섞기 요청

**Files:**
- Modify: `src/db/db.ts`(MIGRATIONS 9번: `sound_gain TEXT`, `remix_pending INTEGER NOT NULL DEFAULT 0`), `src/db/jobs.ts`(`Job.soundGain: { bgmGainDb: number; sfxGainDb: number } | null`, `Job.remixPending: boolean`, FIELDS), `src/db/status.ts`(`awaiting_confirm → queued_produce` 허용), `src/shared/types.ts`·`src/web/dto.ts`(`JobDto.soundAdjust`), `src/web/schemas.ts`, `app/api/jobs/[id]/approve/route.ts`(승인 때 `soundGain: null, remixPending: false`)
- Create: `app/api/jobs/[id]/remix/route.ts`
- Test: `tests/db.test.ts`(버전 9), `tests/api.flow.test.ts`

**Interfaces:**
- Consumes: `SOUND_GAIN_RANGE`·`clampGainDb`(Task 1), `out/mix.json` 의 존재(Task 3).
- Produces: `POST /api/jobs/:id/remix` body `{ bgmGainDb: number; sfxGainDb: number }` → 200 `JobDto`(상태 `queued_produce`). `JobDto.soundAdjust: { available: boolean; reason: string | null; bgmGainDb: number; sfxGainDb: number; aiBgmGainDb: number; aiSfxGainDb: number; aiReason: string } | null`(음악·효과음을 안 쓴 작업은 null).

- [ ] **Step 1: 실패하는 시험** — 마이그레이션 9 적용·버전 9; `awaiting_confirm` + `dry.mp4`·`mix.json` 있음 → remix 200, 상태 `queued_produce`, `soundGain`·`remixPending` 저장; 범위 밖 값 400; `awaiting_confirm` 아님(제작 중·`confirmed`) 409; `dry.mp4` 없음 409 + 한국어 안내; 승인(approve) 후엔 `soundGain` null·`remixPending` false; DTO `soundAdjust.available` 가 파일 유무를 따른다.
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/db.test.ts tests/api.flow.test.ts tests/boundary.test.ts` / Expected: 새 시험 FAIL.
- [ ] **Step 3: 구현** — 라우트는 기존 라우트와 같은 모양(`assertSameOrigin`, `loadJob`, `jobs.transition`). 요청 파일 검사는 웹에서 `fs.existsSync` 만 쓴다(core 안 가져옴).
- [ ] **Step 4: 통과 확인** — PASS.
- [ ] **Step 5: 커밋** — `feat(sound): 다시 섞기 요청(마이그레이션 9)`

### Task 5: 워커가 다시 섞는다

**Files:**
- Modify: `src/worker/phases.ts`(`producePhase` 분기), `src/worker/worker.ts`(의존성 연결)
- Test: `tests/worker.test.ts`

**Interfaces:**
- Consumes: `remixSound`(Task 3), `Job.remixPending`·`soundGain`(Task 4).

- [ ] **Step 1: 실패하는 시험** — `remixPending` 인 작업: `produceEdit` 은 부르지 않고 `remixSound` 를 `{ outDir, gains }` 로 부른다 → `awaiting_confirm`, `remixPending` false, `resultPath` 같음, 리포트의 `sound.balance` 가 새 값, 길이·썸네일 갱신은 안 한다(영상 그대로). `remixSound` 가 던지면 `failed`(failedPhase `produce`)이고 `retry` 하면 다시 `remixPending` 경로로 간다.
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/worker.test.ts` / Expected: FAIL.
- [ ] **Step 3: 구현** — `producePhase` 맨 앞에서 `job.remixPending` 이면 다시 섞기만 하고 끝낸다(분석·계획 파일을 읽지 않는다).
- [ ] **Step 4: 통과 확인** — PASS.
- [ ] **Step 5: 커밋** — `feat(worker): 소리만 다시 섞기`

### Task 6: 결과 화면 볼륨 카드

**Files:**
- Create: `components/job/SoundAdjust.tsx`, `src/ui/soundAdjust.ts`(슬라이더 값↔라벨 순수 함수), `tests/ui.soundAdjust.test.ts`
- Modify: `components/job/ResultReview.tsx`(카드 추가·영상 `src` 에 `?v=` 캐시 번호), `src/ui/api.ts`(`remix`)

**Interfaces:**
- Consumes: `JobDto.soundAdjust`(Task 4), `SOUND_GAIN_RANGE`.
- Produces: `sliderLabel(db: number): string`(−12~+6 → "많이 작게/작게/기본/크게/많이 크게"+dB), `isChanged(a, b): boolean`.

- [ ] **Step 1: 실패하는 시험** — `sliderLabel(0)` = "기본", 범위 끝 값, 0.5 단위; `isChanged` 가 같은 값이면 거짓.
- [ ] **Step 2: 실패 확인** — Run: `npx vitest run tests/ui.soundAdjust.test.ts` / Expected: FAIL.
- [ ] **Step 3: 구현** — 카드: 음악·효과음 슬라이더(효과음을 안 켠 작업은 효과음 슬라이더 숨김), "AI 추천: …(이유)" 한 줄, "AI 추천으로 되돌리기"·"적용" 버튼(값이 안 바뀌면 비활성), `available:false` 면 이유를 보이고 슬라이더를 막음, 적용 뒤 진행 화면은 기존 제작 진행 패널이 맡는다. `ResultReview` 의 `<video src>` 에 `?v=<updatedAt>`.
- [ ] **Step 4: 통과 확인** — PASS, `npx tsc --noEmit` 통과.
- [ ] **Step 5: 화면 확인** — 앱을 띄워 실제 결과 화면에서 카드·슬라이더·적용 뒤 영상 소리 변화를 눈으로 확인(스크린샷은 DOM/JS 로 교차 확인).
- [ ] **Step 6: 커밋** — `feat(ui): 결과 화면에서 음악·효과음 볼륨 조절`

### Task 7: 실물 확인과 문서

**Files:**
- Modify: `README.md`(소리 항목), `docs/superpowers/plans/2026-10-29-09-sound-balance-ledger.md`(장부)

- [ ] **Step 1: 실물** — 카카오 20초 샘플 + 곡 하나 + 효과음 켜기로 제작 → `out/` 에 네 파일; 음악 +6 dB 로 다시 섞기 → `measureAudio` 로 통합 음량이 올라가고 최대치 ≤ −0.9 dBFS, 화면(영상 스트림)은 그대로; 다시 섞는 시간 기록.
- [ ] **Step 2: 전체** — Run: `npx tsc --noEmit && npx vitest run` / Expected: 전부 PASS.
- [ ] **Step 3: README** — 소리 설명에 "AI 가 크기를 정하고 결과 화면에서 조절, 옛 작업은 불가" 한 단락.
- [ ] **Step 4: 커밋** — `docs: 음악·효과음 볼륨 조절`
