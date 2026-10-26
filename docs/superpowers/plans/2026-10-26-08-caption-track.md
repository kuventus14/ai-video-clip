# 자막 전부 고치기 (자막 트랙) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 영상의 **모든 자막**을 고칠 수 있게 한다 — 인식된 줄의 글자뿐 아니라, 인식이 놓친 구간에 **새 자막 줄을 추가**하고, 줄마다 **시작·끝 시각**을 고치고, 줄을 **나누고 합치고 지울** 수 있다. 결과 화면에서도 "자막 고치기"로 바로 들어갈 수 있다.

**Architecture:** Plan 6 은 "인식한 줄 번호 → 고친 글자" 편집(`transcript_edits`)만 저장했다. 이 계획은 사용자가 만든 **자막 트랙**(`caption_track`: `{start, end, text}` 줄의 전체 목록)을 작업에 저장한다. 계획·제작은 `applyCaptionTrack` 으로 트랙을 인식 결과(`Transcript`)에 입혀(같은 줄은 원래 단어 그대로, 바뀐·새 줄은 글자 수 비율로 단어를 만들어 신뢰도 1) 지금과 똑같이 컷·자막·편집 감독·검수에 쓴다. **컷은 계속 원래 인식 결과로 계산**하되, 사용자가 인식이 놓친 곳에 넣은 줄은 컷이 잘라 내지 않게 지켜 준다. 트랙이 없으면 예전 `transcript_edits` 경로가 그대로 동작한다(이미 있는 작업이 깨지지 않게).

**Tech Stack:** TypeScript, Next.js 16(app router), node:sqlite, vitest, React 클라이언트 컴포넌트, 기존 `Field`/`Card`/`Button`/`Switch`.

**Spec:** docs/superpowers/specs/2026-10-20-video-autoeditor-design.md. 선행: Plan 6(`2026-10-22-06-caption-review.md`) — 이 계획은 그 편집기를 일반화한다.

## Global Constraints

- 자막의 출처는 계속 음성 인식이다. 이 계획은 인식 결과 위에 사람이 **덧쓰는** 층을 넓힌다(원본 `analysis.json` 은 건드리지 않는다).
- 브라우저 번들(`components/**`, `src/ui/**`)은 node 모듈이나 `core` 를 가져오지 않는다(`tests/boundary.test.ts`). 순수 로직은 `src/shared/` 에 둔다.
- 마이그레이션 8번 하나(`caption_track`). 이미 있는 작업은 NULL. (`upload` 브랜치는 합칠 때 9번으로 옮긴다.)
- 사용자가 고친·새로 만든 줄의 단어 신뢰도는 1(검수 교정이 다시 바꾸지 않는다). 바뀌지 않은 줄은 원래 단어·신뢰도 그대로.
- **자막을 고치거나 지워도 영상은 그대로**: 컷은 원래 인식 결과 기준(Plan 6 의 `cutTranscript`). 새로 넣은 줄 구간만 컷에서 지킨다.
- 줄 한도: 글자 160자 이하(공백 포함), 줄 길이 0.2초 이상, 줄끼리 겹치지 않음, 시각은 0 이상·영상 길이(+0.5초) 이하, 줄 수 800 이하. 서버(zod)와 화면이 같은 규칙을 쓴다.
- 문구는 한국어 존댓말. 시험은 TDD, 화면은 실제로 띄워 눈으로 확인(데스크톱·375px).

## Review Focus

1. **줄끼리 겹침·순서·0길이**: 시각을 고치다 이웃 줄과 겹치거나 뒤집히면 자막이 사라지거나 깜빡임 → 화면이 막고, 서버도 거절한다.
2. **인식이 놓친 구간에 넣은 줄이 컷에 잘려 나감**: 그 구간이 조용하면 무음으로 잘려 자막도 사라진다 → 새 줄은 컷에서 지킨다.
3. **트랙과 예전 편집(`transcript_edits`)이 섞임**: 트랙이 있으면 트랙만 쓰고, 없으면 예전 경로. 두 경로가 같은 작업에서 충돌하지 않는다. "다른 버전도 만들기"도 트랙을 이어받는다.
4. **긴 영상(줄 수백 개)**: 화면이 느려지지 않고, 저장 본문이 한도 안(800줄·줄당 160자)이다.
5. **저장 전에 나가기·되돌리기**: 저장하지 않은 고침 경고, "원래대로"(인식 결과로 되돌리기)가 서버의 저장된 트랙도 비운다.

