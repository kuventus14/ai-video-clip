import { describe, expect, test } from 'vitest'
import { whisperPaths } from '../src/core/transcribe.ts'

describe('whisperPaths — whisper-cli 는 윈도우에서 인자를 시스템 코드 페이지로 읽어 한글 경로가 깨진다', () => {
  const model = 'C:\\Users\\민영\\.cache\\hyperframes\\whisper\\models\\ggml-small.bin'
  test('맥·리눅스는 그대로', () => {
    expect(whisperPaths({ platform: 'darwin', tmpdir: '/tmp', modelPath: '/Users/민영/m/ggml-small.bin' })).toEqual({ tmpBase: '/tmp', model: '/Users/민영/m/ggml-small.bin', cwd: undefined })
  })
  test('윈도우: 폴더 이름이 영어면 그대로', () => {
    expect(whisperPaths({ platform: 'win32', tmpdir: 'C:\\Users\\me\\AppData\\Local\\Temp', modelPath: 'C:\\Users\\me\\m\\ggml-small.bin' })).toEqual({ tmpBase: 'C:\\Users\\me\\AppData\\Local\\Temp', model: 'C:\\Users\\me\\m\\ggml-small.bin', cwd: undefined })
  })
  test('윈도우: 임시 폴더에 한글이 있으면 영어 이름의 공용 폴더(C:\\Users\\Public)에 임시 파일을 둔다', () => {
    expect(whisperPaths({ platform: 'win32', tmpdir: 'C:\\Users\\민영\\AppData\\Local\\Temp', modelPath: 'C:\\m\\ggml-small.bin', publicDir: 'C:\\Users\\Public' }).tmpBase).toBe('C:\\Users\\Public')
  })
  test('윈도우: 모델 폴더에 한글이 있으면 그 폴더를 작업 폴더로 하고 파일 이름만 넘긴다', () => {
    expect(whisperPaths({ platform: 'win32', tmpdir: 'C:\\T', modelPath: model })).toEqual({ tmpBase: 'C:\\T', model: 'ggml-small.bin', cwd: 'C:\\Users\\민영\\.cache\\hyperframes\\whisper\\models' })
  })
  test('윈도우: 모델 파일 이름 자체가 한글이면 고칠 수 없으니 그대로 둔다', () => {
    expect(whisperPaths({ platform: 'win32', tmpdir: 'C:\\T', modelPath: 'C:\\민영\\모델.bin' }).model).toBe('C:\\민영\\모델.bin')
  })
})
