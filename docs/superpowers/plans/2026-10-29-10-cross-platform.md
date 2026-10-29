# 윈도우·리눅스에서도 되게 하기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline). Steps use checkbox syntax.

**Goal:** 맥이 없는 사람도 윈도우·리눅스에서 `npm run setup` → `npm run app` 으로 쓸 수 있게 한다.

**Architecture:** 맥에만 맞춰진 곳(PATH 조립·도구 찾기·`claude` 호출 환경·앱 실행기·설치 안내)을 `src/core/platform.ts` 한 곳의 순수 함수(플랫폼을 인자로 받는다)로 모으고, 윈도우·리눅스 컴퓨터를 빌리는 GitHub Actions 로 시험을 돌려 확인한다. 맥 동작은 그대로여야 한다.

**Tech Stack:** TypeScript, Node 22+, Vitest, GitHub Actions(ubuntu/windows/macos).

**Spec:** 사용자 요청 2026-10-29 "맥이 아니라 윈도우나 어떤 컴퓨터에서도 되게 만들어줘". 사용자가 윈도우 PC 로 직접 못 돌려 본다고 했고, `hyperframes`·`whisper-cli` 는 윈도우를 지원한다고 알고 있다(확인하지 않음).

## Global Constraints

- 맥에서 지금 되는 동작·기존 시험은 그대로 통과한다(`npx vitest run` 1196개).
- 플랫폼에 따라 달라지는 로직은 `platform`/`env` 를 인자로 받아 맥에서도 윈도우 동작을 시험할 수 있게 한다.
- 사용자에게 보이는 문구는 한국어. 설치 안내는 플랫폼별 명령(맥 brew / 윈도우 winget / 리눅스 apt)을 보인다.
- 윈도우 실제 전체 흐름(음성 인식·hyperframes 렌더)은 못 돌려 본다 — README 에 "자동 시험으로 확인한 범위"를 솔직히 적는다.

## Review Focus

- 윈도우에서 `PATH` 가 `Path` 로 들어와 있어도 자식 프로세스 환경에 PATH 가 한 개만 들어간다.
- 윈도우의 `.cmd` 실행 파일(npm 전역 설치 `hyperframes.cmd`)을 `shell:true` 로 실행하되 공백이 든 인자가 깨지지 않는다.
- `claude` 호출 환경에 윈도우 필수 변수(SystemRoot·USERPROFILE·APPDATA·TEMP·PATHEXT…)가 있고 PATH 가 `;` 로 이어진다.
- 맥에서는 PATH 에 기존 Homebrew 경로가 그대로 들어간다(퇴행 없음).
- 앱 종료 때 윈도우에서 자식 프로세스 트리가 남지 않는다.

---

### Task 1: 플랫폼 도우미와 exec

**Files:** Create `src/core/platform.ts`, `tests/platform.test.ts`; Modify `src/core/exec.ts`

- Produces: `searchPathFor({platform, env, home}): string`, `resolveTool(name, searchPath, {platform, pathext}): string | null`, `withPath(env, searchPath, platform): NodeJS.ProcessEnv`, `spawnPlan(file, args, platform): {command, args, shell}`, `installHint(tool, platform)`.
- [ ] 실패하는 시험: 윈도우 PATH 에 `.exe`·`.cmd` 찾기, 대소문자 없는 `Path` 키 처리, `.cmd` 는 shell+따옴표 인자, 맥/리눅스 PATH 구성
- [ ] 구현 → `exec.ts` 의 `defaultSearchPath`·`run` 이 사용
- [ ] 커밋

### Task 2: `claude` 호출 환경

**Files:** Modify `src/core/llm.ts`, `tests/llm.test.ts`

- [ ] 실패하는 시험: `cleanEnv({platform:'win32'})` 에 SystemRoot 등과 `;` 로 이은 PATH, 맥은 기존과 같은 PATH
- [ ] 구현·커밋

### Task 3: 환경 점검·설치 안내

**Files:** Modify `src/core/env.ts`, `src/core/setup.ts`, `tests/env.test.ts`, `tests/setup.test.ts`

- [ ] 플랫폼별 설치 명령(winget/apt/brew), `swiftc` 는 점검 결과에서 제외, 모델 받기·SHA 확인 명령도 플랫폼별
- [ ] 커밋

### Task 4: 목소리 보정 도구 찾기

**Files:** Modify `src/shared/voice.ts`, `tests/shared.voice.test.ts`

- [ ] 윈도우 `deep-filter.exe`, 실행 가능 판정(윈도우는 확장자)
- [ ] 커밋

### Task 5: 앱 실행기

**Files:** Modify `scripts/app.mjs`, `scripts/app-lib.mjs`, `package.json`; Create `scripts/web.mjs`

- [ ] `next`·`tsx` 를 `process.execPath` 로 직접 실행(.cmd 회피), 윈도우 `taskkill /T /F` 로 트리 종료, `${VAR:-}` 스크립트 제거
- [ ] 커밋

### Task 6: 시험의 POSIX 가정

**Files:** Modify `tests/*` (shebang 가짜 실행 파일 등)

- [ ] 윈도우에서 의미 없는 시험은 `skipIf(win32)`, 나머지는 경로 구분자에 독립적으로
- [ ] 커밋

### Task 7: CI·문서

**Files:** Create `.github/workflows/ci.yml`; Modify `README.md`

- [ ] ubuntu/windows/macos 에서 `npm ci` + ffmpeg 설치 + `tsc` + `vitest`
- [ ] 브랜치를 올려 CI 결과를 보고 윈도우·리눅스 실패를 고친다(반복)
- [ ] README: 플랫폼별 설치, 확인한 범위·한계
- [ ] 커밋
