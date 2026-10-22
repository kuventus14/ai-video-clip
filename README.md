# 영상 자동 편집

영상 1개를 올리고 따라 하고 싶은 레퍼런스를 고르면, 컷·자막·제목 카드·구도를 레퍼런스처럼 맞춰 자동으로 편집하고, 자막 오타·화질·오디오·구도까지 검수한 결과를 돌려줍니다. 내 맥에서만 도는 웹앱이에요(로그인 없음). 설계: `docs/superpowers/specs/`, 계획: `docs/superpowers/plans/`.

## 실행 (한 줄)

```bash
npm run app
```

브라우저에서 **http://127.0.0.1:4848** 을 여세요. 화면(웹 서버)과 처리 프로그램(워커)이 함께 켜지고, 로그 앞에 `[web]` / `[worker]` 가 붙어요. 끄려면 `Ctrl+C` — 처리 중인 작업이 있으면 끝날 때까지 기다리고, 한 번 더 누르면 바로 꺼져요(그 작업은 다음에 "중단됐어요"로 보여요). 처음 켜거나 소스가 바뀐 뒤에는 화면을 한 번 빌드해요(1~2분). 개발할 때는 `npm run app:dev`.

## 화면 사용 순서

1. **새 영상** — 영상을 끌어다 놓거나 고르세요(mp4·mov·m4v·webm·mkv·avi, 1초~10분). 올리는 중에도 설명(선택)을 쓰고 **용도**를 고를 수 있어요. 용도는 올린 영상을 보고 자동 인식하지만, 직접 고른 값이 항상 우선이에요. 레퍼런스가 있다면 링크나 파일로 넣어도 돼요. → **분석 시작**
2. **분석** — 음성 인식, 영상 내용 파악, 비슷한 인기 영상 찾기. 1분짜리 영상 기준 30~40초.
3. **레퍼런스 고르기** — 추천 카드, 링크, 파일 중 하나(없이도 가능). 레퍼런스에서 어떤 부분을 참고할지 자연어로 적을 수 있어요. → 계속
4. **"이렇게 이해했어요"** — AI가 이해한 편집 계획을 보고 승인하세요. 이번 버전에서 지원하지 않는 항목은 노란 줄로 알려 줘요. 용도·자막(영상에 이미 자막이 있으면 끄세요)·**소리**(원본 그대로 / 목소리 또렷하게)·화질을 바꾸거나 요청을 고쳐 계획을 다시 만들 수 있어요. 목소리 또렷하게는 아래 "목소리 보정 설치"를 먼저 해 두세요.
5. **제작** — 1분짜리 영상 기준 2분쯤. 화면을 닫아도 계속돼요(기록에서 다시 열기).
6. **결과 확인** — 영상을 보고 검수 리포트를 확인하세요. 리포트에는 검수가 확인하지 **않은** 항목도 적혀 있어요. **확정**하면 기록에 저장돼요. 고치고 싶으면 **수정 요청**, 반대 용도(가로↔세로)가 필요하면 **다른 버전도 만들기**(분석과 레퍼런스는 다시 하지 않아요).

유튜브·인스타그램·네이버 클립 업로드는 다음 단계에서 붙어요. 지금은 결과 영상을 내려받아 올려 주세요.

## 목소리 보정 설치 (선택)

