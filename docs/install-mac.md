# 맥에서 설치하기

영상 자동 편집을 **내 맥에서** 쓰기 위한 설치 안내예요. (윈도우는 [윈도우에서 설치하기](install-windows.md), 처음 소개는 [README](../README.md).)

- **필요한 것:** 맥(애플 칩 권장, 메모리 8GB 이상), 그리고 **[Claude Code](https://claude.com/claude-code) 설치와 로그인**. AI 가 필요한 단계마다 `claude` 명령을 쓰고, **사용량은 로그인한 본인 계정에서 나가요.** 영상 한 편에 AI 호출이 여러 번 들어가요.
- 영상은 내 맥 밖으로 나가지 않아요. 레퍼런스 검색과 AI 호출에만 인터넷을 써요.
- 개발자가 직접 써 보고 확인한 것은 맥이에요.

## 1. 프로그램 설치 (터미널)

[Homebrew](https://brew.sh) 가 없다면 먼저 설치하세요. 그다음:

```bash
brew install ffmpeg whisper-cpp node uv
npm i -g hyperframes
uv tool install yt-dlp
```

Claude Code 는 터미널에서 `curl -fsSL https://claude.ai/install.sh | bash` 로 설치한 뒤(자세한 방법은 [공식 안내](https://claude.com/claude-code)), 터미널에서 `claude` 를 한 번 실행해 로그인하세요.

## 2. 앱 받아서 켜기

```bash
git clone https://github.com/kuventus14/ai-video-clip.git
cd ai-video-clip
npm install
npm run setup     # 빠진 게 있으면 설치 방법을 알려 줘요(음성 인식 모델 465MB 를 받는 명령도 나와요)
npm run app       # 그다음 브라우저에서 http://127.0.0.1:4848
```

끄려면 터미널에서 `Ctrl+C` — 처리 중인 작업이 있으면 끝날 때까지 기다리고, 한 번 더 누르면 바로 꺼져요(그 작업은 다음에 "중단됐어요"로 보여요).
다른 포트로 켜려면 `VAE_PORT=4949 npm run app`.

## 3. 목소리 보정 설치 (선택)

소리를 또렷하게 하는 기능이에요. 설치하지 않으면 "원본 그대로"만 쓸 수 있어요. 터미널에서(애플 칩):

```bash
mkdir -p ~/.local/share/deep-filter && cd ~/.local/share/deep-filter
curl -L -o deep-filter https://github.com/Rikorose/DeepFilterNet/releases/download/v0.5.6/deep-filter-0.5.6-aarch64-apple-darwin
echo "4601e7f4e4c03e59a4c5b5000216ef3add3e808799cfccd95e14e83ea4611081  deep-filter" | shasum -a 256 -c -
chmod +x deep-filter
```

`deep-filter: OK` 가 나와야 해요(받은 파일이 이 안내를 쓸 때 확인한 파일과 같다는 뜻이에요). 인텔 맥은 [릴리스 페이지](https://github.com/Rikorose/DeepFilterNet/releases/tag/v0.5.6)에서 `x86_64-apple-darwin` 파일을 받고 해시는 직접 확인하세요. 다른 위치에 두려면 `VAE_DEEP_FILTER=/경로/deep-filter` 환경변수를 써요. 맥에서는 이 도구를 인터넷을 막은 채(`sandbox-exec`) 실행해요.

## 막히면

- `npm run setup` 을 다시 실행해 보세요 — 빠진 프로그램과 설치 명령을 알려 줘요.
- 화면의 진행 기록과 터미널의 `[web]` / `[worker]` 로그를 알려 주세요.
- 자세한 사용법·한계는 [README](../README.md) 를 보세요.
