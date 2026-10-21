'use client'

import { Paperclip, X } from 'lucide-react'
import { useRef, useState, type Ref } from 'react'
import { UNSUPPORTED_FORMAT_MESSAGE, VIDEO_EXTS, videoExtOf } from '../../src/shared/media.ts'
import { uploadReferenceFile } from '../../src/ui/api.ts'
import { Button } from '../ui/Button.tsx'
import { Field, Input } from '../ui/Field.tsx'

/**
 * 레퍼런스를 직접 넣는 곳: 링크 입력 또는 영상 파일 첨부. 파일은 고르는 즉시 올리고(진행률 표시),
 * 올리기가 끝나면 onFileChange(이름) 으로 알린다. 올리는 동안은 onBusyChange(true) 라서 부모가 제출을 막을 수 있다.
 * jobId 가 없으면(영상을 아직 안 올림) 파일 첨부는 막고 이유를 보여 준다.
 */
export function ReferenceInput({
  jobId,
  link,
  onLinkChange,
  linkError,
  linkRef,
  fileName,
  onFileChange,
  onBusyChange,
}: {
  jobId: string | null
  link: string
  onLinkChange: (v: string) => void
  linkError?: string | null
  linkRef?: Ref<HTMLInputElement>
  fileName: string | null
  onFileChange: (name: string | null) => void
  onBusyChange?: (busy: boolean) => void
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [fraction, setFraction] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function attach(file: File) {
    if (!jobId) return
    if (!videoExtOf(file.name)) {
      setError(`${UNSUPPORTED_FORMAT_MESSAGE}.`)
      return
    }
    setError(null)
    setFraction(0)
    onBusyChange?.(true)
    try {
      await uploadReferenceFile(jobId, file, setFraction)
      onFileChange(file.name)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setFraction(null)
      onBusyChange?.(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Field label="링크" optional error={linkError} hint="유튜브·인스타그램 등 공개된 영상의 주소">
        {(p) => <Input {...p} ref={linkRef} type="url" inputMode="url" value={link} onChange={(e) => onLinkChange(e.target.value)} disabled={!!fileName} placeholder="https://" />}
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="text-[14px] font-semibold text-ink">
          또는 영상 파일 <span className="ml-1 text-[13px] font-normal text-ink-3">선택</span>
        </span>
        {fileName ? (
          <div className="flex items-center gap-2 rounded-control bg-raised px-4 py-2.5 text-[15px]">
            <Paperclip size={16} strokeWidth={1.75} className="shrink-0 text-ink-3" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{fileName}</span>
            <Button size="icon" variant="ghost" aria-label="첨부한 레퍼런스 파일 빼기" onClick={() => onFileChange(null)}>
              <X size={16} strokeWidth={1.75} aria-hidden="true" />
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" disabled={!jobId || fraction !== null} onClick={() => fileInput.current?.click()} icon={<Paperclip size={16} strokeWidth={1.75} aria-hidden="true" />}>
              파일 첨부
            </Button>
            {fraction !== null ? <span className="text-[13px] text-ink-2 tabular-nums">올리는 중 · {Math.round(fraction * 100)}%</span> : null}
            {!jobId ? <span className="text-[13px] text-ink-3">영상을 올린 뒤에 첨부할 수 있어요</span> : null}
          </div>
        )}
        <input
          ref={fileInput}
          type="file"
          accept={[...VIDEO_EXTS, 'video/*'].join(',')}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void attach(f)
            e.target.value = ''
          }}
        />
        {error ? (
          <p role="alert" className="text-[13px] font-medium text-bad">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  )
}
