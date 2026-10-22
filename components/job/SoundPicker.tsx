'use client'

import { Pause, Play } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { SfxMode } from '../../src/shared/sound.ts'
import type { SoundListDto } from '../../src/shared/types.ts'
import { durationLabel, groupByMood } from '../../src/ui/sound.ts'
import { Segmented } from '../ui/Segmented.tsx'
import { cx } from '../ui/cx.ts'

const ROW = cx(
  'flex min-h-12 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-[9px] px-3 py-2 text-[14px] text-ink-2 transition-[background-color,color,box-shadow] duration-200 ease-out',
  'hover:text-ink has-[:checked]:bg-lift has-[:checked]:text-ink has-[:checked]:shadow-[inset_0_0_0_1.5px_var(--accent)]',
  'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
)

/**
 * 배경음악(곡 하나 또는 없음)과 효과음(켜기/끄기)을 고른다. 곡은 분위기별로 묶여 있고 ▶ 로 미리 들어 볼 수 있다(한 번에 한 곡).
 * list 가 null 이면 불러오는 중이다.
 */
export function SoundPicker({ list, error, bgm, onBgm, sfx, onSfx, disabled = false }: { list: SoundListDto | null; error: string | null; bgm: string | null; onBgm: (id: string | null) => void; sfx: SfxMode; onSfx: (m: SfxMode) => void; disabled?: boolean }) {
  const name = useId()
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)

  const stop = () => {
    audioRef.current?.pause()
    setPlaying(null)
  }
  useEffect(() => () => audioRef.current?.pause(), [])
  useEffect(() => {
    if (disabled) stop()
  }, [disabled])

  function toggle(id: string) {
    if (playing === id) return stop()
    const a = (audioRef.current ??= new Audio())
    a.src = `/api/sound/${encodeURIComponent(id)}`
    a.onended = () => setPlaying(null)
    a.onerror = () => setPlaying(null)
    setPlaying(id)
    a.play().catch(() => setPlaying(null))
  }

  const tracks = list?.bgm ?? []
  const selected = tracks.find((t) => t.id === bgm)
  const sfxAvailable = (list?.sfxCount ?? 0) > 0

  return (
    <div className="flex flex-col gap-7">
      <fieldset disabled={disabled} className="min-w-0">
        <legend className="mb-2 text-[14px] font-semibold text-ink">배경음악</legend>
        {error ? (
          <p className="rounded-control bg-warn-soft px-4 py-3 text-[13px] text-warn">음원 목록을 불러오지 못했어요 ({error}). 배경음악 없이 만들 수 있어요.</p>
        ) : list === null ? (
          <p className="rounded-control bg-raised px-4 py-3 text-[13px] text-ink-3">음원 목록을 불러오는 중이에요…</p>
        ) : (
          <div className="max-h-80 overflow-y-auto rounded-control bg-raised p-1">
            <div className="flex items-center gap-1">
              <label className={ROW}>
                <input type="radio" name={name} className="sr-only" checked={bgm === null} onChange={() => onBgm(null)} />
                <span className={bgm === null ? 'font-semibold' : undefined}>넣지 않아요</span>
              </label>
            </div>
            {tracks.length === 0 ? <p className="px-3 py-3 text-[13px] text-ink-3">배경음악 음원이 아직 없어요.</p> : null}
            {groupByMood(tracks).map((g) => (
              <div key={g.mood}>
                <p className="px-3 pb-1 pt-3 text-[12px] font-semibold text-ink-3">{g.label}</p>
                <ul className="flex flex-col gap-0.5">
                  {g.tracks.map((t) => {
                    const isPlaying = playing === t.id
                    return (
                      <li key={t.id} className="flex items-center gap-1">
                        <label className={ROW}>
                          <input type="radio" name={name} className="sr-only" checked={bgm === t.id} onChange={() => onBgm(t.id)} />
                          <span className="min-w-0 flex-1">
                            <span className={cx('block truncate', bgm === t.id && 'font-semibold')}>{t.title}</span>
                            <span className="block truncate text-[12px] font-normal text-ink-3">
                              {t.author} · {durationLabel(t.durationSec)}
                            </span>
                          </span>
                        </label>
                        <button
                          type="button"
                          aria-label={`${isPlaying ? '정지' : '미리 듣기'}: ${t.title}`}
                          aria-pressed={isPlaying}
                          onClick={() => toggle(t.id)}
                          className={cx('grid size-12 shrink-0 place-items-center rounded-[9px] transition-colors duration-200 hover:bg-lift focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring', isPlaying ? 'text-accent-ink' : 'text-ink-2 hover:text-ink')}
                        >
                          {isPlaying ? <Pause size={18} strokeWidth={1.75} aria-hidden="true" /> : <Play size={18} strokeWidth={1.75} aria-hidden="true" />}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-[13px] text-ink-3">
          {selected ? `「${selected.title}」(${selected.author}, ${selected.license}) — 목소리가 나올 때는 자동으로 작아져요.` : '고르지 않으면 배경음악 없이 만들어요.'}
        </p>
      </fieldset>

      <div className="flex flex-col gap-3">
        <Segmented<SfxMode>
          legend="효과음"
          value={sfxAvailable ? sfx : 'off'}
          onChange={onSfx}
          disabled={disabled || !sfxAvailable}
          options={[
            { value: 'off', label: '끄기', hint: '넣지 않아요' },
            { value: 'on', label: '켜기', hint: '컷·제목에 짧게' },
          ]}
        />
        <p className="text-[13px] text-ink-3">
          {list !== null && !sfxAvailable ? '효과음 파일이 아직 없어요.' : sfx === 'on' ? '제목 카드가 나올 때와 컷이 바뀔 때 짧은 효과음을 넣어요. 너무 잦지 않게 2초 이상 띄워요.' : '효과음 없이 만들어요.'}
        </p>
      </div>
    </div>
  )
}
