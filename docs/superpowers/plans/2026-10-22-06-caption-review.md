# 자막 확인·수정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 음성 인식(whisper)으로 만든 자막 글자를 분석 직후 사용자가 줄마다 보고(들어 보고) 고치거나 지울 수 있게 해서, 고친 글자로 편집 감독·컷·최종 자막이 만들어지게 한다.

**Architecture:** 인식 결과(`analysis.json` 의 transcript)는 건드리지 않고, 사용자가 고친 줄만 DB(`transcript_edits`)에 둔다. 계획·제작 단계가 같은 순수 함수 `applyTranscriptEdits` 로 고친 글자를 입힌 transcript 를 만들어 쓴다(편집 감독이 틀린 글자로 문구를 쓰지 않도록 계획 전에 적용). 줄 나누기(`reviewParts`)는 transcript 에서 결정적으로 계산해서 편집이 줄 번호로 안정적으로 가리킨다. 분석 직후 "레퍼런스 고르기" 화면에 "자막 확인" 카드를 넣고, 레퍼런스를 미리 넣은 작업도 말이 있으면 이 화면에서 한 번 멈춘다.

**Tech Stack:** TypeScript, Next.js 16(app router), node:sqlite, vitest, React(클라이언트 컴포넌트), 기존 `Field`/`Card`/`Button` UI.

**Spec:** docs/superpowers/specs/2026-10-20-video-autoeditor-design.md (자막은 음성 인식 결과 + 검수 게이트 — 이 계획은 사람이 확인하는 게이트를 더한다). 선행 계획: Plan 5 (`2026-10-22-05-director.md`, `director` 브랜치 위에 쌓는다 — 마이그레이션 7번).

## Global Constraints

- 자막의 출처는 계속 음성 인식이다(원본에 박힌 자막은 읽지 않는다). 이 계획은 인식 결과를 **사람이 고치는** 단계를 더할 뿐 인식 방식을 바꾸지 않는다.
- 브라우저 번들(`components/**`, `src/ui/**`)은 node 모듈(`node:fs` 등)이나 그것을 값으로 가져오는 파일을 가져오지 않는다(타입만 `import type`). `tests/boundary.test.ts` 가 지킨다.
- `src/web/dto.ts` 의 `toJobDto` 는 파일을 읽지 않는다. 인식 결과를 화면에 주는 것은 별도 라우트(`GET /api/jobs/[id]/captions`)가 한다.
- 문구는 한국어 존댓말(~해요). 오류는 사용자에게 그대로 보여 줘도 되는 한국어.
- 시험은 TDD(실패 → 구현 → 통과). 기존 시험 중 "레퍼런스를 미리 넣으면 분석 뒤 바로 queued_plan" 을 가정한 것은 새 흐름에 맞게 고친다.
- 마이그레이션 7번 하나만 추가한다(`transcript_edits`). 이미 있는 작업은 NULL.
- 사용자가 고친 글자의 신뢰도는 1 로 둔다(검수의 "신뢰도 낮음" 경고에 안 걸리고, 자막 교정(LLM)이 다시 바꾸지 못한다).

## Review Focus

계획의 시험이 직접 확인하지 않으면 사용자가 겪을 가능성이 큰 다섯 가지(각 줄의 시험은 소유 작업에 들어 있다).

1. **분석이 다시 돌면(재시도) 예전 편집이 새 인식 결과의 엉뚱한 줄에 적용됨** → 분석 때 편집을 비우고, 범위를 벗어난 줄 번호는 무시한다 (Task 1, 4).
2. **고친 글자가 짧은 구간에 너무 길거나 빈 문자열·공백만이거나 줄을 전부 지웠을 때** 시각 분배·컷 계산·자막이 깨지거나 작업이 멈춤 → 빈 단어 목록이어도 `hasSpeech=false` 로 안전하게 이어진다 (Task 1, 4).
3. **사용자가 고친 글자를 검수의 자막 교정이 다시 바꿈** → 고친 줄은 교정 대상에서 뺀다 (Task 4).
4. **레퍼런스를 미리 넣은 작업이 이제 분석 뒤 멈춤**: 상태 기계·진행 화면·목록 문구·"다른 버전도 만들기"(분석을 재사용하므로 멈추지 않는다)가 어긋나지 않음 (Task 4, 5).
5. **10분짜리 영상은 줄이 200개 안팎**: 화면이 느려지지 않고, 저장 본문은 고친 줄만 담는다 (Task 3, 5).

