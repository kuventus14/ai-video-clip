import { checkEnvironment } from '../src/core/env.ts'
import { describeSetup } from '../src/core/setup.ts'
import { findDeepFilter } from '../src/shared/voice.ts'

// npm run setup — 영상 자동 편집을 쓰기 전에 필요한 프로그램이 다 있는지 점검하고, 빠진 것은 설치 방법을 알려 준다(아무것도 설치하지 않는다).
console.log('환경 점검\n')
const { ready, lines } = describeSetup(await checkEnvironment(), findDeepFilter() !== null)
console.log(lines.join('\n'))
process.exit(ready ? 0 : 1)
