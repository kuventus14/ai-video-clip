import os from 'node:os'
import nodePath from 'node:path'
import { FOLDERS } from './config.ts'

/** launchd 는 맥 전용이라 경로는 항상 / 로 잇는다(윈도우에서 시험을 돌려도 같은 결과) */
const path = nodePath.posix

export const LAUNCHD_LABEL = 'com.autoframes.autopilot'
export const LAUNCHD_PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`)

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 맥에 로그인하면 자동 편집이 저절로 켜지고, 꺼지면 다시 켜지게 하는 launchd 설정 */
export function launchdPlist(o: { node: string; repo: string; root: string; path: string; home: string }): string {
  const args = [o.node, path.join(o.repo, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(o.repo, 'src', 'cli', 'autopilot.ts'), 'watch', '--root', o.root]
  const log = path.join(o.root, FOLDERS.work, 'autopilot.log')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${esc(a)}</string>`).join('\n')}
  </array>
  <key>WorkingDirectory</key><string>${esc(o.repo)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${esc(o.path)}</string>
    <key>HOME</key><string>${esc(o.home)}</string>
    <key>LANG</key><string>ko_KR.UTF-8</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${esc(log)}</string>
  <key>StandardErrorPath</key><string>${esc(log)}</string>
</dict>
</plist>
`
}