## Plan Series

- 이 계획 뒤: 큰 whisper 모델·목소리 보정을 켠 소리로 인식(정확도 자체), 줄 합치기·쪼개기, 원본에 박힌 자막 읽기(Plan 6 후보).

---

### Task 1: 줄 나누기와 고친 글자 입히기 (순수 함수)

**Files:**
- Create: `src/core/captionReview.ts`, `tests/captionReview.test.ts`
- Modify: `src/core/transcribe.ts`(문장 나누기 로직을 `segmentWords(words)` 로 꺼내 export — `parseWhisperJson` 이 그것을 쓴다), `src/core/types.ts`(`CaptionEdit`)

**Interfaces:**
- Produces:
```ts
// src/core/types.ts
export interface CaptionEdit { i: number; text: string | null }   // text null(또는 공백뿐) = 이 줄 지우기

// src/core/captionReview.ts
export interface ReviewPart { i: number; start: number; end: number; text: string; lowWords: string[]; from: number; to: number } // words[from..to)
export const REVIEW_LIMITS: { maxChars: 18; maxGapSec: 0.7; lowConfidence: 0.5; maxTextChars: 160 }
export function reviewParts(t: Transcript): ReviewPart[]
export function applyTranscriptEdits(t: Transcript, edits: CaptionEdit[] | null | undefined): Transcript
// src/core/transcribe.ts
export function segmentWords(words: Word[]): Transcript['segments']
```
- `reviewParts`: 단어를 순서대로 묶는다. 새 줄을 여는 조건 — 글자 수(공백 뺀)가 18 을 넘기게 되거나, 앞 단어와 간격이 0.7초 초과, 앞 단어가 문장부호(`. ? ! …` 등)로 끝남. `text` 는 단어를 공백으로 이은 것, `lowWords` 는 신뢰도 < 0.5 인 단어의 글자. 줄 번호 `i` 는 0 부터.
- `applyTranscriptEdits`: 같은 `i` 가 여러 번이면 마지막 것을 쓰고, 범위 밖 `i`·글자가 아닌 `text` 는 무시한다. 글자가 원문과 같으면 그대로 둔다. 고친 줄(`from..to`)의 단어를 지우고, 새 글자를 공백으로 나눈 조각들을 줄의 `[start, end]` 안에 **글자 수에 비례해** 나눠 넣는다(각 조각 신뢰도 1, 글자가 160자를 넘으면 160자까지만). 지우는 줄(`text` null/공백뿐)은 단어만 뺀다. 결과의 `segments` 는 `segmentWords` 로 다시 만들고 `hasSpeech = words.length > 0`. 원본 `t` 는 바꾸지 않는다.

- [ ] **Step 1: 실패하는 시험** (`tests/captionReview.test.ts`):
  - `reviewParts`: '18자를 넘기면 줄을 나눈다' · '0.7초 넘게 쉬면 나눈다' · '문장부호 뒤에서 나눈다' · '신뢰도 0.5 미만 단어만 lowWords' · '줄 번호는 0부터, from/to 가 단어 구간을 정확히 가리킨다' · '단어가 없으면 빈 목록'
  - `applyTranscriptEdits`: '고친 줄만 바뀌고 다른 줄의 단어는 그대로(시각·신뢰도 포함)' · '새 단어들이 줄의 시작~끝 안에 이어 붙고 글자 수에 비례한다' · '고친 단어의 신뢰도는 1' · '지우는 줄(null·공백뿐)은 단어가 빠지고 segments 도 줄어든다' · '모든 줄을 지우면 hasSpeech=false 이고 던지지 않는다' · '범위 밖 i·잘못된 text 는 무시' · '같은 i 가 두 번이면 마지막' · '원문과 같은 글자면 단어 객체가 그대로' · '160자 넘는 글자는 160자까지' · '원본 transcript 는 바뀌지 않는다' · 'edits 가 null/빈 배열이면 같은 값'
  - `segmentWords`: 기존 `parseWhisperJson` 시험이 그대로 통과(리팩터링 보호).
