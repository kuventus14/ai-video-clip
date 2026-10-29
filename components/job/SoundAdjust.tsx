'use client'

import { RotateCcw } from 'lucide-react'
import { useId, useState } from 'react'
import { SOUND_GAIN_RANGE } from '../../src/shared/soundGain.ts'
import type { JobDto } from '../../src/shared/types.ts'
import { remix } from '../../src/ui/api.ts'
import { aiSummary, isChanged, sliderLabel } from '../../src/ui/soundAdjust.ts'
import { Button } from '../ui/Button.tsx'
import { Card } from '../ui/Card.tsx'

function GainSlider({ label, value, onChange, disabled }: { label: string; value: number; onChange: (db: number) => void; disabled: boolean }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[14px] font-semibold text-ink">
          {label}
        </label>
        <output htmlFor={id} className="text-[13px] text-ink-2 tnum">
          {sliderLabel(value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={SOUND_GAIN_RANGE.min}
        max={SOUND_GAIN_RANGE.max}
        step={0.5}
        value={value}
        disabled={disabled}
        aria-valuetext={sliderLabel(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-6 w-full cursor-pointer accent-accent disabled:cursor-not-allowed disabled:opacity-40"
      />
      <div className="flex justify-between text-[12px] text-ink-3 tnum" aria-hidden="true">
        <span>작게 −{Math.abs(SOUND_GAIN_RANGE.min)}dB</span>
        <span>크게 +{SOUND_GAIN_RANGE.max}dB</span>
      </div>
    </div>
  )
}

/**
 * 결과 화면의 음악·효과음 크기 조절. AI 가 정한 크기를 출발점으로 직접 들어 보고 바꾼다.
 * 적용하면 영상은 그대로 두고 소리만 다시 섞는다(작업이 다시 제작 단계로 가고, 끝나면 이 화면으로 돌아온다).
 * 소리 조절 기능이 생기기 전에 만든 작업은 다시 섞을 수 없어서 이유만 보인다.
 */
export function SoundAdjust({ job, onChanged }: { job: JobDto; onChanged: (next: JobDto) => void }) {
  const sa = job.soundAdjust
  // 효과음을 켰어도 넣을 곳이 없어 0개면 슬라이더는 아무것도 바꾸지 못한다
  const uses = { bgm: job.bgmId !== null, sfx: job.sfxMode === 'on' && sa?.sfxCount !== 0 }
  const [bgm, setBgm] = useState(sa?.bgmGainDb ?? 0)
  const [sfx, setSfx] = useState(sa?.sfxGainDb ?? 0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!sa) return null

  // 쓰지 않는 소리는 슬라이더가 없으므로 적용된 값 그대로 둔다
  const next = { bgmGainDb: uses.bgm ? bgm : sa.bgmGainDb, sfxGainDb: uses.sfx ? sfx : sa.sfxGainDb }
  const changed = isChanged({ bgmGainDb: sa.bgmGainDb, sfxGainDb: sa.sfxGainDb }, next)
  const atAi = (!uses.bgm || bgm === sa.aiBgmGainDb) && (!uses.sfx || sfx === sa.aiSfxGainDb)

  async function apply() {
    setBusy(true)
    setError(null)
    try {
      onChanged(await remix(job.id, next))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const message = error ?? job.error
  return (
    <Card title="음악·효과음 크기" description={sa.available ? '영상을 들어 보고 크기를 바꿀 수 있어요. 적용하면 화면은 그대로 두고 소리만 다시 섞어요.' : sa.reason}>
      <div className="flex flex-col gap-6">
        {uses.bgm ? <GainSlider label="배경음악" value={bgm} onChange={setBgm} disabled={!sa.available || busy} /> : null}
        {uses.sfx ? <GainSlider label="효과음" value={sfx} onChange={setSfx} disabled={!sa.available || busy} /> : null}
        {sa.available ? (
          <>
            <p className="rounded-control bg-raised px-4 py-3 text-[13px] leading-relaxed text-ink-2">{aiSummary(sa, uses)}. AI 는 소리를 직접 듣지 못해서 영상 내용으로 짐작한 값이에요.</p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="ghost"
                disabled={busy || atAi}
                onClick={() => {
                  setBgm(sa.aiBgmGainDb)
                  setSfx(sa.aiSfxGainDb)
                }}
                icon={<RotateCcw size={16} strokeWidth={1.75} aria-hidden="true" />}
              >
                AI 추천으로 되돌리기
              </Button>
              <Button variant="primary" loading={busy} disabled={!changed} onClick={apply}>
                적용
              </Button>
            </div>
          </>
        ) : null}
        {message ? (
          <p role="alert" className="text-[13px] font-medium text-bad">
            {message}
          </p>
        ) : null}
      </div>
    </Card>
  )
}
