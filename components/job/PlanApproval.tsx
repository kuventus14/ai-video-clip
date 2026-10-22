'use client'

import { ArrowLeftRight, Captions, Check, Crop, Music, Scissors, TriangleAlert, Type } from 'lucide-react'
import { useEffect, useState, type ComponentType } from 'react'
import type { SfxMode } from '../../src/shared/sound.ts'
import type { CaptionPosition, JobDto, SoundListDto } from '../../src/shared/types.ts'
import { approve, getSound, plan } from '../../src/ui/api.ts'
import { sourceFrame } from '../../src/ui/format.ts'
import type { AudioMode } from '../../src/shared/voice.ts'
import { parsePlanCard, planItemKind, type PlanItemKind } from '../../src/ui/plan.ts'
import { formFrom, overLimit, scriptEditsFrom, type ScriptForm } from '../../src/ui/script.ts'
import { reconcileSoundChoice } from '../../src/ui/sound.ts'
import { ActionBar } from '../ui/ActionBar.tsx'
import { Button } from '../ui/Button.tsx'
import { Card } from '../ui/Card.tsx'
import { Field, Textarea } from '../ui/Field.tsx'
import { Segmented } from '../ui/Segmented.tsx'
import { Switch } from '../ui/Switch.tsx'
import { PurposeChooser, type PurposeChoice } from './PurposeChooser.tsx'
import { ScriptEditor } from './ScriptEditor.tsx'
import { SoundPicker } from './SoundPicker.tsx'

type Quality = JobDto['quality']

const ICON: Record<PlanItemKind, ComponentType<{ size?: number; strokeWidth?: number; className?: string; 'aria-hidden'?: boolean | 'true' }>> = {
  captions: Captions,
  title: Type,
  cuts: Scissors,
  frame: Crop,
  music: Music,
  transition: ArrowLeftRight,
  other: Check,
}

/**
 * "이렇게 이해했어요" 승인 화면. AI 가 이해한 편집 계획을 보여 주고, 용도·자막·화질을 정한 뒤 승인하면 제작을 시작한다.
 * 마음에 안 들면 요청을 고치거나(요청 고치기) 레퍼런스를 바꿔(onEditReference) 계획을 다시 만든다.
 */