---

### Task 1: 자막 트랙 순수 로직 (shared)

**Files:** Modify `src/shared/captionReview.ts`, `src/shared/types.ts`; Test `tests/captionTrack.test.ts`

**Interfaces — Produces:**
```ts
// src/shared/types.ts
export interface CaptionLine { start: number; end: number; text: string }
// src/shared/captionReview.ts
export const CAPTION_LINE_LIMITS: { maxText: 160; minSec: 0.2; maxLines: 800; overlapSec: 0.01; endSlackSec: 0.5 }
export function captionLinesOf(t: Pick<ReviewTranscript,'words'>): CaptionLine[]            // reviewParts → 줄 목록(원본)
export function captionLineProblems(lines: CaptionLine[], durationSec: number): (string | null)[]  // 줄마다 한국어 문제(없으면 null), 순서·겹침·길이·시각·글자 검사
export function applyCaptionTrack<T extends ReviewTranscript>(t: T, track: CaptionLine[] | null | undefined): T
export function cutTranscriptFor<T extends ReviewTranscript>(t: T, track: CaptionLine[] | null | undefined): T   // 원래 단어 + 새 줄 구간의 가짜 단어(컷이 지킴)
export function removedSpans(t: Pick<ReviewTranscript,'words'>, track: CaptionLine[] | null | undefined): { start: number; end: number }[]  // 인식된 말이 있는데 줄이 없는 구간
```
- `applyCaptionTrack`: 트랙이 null/undefined 면 입력 그대로. 줄을 시작순으로 보고, 원래 한 줄(`reviewParts`)과 **글자·시작·끝(±0.05초)이 같으면 그 원래 단어를 그대로**, 아니면 그 줄 구간에 걸친 원래 단어의 말한 구간에만(없으면 줄 전체 구간) 글자 수 비율로 단어를 만든다(신뢰도 1, 0.1초 미만 조각은 합침 — Plan 6 의 `spreadWords`). 트랙에 없는 원래 줄의 단어는 빠진다. 빈 글자·공백뿐인 줄은 무시. 결과 `segments`·`hasSpeech` 다시 계산. 입력은 바꾸지 않는다.
- `cutTranscriptFor`: 원래 단어 전부 + 원래 단어와 겹치지 않는 트랙 줄마다 그 줄 구간의 가짜 단어 하나(신뢰도 1).
- `removedSpans`: 원래 줄(`reviewParts`) 중 트랙의 어떤 줄과도 30% 이상 겹치지 않는 줄의 구간. 트랙이 null 이면 빈 목록.

- [ ] **Step 1: 실패하는 시험:** `captionLinesOf`(줄 번호 순서·시각) · `captionLineProblems`('겹침', '끝이 시작보다 빠름', '0.2초 미만', '160자 초과', '영상 길이 밖', '정상은 null') · `applyCaptionTrack`('트랙 null 은 그대로' · '바뀌지 않은 줄은 원래 단어·신뢰도 그대로' · '글자만 바꾼 줄은 신뢰도 1' · '시각만 옮긴 줄은 새 구간에 단어' · '인식이 놓친 구간의 새 줄은 줄 전체 구간에 단어' · '트랙에 없는 원래 줄은 빠짐' · '줄이 시작순이 아니어도 정렬' · '빈 글자 줄 무시' · '쉬는 구간에는 단어가 시작·끝나지 않음(Plan 6 C2)' · '원본 불변') · `cutTranscriptFor`('새 줄 구간이 가짜 단어로 지켜짐, 원래와 겹치는 줄은 안 늘어남') · `removedSpans`('줄이 없는 원래 줄만').
- [ ] **Step 2:** FAIL. **Step 3: 구현**(Plan 6 의 `spreadWords`·`speechIntervals` 재사용, 줄 구간으로 자른 원래 단어를 넘긴다). **Step 4:** PASS. **Step 5: 커밋** `feat(track): 자막 트랙 순수 로직`

