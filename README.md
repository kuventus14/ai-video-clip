# 영상 자동 편집 (편집 코어)

영상 1개를 넣으면 용도(게시물 가로 / 릴스·숏츠 세로)에 맞게 컷·자막·제목 카드·크롭을 적용해 [hyperframes](https://hyperframes.heygen.com) 로 렌더링하고, 검수(자막 오타·화질·오디오·구도)까지 거친 mp4 와 리포트를 만듭니다. 화면(웹앱)과 업로드는 다음 계획에서 붙입니다. 설계: `docs/superpowers/specs/`, 계획: `docs/superpowers/plans/`.

## 쓰는 법

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

진행 중에 "이렇게 이해했어요" 카드가 나오고, 끝나면 검수 결과가 요약돼요. 자세한 내용은 `report.json` 에 있어요.

## 필요한 도구

Node 22+, `ffmpeg`, `whisper-cpp`(+ 모델 `~/.cache/hyperframes/whisper/models/ggml-small.bin`), `hyperframes`, `yt-dlp`, Xcode(`swiftc` — 사람 인식), 로그인된 `claude`.

```bash
brew install ffmpeg whisper-cpp && npm i -g hyperframes && uv tool install yt-dlp && npm install
```

whisper 모델은 `hyperframes init <폴더> --video <영상> --language ko --model small` 를 한 번 돌리면 받아져요. 환경 점검: `npx tsx -e "import('./src/core/env.ts').then(m=>m.checkEnvironment()).then(r=>console.log(JSON.stringify(r,null,1)))"`

## 시험

```bash
npx vitest run                  # 기본 (합성 영상 + 가짜 claude)
INTEGRATION=1 npx vitest run    # 실제 샘플 영상·유튜브 내려받기까지 (샘플: ~/Desktop/롱아이언_릴스_편집본.mp4)
```

## 구조 (`src/core/`)

`media` 영상 정보·H.264 변환 · `transcribe` whisper · `purpose` 용도 인식 · `understand` 영상 이해 · `reference` 레퍼런스 받기 · `styleSpec` 레퍼런스 분석 · `interpret` 요청 해석 · `person`+`reframe` 인물 추적·크롭 · `cuts` 컷 계획 · `timeline` 컷 이후 시간 변환·자막 큐 · `compose` hyperframes 프로젝트·렌더 · `qaChecks`+`qa` 검수 · `pipeline` 전체 흐름 · `llm` `claude -p` 호출.

## 문제가 생기면

- **렌더가 멈추거나 실패**: 맥 메모리가 부족할 수 있어요(8GB 에서 확인됨). 다른 앱을 닫고 `hyperframes doctor` 로 점검하세요.
- **레퍼런스 링크가 안 받아져요**: 비공개이거나 로그인이 필요한 영상이에요. 영상을 mp4 로 받아 `--reference 파일경로` 로 주세요.
- **`claude` 오류**: 터미널에서 `claude` 를 한 번 실행해 로그인돼 있는지 확인하세요.
- **세로 크롭이 중앙으로만 가요**: 사람이 안 잡힌 거예요. `report.json` 의 `crop-no-person` 경고를 확인하세요.
