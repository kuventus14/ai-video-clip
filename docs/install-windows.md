# 윈도우에서 설치하기

영상 자동 편집을 **내 윈도우 PC(10/11)** 에서 쓰기 위한 설치 안내예요. (맥은 [맥에서 설치하기](install-mac.md), 처음 소개는 [README](../README.md).)

- **필요한 것:** 윈도우 10/11 (메모리 8GB 이상 권장), 그리고 **[Claude Code](https://claude.com/claude-code) 설치와 로그인**. AI 가 필요한 단계마다 `claude` 명령을 쓰고, **사용량은 로그인한 본인 계정에서 나가요.** 영상 한 편에 AI 호출이 여러 번 들어가요. Claude Code 는 **Git for Windows** 가 있어야 해요(아래 1단계에서 같이 설치해요).
- 영상은 내 PC 밖으로 나가지 않아요. 레퍼런스 검색과 AI 호출에만 인터넷을 써요.
- 아래 명령은 모두 **PowerShell** 에서 실행해요. 시작 메뉴에서 "PowerShell" 을 검색해 여세요.

## 1. 프로그램 설치

```powershell
winget install OpenJS.NodeJS Gyan.FFmpeg yt-dlp.yt-dlp Git.Git
```

설치가 끝나면 **PowerShell 창을 닫고 새로 여세요**(새로 깔린 프로그램은 새 창에서만 보여요). 그다음 `npm` 이 "스크립트 실행이 비활성화돼 있습니다" 라며 막히면 한 번만:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

(또는 PowerShell 대신 **명령 프롬프트(cmd)** 에서 `npm` 명령을 실행해도 돼요.)

```powershell
npm i -g hyperframes
irm https://claude.ai/install.ps1 | iex      # Claude Code 설치
```

설치 뒤 **새 PowerShell 창**에서 `claude` 를 한 번 실행해 로그인하세요.

### 음성 인식 프로그램(whisper-cli)

설치 프로그램이 없어서 직접 받아 풀고 PATH 에 넣어야 해요. 아래 명령을 한 번만 실행하세요.

```powershell
$dir = "$HOME\whisper-cpp"
New-Item -ItemType Directory -Force $dir | Out-Null
curl.exe -L -o "$dir\whisper-bin-x64.zip" https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip
Expand-Archive "$dir\whisper-bin-x64.zip" -DestinationPath $dir -Force
$bin = (Get-ChildItem -Recurse $dir -Filter whisper-cli.exe | Select-Object -First 1).DirectoryName
[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path','User') + ";$bin", 'User')
```

끝나면 **새 PowerShell 창**을 열고 `whisper-cli --help` 가 도움말을 보여 주면 된 거예요. (`b5454` 가 사라지면 [whisper.cpp 릴리스](https://github.com/ggml-org/whisper.cpp/releases)에서 이름이 **b 로 시작하는** 최신 릴리스의 `whisper-bin-x64.zip` 을 받으세요. 압축 파일을 못 풀 정도로 오래된 PC 에서는 [Visual C++ 재배포 패키지](https://aka.ms/vs/17/release/vc_redist.x64.exe)가 필요할 수 있어요.)

## 2. 앱 받아서 켜기

```powershell
git clone https://github.com/kuventus14/ai-video-clip.git
cd ai-video-clip
npm install
npm run setup     # 빠진 게 있으면 설치 방법을 알려 줘요(음성 인식 모델 465MB 를 받는 명령도 나와요)
npm run app       # 그다음 브라우저에서 http://127.0.0.1:4848
```

`npm run setup` 이 알려 주는 음성 인식 모델 받기 명령(`curl.exe -L --create-dirs -o ...`)은 그대로 복사해서 실행하세요.

- **끄기:** `Ctrl+C` 를 한 번 누르면 **바로 꺼져요.** 윈도우에서는 "끝날 때까지 기다렸다 끄기"를 할 수 없어서, 처리 중이던 작업은 다음에 켤 때 "중단됐어요"로 표시돼요(다시 시도하면 돼요).
- **다른 포트로 켜기:** `$env:VAE_PORT=4949; npm run app`
- 처음 켜면 화면을 빌드하느라 1~3분 걸려요.

## 3. 목소리 보정 설치 (선택)

소리를 또렷하게 하는 기능이에요. 설치하지 않으면 "원본 그대로"만 쓸 수 있어요.

```powershell
New-Item -ItemType Directory -Force "$HOME\.local\share\deep-filter" | Out-Null; cd "$HOME\.local\share\deep-filter"
curl.exe -L -o deep-filter.exe https://github.com/Rikorose/DeepFilterNet/releases/download/v0.5.6/deep-filter-0.5.6-x86_64-pc-windows-msvc.exe
if ((Get-FileHash -Algorithm SHA256 deep-filter.exe).Hash -ne '75E11FA16445F560CB6B021521DDB89E89270D13B83089705D98776F58FD7915') { throw '받은 파일의 해시가 달라요 — 지우고 다시 받으세요' } else { '해시 확인 OK' }
```

`해시 확인 OK` 가 나와야 해요(받은 파일이 이 안내를 쓸 때 확인한 파일과 같다는 뜻이에요). 다른 위치에 두려면 `VAE_DEEP_FILTER` 환경변수에 `deep-filter.exe` 경로를 적으세요. 윈도우·리눅스에서는 이 도구를 인터넷을 막지 않고 실행해요(소리 파일 하나를 처리하는 데 인터넷이 필요 없는 도구예요).

## 윈도우에서 어디까지 확인했나

GitHub 의 윈도우 컴퓨터(`windows-latest`)에서 자동 시험을 돌려 확인했어요(`.github/workflows/`):

- **됐어요:** ffmpeg, hyperframes 의 `check`·draft 렌더, whisper-cli(작은 모델, 한글 폴더 경로 포함), yt-dlp 로 YouTube 검색, 위 3단계 명령으로 설치한 deep-filter 로 목소리 보정, Claude Code 설치와 실행(로그인 없이는 "로그인하세요"라고 정상 응답), **앱 전체 켜기**(빌드 → 화면 서버 → 처리 프로그램 → 영상 올리기 → 영상 확인 → 끄기), 실제 브라우저로 새 영상 화면에서 영상 올리기.
- **아직 못 해 봤어요:** 로그인한 Claude Code 로 실제 AI 응답을 받는 단계(로그인 토큰이 필요해요), 한국어 윈도우(시험 컴퓨터는 영어 윈도우), 사용자 폴더 이름이 한글인 PC, 사람이 오래 써 보는 것. 개발자가 손으로 써 본 건 맥뿐이에요.

## 막히면

- `npm run setup` 을 다시 실행해 보세요 — 빠진 프로그램과 이 컴퓨터에 맞는 설치 명령을 알려 줘요.
- 화면의 진행 기록과 PowerShell 의 `[web]` / `[worker]` 로그를 알려 주세요.
- 자세한 사용법·한계는 [README](../README.md) 를 보세요.