### Task 2: 저장 (DB·API)

**Files:** Modify `src/db/db.ts`(마이그레이션 8), `src/db/jobs.ts`, `src/web/schemas.ts`, `app/api/jobs/[id]/plan/route.ts`, `src/web/flow.ts`, `src/web/dto.ts`, `src/shared/types.ts`(`PlanInput.captionTrack`, `JobDto.captionEditCount` 의미), `src/web/captions.ts`, `app/api/jobs/[id]/captions/route.ts`; Test `tests/db.test.ts`, `tests/api.flow.test.ts`

**Interfaces:**
- `Job.captionTrack: CaptionLine[] | null`(컬럼 `caption_track`, json). `PlanBody.captionTrack?: CaptionLine[] | null` — 보내지 않으면 그대로, `null` 이면 비워 인식 결과로 되돌리고(예전 `transcript_edits` 도 비운다), 배열이면(빈 배열 포함) 저장. 서버는 시작순 정렬 후 `captionLineProblems` 로 검사해 문제가 있으면 400(한국어), 영상 길이는 작업의 `sourceInfo.durationSec`.
- `GET /api/jobs/[id]/captions` 응답을 `CaptionReviewDto = { durationSec, hasSpeech, original: CaptionLine[], lines: CaptionLine[], custom: boolean }` 로 바꾼다(`lines` = 저장된 트랙 → 없으면 예전 편집을 입힌 줄 → 없으면 원본, `custom` = 트랙·예전 편집이 있나). 열리는 상태에 **`awaiting_confirm`** 을 더한다(결과 화면에서 들어가는 길). 줄마다 `lowWords` 는 원본 줄에서만 의미가 있어 응답에서 뺀다 — 의심 표시는 `original[].lowWords` 로 준다(`CaptionLine & { lowWords?: string[] }` → `original: (CaptionLine & {lowWords: string[]})[]`).
- "다른 버전도 만들기"가 `captionTrack` 도 이어받는다.

- [ ] **Step 1: 실패하는 시험:** '마이그레이션 8 이 caption_track 을 더하고 기존 작업은 NULL, 버전 7 DB 가 8 로 올라감' · 'POST /plan 에 captionTrack 을 주면 저장(정렬됨), 안 주면 그대로, null 이면 트랙과 예전 편집 둘 다 비움, 빈 배열은 빈 트랙' · '겹침·0.2초 미만·160자 초과·영상 길이 밖·801줄·알 수 없는 칸은 400 이고 저장 안 됨' · '다른 버전이 트랙을 이어받음' · 'GET /captions: 원본/현재 줄/custom, 트랙이 있으면 그것, 예전 편집만 있으면 그것을 입힌 줄, awaiting_confirm 에서도 열림, 확정(confirmed)은 409' (기존 Plan 6 의 GET 시험은 새 응답 모양으로 고친다).
- [ ] **Step 2:** FAIL. **Step 3: 구현.** **Step 4:** PASS(`db`·`api.flow`·`ui.api`). **Step 5: 커밋** `feat(track): 자막 트랙 저장(마이그레이션 8)`

### Task 3: 흐름·엔진

**Files:** Modify `src/worker/phases.ts`, `src/core/pipeline.ts`(필요하면); Test `tests/worker.test.ts`, `tests/pipeline.director.test.ts`

**Consumes:** `applyCaptionTrack`, `cutTranscriptFor`, `removedSpans`(Task 1), `Job.captionTrack`(Task 2).
- `planPhase`: `analysis.transcript` 를 `job.captionTrack ? applyCaptionTrack(...) : applyTranscriptEdits(...)` 로 바꿔 `prepareEdit` 에 넘기고, `deletedSpans` 는 트랙이면 `removedSpans`, 아니면 `deletedParts`. `producePhase` 도 같다. 제작의 `cutTranscript` 는 트랙이 있으면 `cutTranscriptFor(raw.transcript, track)`, 아니면 `raw.transcript`.
- 분석을 새로 하면(`analysisPhase`) 예전 인식 줄에 맞춘 트랙도 비운다(편집과 같이).

