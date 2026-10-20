#!/usr/bin/env node
// 시험용 가짜 `claude`. 진짜와 같은 stream-json `result` 이벤트를 출력한다.
//   FAKE_CLAUDE_REPLIES  답 목록(JSON 배열) 파일. 호출할 때마다 맨 앞을 꺼내 쓴다. {"error":"…"} 항목은 오류 결과.
//   FAKE_CLAUDE_LOG      호출 기록(줄 단위 JSON)을 덧붙일 파일
//   FAKE_CLAUDE_SLEEP_MS 응답 전에 잠깐 잔다 (시간 초과 시험용)
import fs from 'node:fs'

let stdin = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (d) => (stdin += d))
process.stdin.on('end', () => {
  let imageCount = 0
  try {
    const msg = JSON.parse(stdin.split('\n')[0])
    imageCount = (msg.message?.content ?? []).filter((b) => b.type === 'image').length
  } catch {
    // 이미지 없는 호출은 평문 프롬프트
  }

  const log = process.env.FAKE_CLAUDE_LOG
  if (log) {
    fs.appendFileSync(
      log,
      JSON.stringify({ argv: process.argv.slice(2), stdin, imageCount, claudecode: process.env.CLAUDECODE ?? null }) + '\n',
    )
  }

  let reply = ''
  const file = process.env.FAKE_CLAUDE_REPLIES
  if (file && fs.existsSync(file)) {
    const replies = JSON.parse(fs.readFileSync(file, 'utf8'))
    reply = replies.shift() ?? ''
    fs.writeFileSync(file, JSON.stringify(replies))
  }

  const respond = () => {
    const isError = typeof reply === 'object' && reply !== null && 'error' in reply
    const event = { type: 'result', is_error: isError, result: isError ? reply.error : reply, total_cost_usd: 0, duration_ms: 1 }
    process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init' }) + '\n')
    process.stdout.write(JSON.stringify(event) + '\n')
  }
  const sleep = Number(process.env.FAKE_CLAUDE_SLEEP_MS ?? 0)
  if (sleep > 0) setTimeout(respond, sleep)
  else respond()
})