export function PlanApproval({ job, onChanged, onEditReference }: { job: JobDto; onChanged: (next: JobDto) => void; onEditReference?: () => void }) {
  const card = parsePlanCard(job.planCard ?? [])
  const [choice, setChoice] = useState<PurposeChoice>(job.purposeChoice)
  const [captionsOn, setCaptionsOn] = useState(job.captionsMode !== 'off')
  const [captionPosition, setCaptionPosition] = useState<CaptionPosition>(job.captionPosition ?? 'bottom')
  const [audio, setAudio] = useState<AudioMode>(job.audioMode)
  const [bgm, setBgm] = useState<string | null>(job.bgmId)
  const [sfx, setSfx] = useState<SfxMode>(job.sfxMode)
  const [sound, setSound] = useState<SoundListDto | null>(null)
  const [soundError, setSoundError] = useState<string | null>(null)
  const [quality, setQuality] = useState<Quality>(job.quality)
  const [scriptForm, setScriptForm] = useState<ScriptForm | null>(() => (job.script ? formFrom(job.script) : null))
  const [editingRequest, setEditingRequest] = useState(false)
  const [request, setRequest] = useState(job.requestText)
  const [busy, setBusy] = useState<'approve' | 'replan' | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 음원 목록은 화면이 열릴 때 한 번 불러온다.
  useEffect(() => {
    const ac = new AbortController()
    getSound(ac.signal)
      .then(setSound)
      .catch((e: unknown) => {
        if (!ac.signal.aborted) setSoundError(e instanceof Error ? e.message : String(e))
      })
    return () => ac.abort()
  }, [])
  // 불러온 결과(또는 실패)에 맞춰 이전에 골라 둔 선택을 정리한다. 목록이 사라진 곡을 가리키거나 목록을 못 불러왔는데 선택이 남아 있으면 서버가 승인을 거절한다.
  useEffect(() => {
    const r = reconcileSoundChoice({ list: sound, error: soundError, bgm, sfx })
    if (r.bgm !== bgm) setBgm(r.bgm)
    if (r.sfx !== sfx) setSfx(r.sfx)
    // bgm·sfx 는 목록이 도착한 순간의 값만 읽으면 된다(사용자가 고르는 동안 다시 돌릴 필요 없음)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sound, soundError])

  // 용도를 바꾸면 계획이 달라지므로, 바꾼 채로는 승인할 수 없고 계획을 다시 만들어야 한다
  const purposeChanged = choice !== job.purposeChoice

  async function run(kind: 'approve' | 'replan', call: () => Promise<JobDto>) {
    setBusy(kind)
    setError(null)
    try {
      onChanged(await call())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(null)
    }
  }

  const warnCount = card.items.filter((i) => i.tone === 'warn').length
  const scriptProblem = job.script && scriptForm ? overLimit(scriptForm, job.script) : []
  const scriptEdits = job.script && scriptForm ? scriptEditsFrom(job.script, scriptForm) : {}

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="plan-title" className="rounded-panel bg-panel px-7 py-7">
        <h2 id="plan-title" className="text-[13px] font-medium text-ink-3">
          이렇게 이해했어요
        </h2>
        {card.headline ? <p className="mt-2 max-w-[40ch] text-[24px] font-bold leading-[1.3] tracking-[-0.025em] text-ink sm:text-[28px]">{card.headline}</p> : null}
        {card.items.length > 0 ? (
          <ul className="mt-6 flex flex-col gap-2">
            {card.items.map((item, i) => {
              const Icon = item.tone === 'warn' ? TriangleAlert : ICON[planItemKind(item.text)]
              return (
                <li key={i} className={item.tone === 'warn' ? 'flex items-start gap-3.5 rounded-control bg-warn-soft px-4 py-3.5 text-[15px] leading-relaxed text-warn' : 'flex items-start gap-3.5 rounded-control bg-raised px-4 py-3.5 text-[15px] leading-relaxed text-ink'}>
                  <Icon size={19} strokeWidth={1.75} className={item.tone === 'warn' ? 'mt-0.5 shrink-0' : 'mt-0.5 shrink-0 text-ink-3'} aria-hidden="true" />
                  <span className="min-w-0 break-words">{item.text}</span>
                </li>
              )
            })}
          </ul>
        ) : !card.headline ? (
          <p className="mt-4 text-[15px] text-ink-2">계획 내용을 불러오지 못했어요. 요청을 고쳐 다시 만들어 보세요.</p>
        ) : null}
        {warnCount > 0 ? <p className="mt-4 text-[13px] text-ink-3">노란 줄은 이번 버전에서 반영되지 않는 부분이에요. 나머지는 그대로 만들어요.</p> : null}
      </section>

      {job.script && scriptForm ? <ScriptEditor script={job.script} form={scriptForm} onChange={setScriptForm} disabled={busy !== null} /> : null}

      <Card title="만들기 설정">
        <div className="flex flex-col gap-7">
          <div className="flex flex-col gap-3">
            <PurposeChooser value={choice} onChange={setChoice} guess={job.purposeGuess} disabled={busy !== null} source={sourceFrame(job)} />
            {purposeChanged ? (
              <div className="flex flex-wrap items-center gap-3 rounded-control bg-accent-soft px-4 py-3">
                <p className="min-w-0 flex-1 text-[13px] text-accent-ink">용도를 바꾸면 계획을 다시 만들어야 해요.</p>
                <Button size="sm" variant="accent" loading={busy === 'replan'} disabled={busy === 'approve'} onClick={() => run('replan', () => plan(job.id, { purposeChoice: choice }))}>
                  이 용도로 계획 다시 만들기
                </Button>
              </div>
            ) : null}
          </div>

          <Switch checked={captionsOn} onChange={setCaptionsOn} label="자막 넣기" description="영상에 이미 자막이 들어 있다면 끄세요. 두 줄로 겹쳐 보일 수 있어요." />

          {captionsOn ? (
            <div className="flex flex-col gap-3">
              <Segmented<CaptionPosition>
                legend="자막 위치"
                value={captionPosition}
                onChange={setCaptionPosition}
                disabled={busy !== null}
                options={[
                  { value: 'top', label: '상단', hint: '화면 위쪽' },
                  { value: 'middle', label: '중앙', hint: '화면 가운데' },
                  { value: 'bottom', label: '하단', hint: '화면 아래쪽' },
                ]}
              />
              <p className="text-[13px] text-ink-3">
                {captionPosition === 'top' ? '자막을 화면 위쪽에 놓아요. 시작 제목 카드와 겹치지 않는지 결과에서 확인해 주세요.' : captionPosition === 'middle' ? '자막을 화면 가운데에 놓아요. 인물이 가운데 있으면 얼굴을 가릴 수 있어요.' : '자막을 화면 아래쪽에 놓아요(가장 흔한 위치).'}
              </p>
            </div>
          ) : null}

          <div className="flex flex-col gap-3">
            <Segmented<AudioMode>
              legend="소리"
              value={audio}
              onChange={setAudio}
              disabled={busy !== null}
              options={[
                { value: 'original', label: '원본 그대로', hint: '소리를 건드리지 않아요' },
                { value: 'voice', label: '목소리 또렷하게', hint: '소음 줄이고 크기 맞춤' },
              ]}
            />
            <p className="text-[13px] text-ink-3">
              {audio === 'voice' ? '주변 소음을 줄이고 목소리 크기를 맞춰요. 방의 울림까지 없애지는 못해요(마이크를 입 가까이 두고 찍은 소리처럼 되지는 않아요). 제작 시간이 조금 늘어요.' : '찍은 소리를 그대로 써요. 소음이 많은 영상은 목소리가 묻힐 수 있어요.'}
            </p>
          </div>

          <SoundPicker list={sound} error={soundError} bgm={bgm} onBgm={setBgm} sfx={sfx} onSfx={setSfx} disabled={busy !== null} />

          <details className="group">
            <summary className="cursor-pointer rounded-chip py-1 text-[15px] font-semibold text-ink-2 hover:text-ink">고급 설정</summary>
            <div className="mt-4 flex flex-col gap-3">
              <Segmented
                legend="화질"
                value={quality}
                onChange={setQuality}
                options={[
                  { value: 'draft', label: '초안', hint: '빨리 확인용' },
                  { value: 'looks', label: '보통', hint: '기본' },
                  { value: 'delivery', label: '최종', hint: '가장 선명' },
                ]}
              />
              <p className="text-[13px] text-ink-3">화질이 높을수록 만드는 데 오래 걸려요. 검수에서 화질 문제가 나오면 자동으로 한 단계 올려 다시 만들어요.</p>
            </div>
          </details>
        </div>
      </Card>

      {editingRequest ? (
        <Card title="요청 고치기" description="레퍼런스에서 참고할 부분이나 바라는 점을 고쳐 쓰면 계획을 다시 만들어요.">
          <div className="flex flex-col gap-4">
            <Field label="요청" optional>
              {(p) => <Textarea {...p} value={request} onChange={(e) => setRequest(e.target.value)} maxLength={4000} placeholder="예: 자막은 크게, 컷은 지금보다 빠르게" />}
            </Field>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" disabled={busy !== null} onClick={() => setEditingRequest(false)}>
                접기
              </Button>
              <Button variant="primary" loading={busy === 'replan'} disabled={busy === 'approve'} onClick={() => run('replan', () => plan(job.id, { request: request.trim() }))}>
                고쳐서 계획 다시 만들기
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      <ActionBar error={error} hint={purposeChanged ? '용도를 바꿨어요. 계획을 다시 만든 뒤 승인할 수 있어요' : scriptProblem.length > 0 ? '편집 구성 문구를 확인해 주세요' : undefined}>
        {!editingRequest ? (
          <Button variant="ghost" disabled={busy !== null} onClick={() => setEditingRequest(true)}>
            요청 고치기
          </Button>
        ) : null}
        {onEditReference ? (
          <Button disabled={busy !== null} onClick={onEditReference}>
            레퍼런스 바꾸기
          </Button>
        ) : null}
        <Button variant="primary" loading={busy === 'approve'} disabled={purposeChanged || scriptProblem.length > 0 || busy === 'replan'} onClick={() => run('approve', () => approve(job.id, { captions: captionsOn ? 'auto' : 'off', ...(captionsOn ? { captionPosition } : {}), ...(Object.keys(scriptEdits).length > 0 ? { scriptEdits } : {}), audio, bgm, sfx, quality }))}>
          승인하고 만들기
        </Button>
      </ActionBar>
    </div>
  )
}
