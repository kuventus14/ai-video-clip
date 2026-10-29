import { describe, expect, test } from 'vitest'
import { installHint, resolveTool, searchPathFor, spawnPlan, withPath } from '../src/core/platform.ts'

describe('searchPathFor — 도구를 찾을 PATH', () => {
  test('맥: 기존 PATH 뒤에 Homebrew 등 흔한 위치를 ":" 로 잇는다(예전과 같다)', () => {
    const p = searchPathFor({ platform: 'darwin', env: { PATH: '/usr/bin' }, home: '/Users/me' })
    expect(p).toBe('/usr/bin:/opt/homebrew/bin:/usr/local/bin:/Users/me/.local/bin:/Users/me/.npm-global/bin')
  })
  test('리눅스: Homebrew 경로는 없다', () => {
    const p = searchPathFor({ platform: 'linux', env: { PATH: '/usr/bin' }, home: '/home/me' })
    expect(p).toBe('/usr/bin:/usr/local/bin:/home/me/.local/bin:/home/me/.npm-global/bin')
  })
  test('윈도우: ";" 로 잇고, 대소문자 다른 Path 키도 읽고, npm 전역·winget·claude 설치 위치를 덧붙인다', () => {
    const p = searchPathFor({ platform: 'win32', env: { Path: 'C:\\Windows\\System32', APPDATA: 'C:\\Users\\me\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }, home: 'C:\\Users\\me' })
    expect(p.split(';')).toEqual([
      'C:\\Windows\\System32',
      'C:\\Users\\me\\.local\\bin',
      'C:\\Users\\me\\AppData\\Roaming\\npm',
      'C:\\Users\\me\\AppData\\Local\\Microsoft\\WinGet\\Links',
    ])
  })
  test('PATH 가 비어 있어도 덧붙인 위치만으로 만든다', () => {
    expect(searchPathFor({ platform: 'linux', env: {}, home: '/h' }).split(':')[0]).toBe('/usr/local/bin')
  })
})

describe('resolveTool — PATH 에서 실행 파일 찾기', () => {
  const has = (...files: string[]) => (p: string) => files.includes(p)
  test('윈도우: 확장자 없이 불러도 PATHEXT 순서대로 .exe·.cmd 를 찾는다', () => {
    const o = { platform: 'win32' as const, pathext: '.COM;.EXE;.BAT;.CMD', isExecutable: has('C:\\bin\\ffmpeg.exe', 'C:\\npm\\hyperframes.cmd') }
    expect(resolveTool('ffmpeg', 'C:\\x;C:\\bin', o)).toBe('C:\\bin\\ffmpeg.exe')
    expect(resolveTool('hyperframes', 'C:\\npm', o)).toBe('C:\\npm\\hyperframes.cmd')
    expect(resolveTool('whisper-cli', 'C:\\bin', o)).toBeNull()
  })
  test('윈도우: 이미 확장자가 있으면 그대로 찾는다', () => {
    expect(resolveTool('ffmpeg.exe', 'C:\\bin', { platform: 'win32', pathext: '.EXE', isExecutable: has('C:\\bin\\ffmpeg.exe') })).toBe('C:\\bin\\ffmpeg.exe')
  })
  test('맥·리눅스: 이름 그대로 찾고, PATH 앞쪽이 이긴다', () => {
    const o = { platform: 'darwin' as const, isExecutable: has('/a/ffmpeg', '/b/ffmpeg') }
    expect(resolveTool('ffmpeg', '/a:/b', o)).toBe('/a/ffmpeg')
    expect(resolveTool('ffmpeg', '/c', o)).toBeNull()
  })
})

describe('withPath — 자식 프로세스 환경에 PATH 를 한 개만 넣는다', () => {
  test('윈도우: 이미 있는 Path 키를 바꾸고 PATH 를 따로 만들지 않는다', () => {
    const env = withPath({ Path: 'old', SystemRoot: 'C:\\Windows' }, 'new', 'win32')
    expect(env).toEqual({ Path: 'new', SystemRoot: 'C:\\Windows' })
  })
  test('윈도우: 대소문자만 다른 중복 키는 하나로 합친다', () => {
    const env = withPath({ Path: 'a', PATH: 'b' }, 'new', 'win32')
    expect(Object.keys(env).filter((k) => k.toLowerCase() === 'path')).toHaveLength(1)
    expect(Object.values(env)).toContain('new')
  })
  test('맥·리눅스: PATH 를 바꾼다', () => {
    expect(withPath({ PATH: 'old', HOME: '/h' }, 'new', 'darwin')).toEqual({ PATH: 'new', HOME: '/h' })
  })
  test('원래 환경은 건드리지 않는다', () => {
    const src = { Path: 'old' }
    withPath(src, 'new', 'win32')
    expect(src).toEqual({ Path: 'old' })
  })
})

describe('spawnPlan — 어떻게 실행할까', () => {
  test('맥·리눅스·윈도우 .exe 는 그대로(shell 없음)', () => {
    expect(spawnPlan('/usr/bin/ffmpeg', ['-i', 'a b.mp4'], 'darwin')).toEqual({ command: '/usr/bin/ffmpeg', args: ['-i', 'a b.mp4'], shell: false })
    expect(spawnPlan('C:\\bin\\ffmpeg.exe', ['-i', 'a b.mp4'], 'win32')).toEqual({ command: 'C:\\bin\\ffmpeg.exe', args: ['-i', 'a b.mp4'], shell: false })
  })
  test('윈도우 .cmd/.bat 는 shell 로 실행하고 공백·따옴표가 든 인자는 따옴표로 감싼다', () => {
    const plan = spawnPlan('C:\\Users\\me\\AppData\\Roaming\\npm\\hyperframes.cmd', ['render', '.', '-o', 'C:\\내 폴더\\out "1".mp4'], 'win32')
    expect(plan.shell).toBe(true)
    expect(plan.command).toBe('C:\\Users\\me\\AppData\\Roaming\\npm\\hyperframes.cmd')
    expect(plan.args).toEqual(['render', '.', '-o', '"C:\\내 폴더\\out ""1"".mp4"'])
  })
  test('윈도우 .cmd 경로 자체에 공백이 있으면 따옴표로 감싼다', () => {
    expect(spawnPlan('C:\\Program Files\\x\\tool.cmd', [], 'win32').command).toBe('"C:\\Program Files\\x\\tool.cmd"')
  })
})

describe('installHint — 설치 안내(플랫폼별)', () => {
  test('맥은 기존 brew 안내 그대로', () => {
    expect(installHint('ffmpeg', 'darwin')).toBe('brew install ffmpeg')
    expect(installHint('whisper-cli', 'darwin')).toBe('brew install whisper-cpp')
  })
  test('윈도우는 winget, 리눅스는 apt', () => {
    expect(installHint('ffmpeg', 'win32')).toContain('winget install')
    expect(installHint('ffmpeg', 'linux')).toContain('apt install ffmpeg')
    expect(installHint('node', 'win32')).toContain('winget install')
    expect(installHint('yt-dlp', 'win32')).toContain('winget install')
  })
  test('윈도우의 Claude Code 는 PowerShell 설치 명령을 알려 준다', () => {
    expect(installHint('claude', 'win32')).toContain('install.ps1')
  })
  test('어느 플랫폼이든 brew 를 윈도우·리눅스에 알려 주지 않는다', () => {
    for (const t of ['node', 'ffmpeg', 'ffprobe', 'whisper-cli', 'yt-dlp', 'claude', 'hyperframes', 'swiftc'] as const) {
      expect(installHint(t, 'win32')).not.toMatch(/brew /)
      expect(installHint(t, 'linux')).not.toMatch(/brew /)
    }
  })
})
