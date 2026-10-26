import fs from 'node:fs'
import path from 'node:path'
import type { Job, Jobs } from '../db/jobs.ts'
import { jsonError } from './http.ts'

/**
 * 요청의 reference 값을 작업에 저장할 값으로 바꾼다.
 * undefined = 바꾸지 않음, null/빈 문자열 = 레퍼런스 없음, 'uploaded' = 올려 둔 파일, http(s) 링크 = 그대로.
 * 그 밖의 문자열(내 컴퓨터의 경로·file:// 등)은 거절한다 — 웹에서 임의의 로컬 파일을 편집 엔진에 넣지 못하게.
 */
export function resolveReference(job: Job, value: string | null | undefined): { ok: true; value: string | null | undefined } | { ok: false; res: Response } {
  if (value === undefined) return { ok: true, value: undefined }
  const v = value?.trim() ?? ''
  if (!v) return { ok: true, value: null }
  if (v === 'uploaded') {
    if (!job.referenceUploadPath || !fs.existsSync(job.referenceUploadPath)) return { ok: false, res: jsonError(400, '올려 둔 레퍼런스 파일이 없어요. 파일을 먼저 올려 주세요.') }
    return { ok: true, value: job.referenceUploadPath }
  }
  if (/^https?:\/\//i.test(v)) return { ok: true, value: v }
  return { ok: false, res: jsonError(400, '레퍼런스 링크는 http:// 또는 https:// 로 시작해야 해요. 파일은 직접 올려 주세요.') }
}

/** 같은 파일을 디스크를 더 쓰지 않게 하드링크로 두고, 안 되면 복사한다. */
export function linkOrCopy(from: string, to: string): void {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.rmSync(to, { force: true })
  try {
    fs.linkSync(from, to)
  } catch {
    fs.copyFileSync(from, to)
  }
}

/**
 * "다른 버전도 만들기": 부모 작업의 원본·분석 결과·계획을 새 작업으로 가져와 계획 단계(queued_plan)에서 시작하게 한다.
 * 용도 선택은 부모 확정 용도의 반대. 분석 결과가 가리키는 파일(변환본 포함)은 자식 폴더로 링크해 부모를 지워도 자식이 깨지지 않는다.
 */
export function cloneForOtherVersion(jobs: Jobs, parent: Job): { child: Job } | { error: string } {
  const parentDir = jobs.jobDir(parent.id)
  const analysisFile = path.join(parentDir, 'analysis.json')
  if (!fs.existsSync(analysisFile) || !parent.purpose) return { error: '분석 결과가 없어서 다른 버전을 만들 수 없어요' }

  const child = jobs.create({ parentJobId: parent.id })
  const childDir = jobs.jobDir(child.id)
  try {
    const childSource = parent.sourcePath && fs.existsSync(parent.sourcePath) ? path.join(childDir, path.basename(parent.sourcePath)) : null
    if (childSource) linkOrCopy(parent.sourcePath!, childSource)

    // 분석 결과 안의 경로를 자식 폴더 기준으로 다시 쓴다
    const mapPath = (p: string): string => {
      if (p.startsWith(parentDir + path.sep)) {
        const target = path.join(childDir, path.relative(parentDir, p))
        if (fs.existsSync(p)) linkOrCopy(p, target)
        return target
      }
      return p === parent.sourcePath && childSource ? childSource : p
    }
    const analysis = JSON.parse(fs.readFileSync(analysisFile, 'utf8')) as { sourcePath: string; info?: { path?: string } }
    const oldSource = analysis.sourcePath
    analysis.sourcePath = mapPath(oldSource)
    if (analysis.info?.path) analysis.info.path = analysis.info.path === oldSource ? analysis.sourcePath : mapPath(analysis.info.path)
    fs.writeFileSync(path.join(childDir, 'analysis.json'), JSON.stringify(analysis))

    const preparedFile = path.join(parentDir, 'prepared.json')
    if (fs.existsSync(preparedFile)) fs.copyFileSync(preparedFile, path.join(childDir, 'prepared.json'))
    // 레퍼런스 장면 사진: 계획이 같은 레퍼런스의 스타일 명세를 다시 쓰므로 새로 만들지 않는다 — 가져가야 편집 감독이 레퍼런스를 본다
    const refFrames = path.join(parentDir, 'ref-frames')
    if (fs.existsSync(refFrames)) fs.cpSync(refFrames, path.join(childDir, 'ref-frames'), { recursive: true })

    let referenceUploadPath: string | null = null
    if (parent.referenceUploadPath && fs.existsSync(parent.referenceUploadPath)) {
      referenceUploadPath = path.join(childDir, path.basename(parent.referenceUploadPath))
      linkOrCopy(parent.referenceUploadPath, referenceUploadPath)
    }
    let thumbPath: string | null = null
    if (parent.thumbPath && fs.existsSync(parent.thumbPath)) {
      thumbPath = path.join(childDir, 'source-thumb.jpg')
      fs.copyFileSync(parent.thumbPath, thumbPath)
    }

    // 새 작업을 만들자마자 계획 단계로 보내므로 상태 기계(created → queued_probe 만 허용)를 거치지 않고 직접 쓴다.
    const updated = jobs.update(child.id, {
      status: 'queued_plan',
      purposeChoice: parent.purpose === 'short' ? 'post' : 'short',
      description: parent.description,
      requestText: parent.requestText,
      audioMode: parent.audioMode,
      transcriptEdits: parent.transcriptEdits,
      captionTrack: parent.captionTrack,
      bgmId: parent.bgmId,
      sfxMode: parent.sfxMode,
      referenceSource: parent.referenceSource && parent.referenceSource === parent.referenceUploadPath ? referenceUploadPath : parent.referenceSource,
      referenceUploadPath,
      sourceName: parent.sourceName,
      sourcePath: childSource,
      sourceInfo: parent.sourceInfo,
      summary: parent.summary,
      purposeGuess: parent.purposeGuess,
      thumbPath,
    })
    return { child: updated }
  } catch (e) {
    jobs.remove(child.id)
    throw e
  }
}