- [ ] **Step 2:** `npx vitest run tests/captionReview.test.ts tests/transcribe.test.ts` — FAIL (모듈 없음).
- [ ] **Step 3: 구현.** `segmentWords` 를 꺼내 `parseWhisperJson` 이 쓰게 하고, `captionReview.ts` 를 쓴다. 나눠 넣는 시각은 조각 글자 수의 비율로(마지막 조각 끝 = 줄 끝, 조각 사이 틈 없음).
- [ ] **Step 4:** 위 시험 + `tests/transcribe.test.ts` PASS. **Step 5: 커밋** `feat(captions): 줄 나누기와 고친 글자 입히기`

### Task 2: 편집 저장 (DB·타입·API·다른 버전)

**Files:**
- Modify: `src/db/db.ts`(마이그레이션 7), `src/db/jobs.ts`, `src/shared/types.ts`(`CaptionEdit` 를 shared 로 — core 가 가져다 쓴다), `src/web/schemas.ts`(`PlanBody.captionEdits`), `app/api/jobs/[id]/plan/route.ts`, `src/web/flow.ts`(다른 버전에 복사), `src/ui/api.ts`(`plan()` 본문 타입)
- Test: `tests/db.test.ts`, `tests/api.flow.test.ts`

**Interfaces:**
- Consumes: Task 1 의 `CaptionEdit`(타입은 `src/shared/types.ts` 에 두고 `core/types.ts` 가 다시 내보낸다 — 브라우저·서버가 같은 정의를 쓰도록).
- Produces: `Job.transcriptEdits: CaptionEdit[] | null`(컬럼 `transcript_edits`, json), `PlanBody.captionEdits?: CaptionEdit[]`(최대 500개, 각 `i` 정수 0 이상, `text` 160자 이하 문자열 또는 null), `JobDto.captionEditCount: number`.

- [ ] **Step 1: 실패하는 시험:** '마이그레이션 7번이 transcript_edits 를 더하고 기존 작업은 NULL' · '옛 DB(버전 6)가 7 로 올라간다' · 'POST /plan 에 captionEdits 를 주면 작업에 저장되고, 안 주면 그대로, 빈 배열이면 비워진다' · '잘못된 본문(문자열이 아닌 text, 음수 i, 501개)은 400' · '다른 버전도 만들기: 새 작업이 부모의 transcriptEdits 를 이어받는다' · 'JobDto.captionEditCount 는 저장된 개수'.
- [ ] **Step 2:** FAIL. **Step 3: 구현**(기존 `script_edits` 와 같은 json 컬럼 방식, 마이그레이션은 `ALTER TABLE jobs ADD COLUMN transcript_edits TEXT;`).
- [ ] **Step 4:** PASS(`tests/db.test.ts tests/api.flow.test.ts tests/ui.api.test.ts`). **Step 5: 커밋** `feat(captions): 고친 자막 저장(마이그레이션 7)`

### Task 3: 인식 결과를 화면에 주는 API

**Files:**
- Create: `app/api/jobs/[id]/captions/route.ts`
- Modify: `src/web/flow.ts` 또는 `src/web/captions.ts`(분석 파일에서 줄 목록 만들기), `src/shared/types.ts`(`CaptionPartDto`, `CaptionReviewDto`), `src/ui/api.ts`(`getCaptions`)
- Test: `tests/api.flow.test.ts`

**Interfaces:**
- Consumes: `reviewParts`(Task 1), `Job.transcriptEdits`(Task 2).
- Produces: `GET /api/jobs/[id]/captions` → `CaptionReviewDto = { parts: { i: number; start: number; end: number; text: string; lowWords: string[] }[]; edits: CaptionEdit[]; hasSpeech: boolean }`. 상태가 `awaiting_reference`·`awaiting_plan`·`failed`(plan 단계)일 때만 200, 분석 파일이 없으면 404, 그 밖의 상태는 409. 로컬 호스트만(`assertLocalHost`). `parts[].text` 는 **원문**(편집 적용 전)이고 `edits` 가 따로 온다.