계획 승인 화면의 **소리 → 목소리 또렷하게**는 AI 소음 제거 도구 [DeepFilterNet](https://github.com/Rikorose/DeepFilterNet)의 `deep-filter`(실행 파일 1개, 약 27MB)를 써요. 설치하지 않으면 "원본 그대로"만 쓸 수 있고, 목소리 또렷하게를 고르면 설치하라고 알려 줘요.

```bash
mkdir -p ~/.local/share/deep-filter && cd ~/.local/share/deep-filter
gh release download v0.5.6 -R Rikorose/DeepFilterNet -p 'deep-filter-0.5.6-aarch64-apple-darwin' -O deep-filter
echo "4601e7f4e4c03e59a4c5b5000216ef3add3e808799cfccd95e14e83ea4611081  deep-filter" | shasum -a 256 -c -
chmod +x deep-filter
```

마지막 줄 앞의 검사에서 `deep-filter: OK` 가 나와야 해요(받은 파일이 이 README 를 쓸 때 확인한 파일과 같다는 뜻이에요). 다른 위치에 두려면 `VAE_DEEP_FILTER=/경로/deep-filter` 환경변수를 써요. 인텔 맥이나 리눅스는 릴리스 페이지에서 맞는 파일을 받고 해시는 직접 확인하세요.

- 소리 처리는 영상 화면을 다시 인코딩하지 않고 **소리만** 바꿔요: AI 소음 제거 → 말소리 대역 정리 → 소리 크기를 -16 LUFS 로 맞춤. 20초 영상 소리를 몇 초에 처리해요.
- macOS 에서는 인터넷을 막은 채(`sandbox-exec`) 실행해요. 이 도구는 소리 파일 하나를 처리하는 데 인터넷이 필요 없어요.
- **한계:** 소음은 줄고 크기는 맞지만, **방의 울림은 많이 줄지 않아요.** 마이크를 입 가까이 두지 않고 찍은 영상은 스튜디오 녹음처럼 되지 않아요. 울림 제거 AI 는 나중에 붙일 수 있게 이 단계를 따로 뒀어요. 영상 하나(소음 있는 야외 레슨)로만 강도를 정했어요.


## 데이터

- `data/app.db` — 작업 목록과 상태, `data/jobs/<작업 id>/` — 올린 영상·분석 결과·`out/result.mp4`·`out/report.json`. git 에는 올라가지 않아요.
- 다른 곳에 두려면 `VAE_DATA_DIR=/경로 npm run app`. 작업을 지우면(화면의 휴지통) 그 작업 폴더도 지워져요.
- 포트를 바꾸려면 `VAE_PORT=4949 npm run app`.

## 한계 (실측: 맥 8GB)

| 입력 | 분석 | 제작(렌더+검수) | 최대 메모리 | 임시 디스크 |
|---|---|---|---|---|
| 세로 57초(실제 샘플), 세로 결과 | 약 30초 | 100초 | 약 0.8GB | — |
| 세로 57초 → 가로(블러 배경) | 계획 4초 | 120초 | 약 1GB | — |
| **세로 10분 → 가로(블러 배경)**, 무음 구간 60곳 컷 → 결과 4분 8초 | 21초 | **570초(약 9.5분)** | **약 0.9GB**(워커와 렌더 프로세스 합) | **최대 약 3GB**(렌더 중), 작업 폴더 427MB |

- 제작 시간은 결과 길이의 2~3배쯤이에요(10분 영상을 무음 컷 없이 그대로 만들면 그만큼 더 걸려요). 작업은 **한 번에 하나**씩 처리하고 나머지는 순서를 기다려요.
- 입력은 1초~10분. BGM·효과음·하단 자막바, 카메라 워크·실사 합성 VFX 는 이번 버전에 없어요. 용도마다 결과는 하나예요.
- 음성이 많은 10분 영상의 분석 시간은 아직 재지 못했어요(위 10분 영상은 소리만 있고 말이 없어서 분석이 빨리 끝났어요).
- 제작 중에는 다른 무거운 앱(영상 편집기·브라우저 탭 여러 개)을 닫아 두세요.

## 문제가 생기면

- **"이미 다른 프로그램이 포트를 쓰고 있어요"** — 앱이 이미 켜져 있는지 보거나 `VAE_PORT` 로 다른 포트를 쓰세요.
- **"순서를 기다리는 중이에요"가 계속돼요** — 처리 프로그램이 꺼져 있는 거예요. `npm run app` 으로 켰는지 확인하세요(워커가 죽으면 3초 뒤 자동으로 다시 켜져요).
- **"작업이 중간에 멈췄어요"** — 앱이 꺼졌거나 맥이 잠들었어요. **다시 시도**를 누르면 멈춘 단계부터 이어서 해요.
- **추천이 비어 있어요** — 인터넷이 안 되거나 `yt-dlp` 가 오래됐을 수 있어요(`uv tool upgrade yt-dlp`). 링크나 파일로 직접 고르거나 레퍼런스 없이 계속할 수 있어요.
- **레퍼런스 링크가 안 받아져요** — 비공개이거나 로그인이 필요한 영상이에요(인스타그램 등). 영상을 mp4 로 받아 파일로 올려 주세요.
- **렌더가 실패해요** — 메모리가 부족할 수 있어요. 다른 앱을 닫고 `hyperframes doctor` 로 점검하세요.
- **`claude` 오류** — 터미널에서 `claude` 를 한 번 실행해 로그인돼 있는지 확인하세요.

## 필요한 도구

Node 22+, `ffmpeg`, `whisper-cpp`(+ 모델 `~/.cache/hyperframes/whisper/models/ggml-small.bin`), `hyperframes`, `yt-dlp`, Xcode(`swiftc` — 사람 인식), 로그인된 `claude`.

```bash
brew install ffmpeg whisper-cpp && npm i -g hyperframes && uv tool install yt-dlp && npm install
```

whisper 모델은 `hyperframes init <폴더> --video <영상> --language ko --model small` 를 한 번 돌리면 받아져요. 환경 점검: `npx tsx -e "import('./src/core/env.ts').then(m=>m.checkEnvironment()).then(r=>console.log(JSON.stringify(r,null,1)))"`

## 명령줄로 쓰기 (화면 없이)

```bash
npm run edit -- --video ~/Desktop/내영상.mp4 --out data/결과 \
  --reference "https://www.youtube.com/shorts/xxxx" \
  --description "골프 레슨 영상입니다" \
  --request "자막 스타일만 따라 하고 컷은 더 빠르게"
```

| 옵션 | 뜻 |
|---|---|
| `--video` `--out` | 필수. 결과 폴더에 `result.mp4`, `report.json` 이 생겨요 |
| `--reference` | 레퍼런스 mp4 경로 또는 유튜브·인스타 링크 (없으면 기본 스타일) |
| `--description` | 영상 설명 (없으면 AI가 영상을 보고 판단) |
| `--purpose auto\|post\|short` | 게시물용(가로) / 릴스·숏츠용(세로). 기본 `auto`, 직접 고르면 그 값이 우선 |
| `--request` | 레퍼런스에서 참고할 부분 (없으면 AI가 알아서) |
| `--quality draft\|looks\|delivery` | 렌더 화질. 기본 `looks` |
| `--captions auto\|off` | 자막. 영상에 이미 자막이 구워져 있으면 `off` |

## 시험

```bash
npx vitest run                  # 기본 (합성 영상 + 가짜 claude)
INTEGRATION=1 npx vitest run    # 실제 샘플 영상·유튜브 내려받기까지 (샘플: ~/Desktop/롱아이언_릴스_편집본.mp4)
npm run seed:demo               # 모든 상태의 시연 작업을 data-demo/ 에 만든다 (화면 확인용)
VAE_DATA_DIR=data-demo npm run web:dev   # 시연 데이터로 화면만 켜기 (워커 없음)
```

## 구조

- `src/core/` 편집 엔진 — `media` 영상 정보·H.264 변환 · `transcribe` whisper · `purpose` 용도 인식 · `understand` 영상 이해 · `reference` 레퍼런스 받기 · `search` 추천 · `styleSpec` 레퍼런스 분석 · `interpret` 요청 해석 · `person`+`reframe` 인물 추적·크롭 · `cuts` 컷 계획 · `timeline` 컷 이후 시간 변환·자막 큐 · `compose` hyperframes 프로젝트·렌더 · `qaChecks`+`qa` 검수 · `pipeline` 분석→계획→제작 · `llm` `claude -p` 호출.
- `src/worker/` 처리 프로그램(작업을 하나씩 집어 단계별로 실행) · `src/db/` SQLite 작업 저장소와 상태 기계 · `src/web/`+`app/api/` API · `app/`+`components/`+`src/ui/` 화면 · `src/shared/` 화면·서버가 같이 쓰는 타입.
- 화면과 서버 쪽 코드는 `src/core`·`src/worker` 를 직접 불러오지 않아요(`tests/boundary.test.ts` 가 지켜요).
- 화면 디자인 노트: `docs/superpowers/plans/2026-10-20-02-design-notes.md`, 제품 맥락: `PRODUCT.md`.
