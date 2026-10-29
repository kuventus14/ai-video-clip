import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 편집 때 소리를 어떻게 할지: 원본을 그대로 통과시키거나, 소음을 줄이고 목소리 크기를 맞춘다. */
export type AudioMode = 'original' | 'voice'
export const AUDIO_MODES: AudioMode[] = ['original', 'voice']

export const VOICE_TOOL_MISSING = '목소리 보정 도구(deep-filter)가 설치돼 있지 않아요. README 의 "목소리 보정 설치"를 따라 설치하거나, 소리를 "원본 그대로"로 골라 주세요.'

type Env = Record<string, string | undefined>

const isExecutable = (p: string): boolean => {
  try {
    fs.accessSync(p, fs.constants.X_OK)
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

/**
 * 목소리 보정에 쓰는 deep-filter 실행 파일의 경로. VAE_DEEP_FILTER 가 있으면 그것만 본다(틀린 경로를 조용히 다른 곳으로 넘기지 않는다),
 * 없으면 ~/.local/share/deep-filter/deep-filter (윈도우는 deep-filter.exe). 실행할 수 있는 파일이 아니면 null.
 */
export function findDeepFilter(o: { env?: Env; home?: string; platform?: NodeJS.Platform } = {}): string | null {
  const env = o.env ?? process.env
  const name = (o.platform ?? process.platform) === 'win32' ? 'deep-filter.exe' : 'deep-filter'
  const candidate = env.VAE_DEEP_FILTER || path.join(o.home ?? os.homedir(), '.local/share/deep-filter', name)
  return isExecutable(candidate) ? candidate : null
}