- [ ] **Step 1: 실패하는 시험:** 'plan: 트랙이 있으면 고친 transcript 를 넘기고 analysis.json 은 그대로' · 'produce: 같은 transcript + cutTranscript 에 새 줄 구간이 지켜짐(인식 놓친 구간의 새 줄이 컷에서 안 잘림 — Review Focus 2)' · '트랙이 없고 예전 편집만 있으면 예전 경로 그대로(Review Focus 3)' · '트랙이 빈 배열이면(자막 전부 지움) 던지지 않고 계획·제작까지, 컷은 원래 기준' · 'plan: 줄이 없는 원래 구간이 deletedSpans 로 감독에게 감' · '분석 재실행이 트랙도 비움' · 'pipeline: 새 줄(신뢰도 1)은 검수 교정이 안 바꿈'.
- [ ] **Step 2:** FAIL. **Step 3: 구현.** **Step 4:** PASS(전체 `npx vitest run`). **Step 5: 커밋** `feat(track): 자막 트랙으로 계획·제작`

### Task 4: 자막 편집기 화면

**Files:** Create `src/ui/captionTrack.ts`, `tests/ui.captionTrack.test.ts`; Modify `components/job/CaptionReview.tsx`(편집기로 개편), `components/job/ReferencePicker.tsx`, `src/ui/captions.ts`(예전 줄 번호 편집 로직 정리), `src/ui/api.ts`

**Interfaces — Produces (순수, `src/ui/captionTrack.ts`):**
```ts
export type Lines = CaptionLine[]
export function setText(l: Lines, i: number, text: string): Lines
export function setStart(l: Lines, i: number, t: number): Lines     // 앞 줄 끝~이 줄 끝-0.2 로 맞춘다(겹치지 않게)
export function setEnd(l: Lines, i: number, t: number): Lines       // 이 줄 시작+0.2~다음 줄 시작(또는 영상 끝) 으로 맞춘다
export function removeLine(l: Lines, i: number): Lines
export function addLineAt(l: Lines, startSec: number, durationSec: number, videoSec: number): Lines   // 그 시각에 빈 줄(글자 없음)을 끼운다, 이웃과 겹치면 줄여서
export function splitLine(l: Lines, i: number, charIndex: number): Lines   // 글자를 charIndex 에서 나누고 시간은 글자 수 비율로(각 0.2초 이상이어야, 아니면 그대로)
export function mergeWithNext(l: Lines, i: number): Lines
export function gapsOf(l: Lines, videoSec: number, minGapSec?: number): { start: number; end: number }[]   // 1초 이상 비어 있는 구간(앞·뒤 포함)
export function trackToSend(l: Lines): CaptionLine[]   // 빈 글자 줄을 빼고 trim·0.01초로 반올림
export function isDirty(original: Lines /*서버가 준 현재 lines*/, current: Lines): boolean
export function sameAsOriginal(original: Lines, current: Lines): boolean
```
- 화면: 영상 + **전체 타임라인을 시간순 한 목록**으로 — 줄(시각 버튼·시작/끝 입력·글자 입력·지우기·나누기·아래와 합치기)과 **빈 구간 행**("자막이 없는 구간 17.0~20.1초 — 여기에 자막 추가")이 섞여 나온다. "의심되는 줄만 보기"는 원본 줄이 그대로인 경우만 의미 있으므로 유지하되 빈 구간·바꾼 줄은 항상 보인다. 맨 위에 "줄 추가"(영상 재생 위치에 추가), "원래대로"(인식 결과로 되돌리기, 확인 후). 문제(겹침 등)는 줄 옆에 보이고 있으면 "계속"이 막힌다. 저장하지 않은 고침 경고(Plan 6 의 `beforeunload`·취소 확인)는 새 `isDirty` 로.
- "계속" 때: 원래대로면 `captionTrack: null`(서버에 저장된 것이 있으면), 안 바뀌었으면 보내지 않고, 바뀌었으면 `trackToSend(lines)`.