- [ ] **Step 1: 실패하는 시험:** '분석 뒤 줄 목록과 의심 단어가 온다' · '저장된 편집이 edits 로 함께 온다(원문은 그대로)' · '말이 없는 영상은 parts 가 비고 hasSpeech=false' · '분석 파일이 없으면 404, 진행 중·확정 상태는 409' · '다른 호스트 헤더는 403' · '줄이 250개여도 응답이 작다(줄당 글자만, 단어별 시각은 보내지 않는다 — Review Focus 5)'.
- [ ] **Step 2:** FAIL. **Step 3: 구현**(분석 파일은 라우트 쪽에서 읽는다). **Step 4:** PASS. **Step 5: 커밋** `feat(captions): 인식 결과를 줄로 나눠 주는 API`

### Task 4: 흐름·엔진 — 분석 뒤 멈추기, 계획·제작에 고친 글자 적용, 교정 보호

**Files:**
- Modify: `src/worker/phases.ts`(`analysisPhase`·`planPhase`·`producePhase`), `src/db/status.ts`(필요하면), `src/core/pipeline.ts`(교정에서 사용자가 고친 줄 제외), `src/ui/format.ts`(레이블)
- Test: `tests/worker.test.ts`, `tests/pipeline.test.ts`(또는 `pipeline.director.test.ts`), `tests/ui.format.test.ts`

**Interfaces:**
- Consumes: `applyTranscriptEdits`(Task 1), `Job.transcriptEdits`(Task 2).
- Produces: `analysisPhase` — 분석이 끝나면 **말이 있으면**(레퍼런스를 미리 넣었어도) 항상 `awaiting_reference` 로 간다(추천 검색은 레퍼런스가 없을 때만). 말이 없고 레퍼런스가 있으면 지금처럼 `queued_plan`. 분석 시작 때 `transcriptEdits` 를 비운다. `planPhase`·`producePhase` 는 `analysis.transcript` 에 `applyTranscriptEdits(…, job.transcriptEdits)` 를 입힌 사본을 `prepareEdit`·`produceEdit` 에 넘긴다(`analysis.json` 은 원본 그대로). `produceEdit` 의 자막 교정은 **모든 단어 신뢰도 ≥ 0.999 인 줄(사용자가 고친 줄)** 의 교정을 버린다. 레이블: `awaiting_reference` 의 상태/다음 할 일/목록 버튼을 "자막·레퍼런스 확인" 계열로.

- [ ] **Step 1: 실패하는 시험:** 'worker: 레퍼런스를 미리 넣어도 말이 있으면 분석 뒤 awaiting_reference' · 'worker: 말이 없고 레퍼런스가 있으면 queued_plan(지금 그대로)' · 'worker: 분석 시작 때 예전 transcriptEdits 가 비워진다(Review Focus 1)' · 'worker: planPhase 가 prepareEdit 에 고친 transcript 를 넘기고 analysis.json 은 그대로다' · 'worker: producePhase 도 같다' · 'worker: 모든 줄을 지워도 던지지 않고 계획까지 간다(Review Focus 2)' · 'pipeline: 고친 줄(신뢰도 1)에 대한 교정은 적용도 제안도 되지 않고, 안 고친 줄의 교정은 그대로 된다(Review Focus 3)' · 'api: 다른 버전도 만들기는 분석을 재사용하므로 멈추지 않고 queued_plan(Review Focus 4)' · 'format: awaiting_reference 의 글자가 새 레이블'. 기존 "분석 뒤 queued_plan" 시험은 새 흐름으로 고친다.
- [ ] **Step 2:** FAIL. **Step 3: 구현.** **Step 4:** PASS(전체 `npx vitest run`). **Step 5: 커밋** `feat(captions): 분석 뒤 자막 확인에서 멈추고, 고친 글자로 계획·제작`

### Task 5: 화면 — "자막 확인" 카드

**Files:**
- Create: `src/ui/captions.ts`, `tests/ui.captions.test.ts`, `components/job/CaptionReview.tsx`
- Modify: `components/job/ReferencePicker.tsx`(카드 넣기 + "계속" 때 `captionEdits` 보내기), `src/ui/api.ts`(`plan()` 본문에 `captionEdits`)

