import type { EnvReport, ToolName } from './env.ts'

/** 음성 인식 모델(ggml-small.bin)의 공개 주소와 SHA-256 — 앱이 쓰는 파일과 같은 것을 확인했다 */
const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin'
const MODEL_SHA256 = '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b'

/** 앱이 더는 쓰지 않는 도구(사람 추적용 Swift 컴파일러) — 없어도 된다 */
const NOT_NEEDED: ToolName[] = ['swiftc']

/**
 * 처음 쓰는 사람을 위한 환경 점검 결과 글. 필요한 것이 다 있으면 ready, 아니면 무엇을 어떻게 설치하는지 보여 준다.
 * 목소리 보정 도구(deep-filter)는 선택이라 없어도 ready 다. 순수 함수 — 실제 점검은 checkEnvironment 가 한다.
 */
export function describeSetup(env: EnvReport, hasDeepFilter: boolean): { ready: boolean; lines: string[] } {
  const lines: string[] = []
  let ready = true
  for (const [name, s] of Object.entries(env.tools) as [ToolName, EnvReport['tools'][ToolName]][]) {
    if (NOT_NEEDED.includes(name)) continue
    if (s.ok) {
      lines.push(`✓ ${name}${s.version ? ` (${s.version})` : ''}`)
      if (name === 'claude') lines.push('  ↳ 설치만 확인할 수 있어요. 로그인했는지는 터미널에서 `claude` 를 한 번 실행해 확인하세요(AI 사용량은 그 계정에서 나가요).')
    } else {
      ready = false
      lines.push(`✗ ${name} — ${s.hint ?? '설치해 주세요'}`)
    }
  }
  if (env.whisperModel.ok) {
    lines.push('✓ 음성 인식 모델')
  } else {
    ready = false
    lines.push(`✗ 음성 인식 모델(약 465MB) — 아래 명령으로 받고, 받은 파일의 SHA-256 이 ${MODEL_SHA256} 인지 \`shasum -a 256 ${env.whisperModel.path}\` 로 확인하세요:`)
    lines.push(`  curl -L --create-dirs -o ${env.whisperModel.path} ${MODEL_URL}`)
  }
  lines.push(hasDeepFilter ? '✓ 목소리 보정 도구(deep-filter)' : '– 목소리 보정 도구(deep-filter)는 선택이에요. 없으면 소리를 "원본 그대로"만 고를 수 있어요(README 의 "목소리 보정 설치").')
  lines.push('')
  lines.push(ready ? '모두 준비됐어요. `npm run app` 으로 시작하세요.' : '✗ 표시된 것을 설치한 뒤 `npm run setup` 을 다시 실행해 확인하세요.')
  return { ready, lines }
}