- [ ] **Step 1: 실패하는 시험(`tests/ui.captionTrack.test.ts`):** 위 순수 함수마다 정상·경계(겹침 방지, 0.2초 최소, 영상 끝, 빈 목록, 나누기 시간 비율·너무 짧으면 거절, 합치기 글자·시간, 빈 구간 계산 앞·사이·뒤, trackToSend 가 빈 줄을 빼고 반올림, isDirty/sameAsOriginal).
- [ ] **Step 2:** FAIL. **Step 3: 구현**(순수 함수 → 컴포넌트). **Step 4: 화면 확인(필수):** 데모 폴더에 실제 인식 결과(`.../analysis.json` 의 transcript, 17~20초가 비는 것)를 넣고 데스크톱·375px 에서 — 줄 글자 고치기, **빈 구간(17~20초)에 줄 추가**, 시작·끝 시각 고치기(이웃과 겹치려 하면 막힘), 나누기·합치기, 지우기·되돌리기, "원래대로", 긴 영상(200줄)에서의 반응, 말 없는 영상, 저장 전 나가기 경고, 콘솔 오류 없음. **Step 5: 커밋** `feat(track): 자막 편집기 — 줄 추가·시각·나누기·합치기`

### Task 5: 들어가는 길 (결과 화면·계획 확인 화면)

**Files:** Modify `components/job/ResultReview.tsx`, `components/job/JobView.tsx`, `components/job/PlanApproval.tsx`, `src/ui/format.ts`(필요하면); Test `tests/ui.format.test.ts`

- 결과 화면(`awaiting_confirm`)에 **"자막 고치기"** 버튼 → 자막 편집기(`ReferencePicker` 화면)가 열리고, "계속"하면 계획부터 다시(고친 자막으로) 만든다. 계획 확인 화면의 버튼 글자를 **"자막·레퍼런스 바꾸기"** 로. 확정된 작업(`confirmed`)에는 버튼이 없다(서버도 막는다).

- [ ] **Step 1: 실패하는 시험:** 버튼 글자·보이는 상태(awaiting_confirm 만) 순수 함수가 있으면 그것을 시험. **Step 2~3: 구현 + 화면 확인(결과 화면에서 눌러 편집기가 열리고 취소로 돌아옴).** **Step 4: 커밋** `feat(track): 결과 화면에서 자막 고치기`

### Task 6: 실제 영상으로 끝까지, 문서

**Files:** Modify `README.md`, 프로젝트 메모

- [ ] **Step 1:** 앱을 새로 띄워(`npm run app`, 별도 데이터 폴더) 카카오톡 샘플로 **화면에서** 끝까지: 분석 → 자막 편집기에서 틀린 줄 고치기·**인식이 놓친 17~20초에 줄 추가**·시각 옮기기·한 줄 나누기·두 줄 합치기 → 계획 → 승인 → 결과 영상의 자막이 편집한 대로(추가한 줄 포함)이고 컷이 달라지지 않았는지 확인 → 결과 화면의 "자막 고치기"로 다시 열어 한 줄 고쳐 다시 만들기. 결과를 장부에 적고 `SendUserFile` 로 보낸다.
- [ ] **Step 2: 문서.** README "자막 확인" 절을 "자막 편집"으로 고쳐(할 수 있는 것: 글자·지우기·줄 추가·시각·나누기·합치기·원래대로, 들어가는 길 3곳; 한계: 줄은 18자 안팎으로 자동 나뉘어 시작하지만 나누기·합치기로 바꿀 수 있음, 화면의 줄이 영상에 뜨는 자막 조각과 1:1 은 아님 — 영상의 자막은 한 줄 14자·2.5초 안에서 다시 묶임, 줄 안 단어별 시각은 근사). 프로젝트 메모 갱신.
- [ ] **Step 3:** 전체 `npx vitest run`·`npx tsc --noEmit`·`npm run web:build` PASS(끝나면 `rm -rf .next`). **커밋** `docs(track): 자막 편집 사용법·한계`