**Interfaces:**
- Consumes: `CaptionReviewDto`(Task 3), `plan(jobId, { …, captionEdits })`(Task 2).
- Produces:
```ts
// src/ui/captions.ts (순수)
export type CaptionDraft = Record<number, string | null>            // 줄 번호 → 고친 글자(null = 지움). 안 고친 줄은 없음
export function draftFrom(r: CaptionReviewDto): CaptionDraft         // 저장된 edits 로 시작
export function setPartText(d: CaptionDraft, r: CaptionReviewDto, i: number, text: string): CaptionDraft   // 원문과 같으면 항목을 뺀다
export function togglePartDelete(d: CaptionDraft, i: number): CaptionDraft
export function editsFrom(d: CaptionDraft): CaptionEdit[]            // i 오름차순
export function partProblems(d: CaptionDraft): Record<number, string> // 160자 초과 등
export function visibleParts(r: CaptionReviewDto, onlySuspect: boolean): CaptionReviewDto['parts']
```
- 카드: 영상(`job.media.source`, 맨 위 고정) + 줄 목록. 줄마다 시각 버튼(누르면 그 구간만 재생), 글자 입력, 의심 단어 표시, "지우기/되돌리기". "의심되는 줄만 보기" 토글, 고친 개수 표시. 말이 없으면 카드를 숨긴다. 고치지 않고 "계속"해도 된다. 고친 게 없으면 `captionEdits` 를 보내지 않는다(이미 저장된 편집이 있으면 그 값을 보낸다).

- [ ] **Step 1: 실패하는 시험(`tests/ui.captions.test.ts`):** 'draftFrom: 저장된 편집으로 시작' · 'setPartText: 원문과 같으면 항목이 빠진다, 다르면 들어간다' · 'togglePartDelete: 지움 ↔ 되돌림' · 'editsFrom: i 오름차순, 지운 줄은 text null' · 'partProblems: 160자 초과' · 'visibleParts: 의심 단어가 있는 줄만' · 'draft 가 비면 editsFrom 은 빈 배열'.
- [ ] **Step 2:** FAIL. **Step 3: 구현**(순수 함수 → 컴포넌트). **Step 4: 화면 확인(필수):** 데모 폴더로 개발 서버를 띄워 분석 파일이 있는 작업의 카드를 데스크톱·375px 에서 보고, 글자 고치기·지우기·되돌리기·의심만 보기·시각 눌러 재생·"계속" 뒤 DB 의 `transcript_edits`·콘솔 오류 없음·말 없는 작업에서 카드 숨김을 확인한다(`.next` 정리).
- [ ] **Step 5:** `npx vitest run tests/ui.captions.test.ts tests/boundary.test.ts` PASS. **커밋** `feat(captions): 자막 확인 화면`

### Task 6: 실제 영상으로 끝까지, 문서

**Files:** Modify `README.md`, 프로젝트 메모

- [ ] **Step 1:** 앱을 새로 띄워(`npm run app`, 별도 데이터 폴더) 카카오톡 샘플로 **화면에서** 분석 → 자막 확인(틀린 줄 2~3곳 고침, 한 줄 지움) → 레퍼런스 → 계획 → 승인 → 결과를 돌린다. 결과 영상의 자막이 고친 글자이고, 편집 구성(제목·질문 문구)이 고친 글자를 반영하는지, 검수에 "신뢰도 낮음"이 고친 줄에 안 뜨는지 확인한다. 결과를 장부에 적고 `SendUserFile` 로 보낸다.
- [ ] **Step 2: 문서.** README "화면 사용 순서"에 자막 확인을 넣고(레퍼런스를 미리 넣어도 여기서 멈춘다), "자막 확인" 절(무엇을 하나 · 줄 안 단어별 시각은 근사 · 줄 합치기/쪼개기 없음 · 큰 영상은 줄이 많다 · 고치지 않고 계속해도 된다)과 한계를 쓴다. 프로젝트 메모를 갱신한다.
- [ ] **Step 3:** 전체 `npx vitest run`·`npx tsc --noEmit`·`npm run web:build` PASS(끝나면 `rm -rf .next`). **커밋** `docs(captions): 자막 확인 사용법·한계`
