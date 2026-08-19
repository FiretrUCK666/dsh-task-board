/**
 * Native activity: bridges a session's native plan mode, active goal and the
 * live slash-command catalog into the comment & refine surfaces. All data
 * comes from the host's read-only bridge (/api/dsh-task-board/session-activity)
 * which reads DSH's OWN services — nothing is hardcoded here, so whatever the
 * official UI adds or renames flows in with zero maintenance. A missing view
 * block (or an unreachable bridge) renders nothing; clicking a command inserts
 * it into the surface's composer without sending.
 */
import { useEffect, useState } from 'react'
import css from '../board.module.css'
import { t } from '../locales.ts'
import { Disclosure } from './ui.tsx'

export interface NativeActivityState {
  plan?: { active: boolean; pending: boolean }
  goal?: { title: string; active: boolean }
  commands?: Array<{ name: string; description?: string }>
}

const ACTIVITY_URL = '/api/dsh-task-board/session-activity'

export function NativeActivity({ sessionId, onPickCommand, pollMs = 3000 }: {
  sessionId: string | undefined
  /** Insert the picked slash command into this surface's composer (no send). */
  onPickCommand: (name: string) => void
  pollMs?: number
}) {
  const [view, setView] = useState<NativeActivityState | undefined>(undefined)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (sessionId === undefined) {
      setView(undefined)
      return undefined
    }
    let live = true
    let timer: number | undefined
    const load = (): void => {
      void fetch(`${ACTIVITY_URL}?sessionId=${encodeURIComponent(sessionId)}`)
        .then(response => (response.ok ? response.json() as Promise<NativeActivityState> : undefined))
        .then(data => {
          if (live && data !== undefined) setView(data)
        })
        .catch(() => { /* bridge unavailable — degrade silently */ })
    }
    load()
    timer = window.setInterval(load, pollMs)
    return () => {
      live = false
      if (timer !== undefined) window.clearInterval(timer)
    }
  }, [sessionId, pollMs])

  const plan = view?.plan
  const goal = view?.goal
  const commands = view?.commands ?? []
  if (sessionId === undefined || (plan === undefined && goal === undefined && commands.length === 0)) return null

  const summary = [
    plan !== undefined
      ? (plan.pending ? t('comments.nativePlanPending') : t('comments.nativePlanActive'))
      : undefined,
    goal !== undefined ? goal.title : undefined,
    commands.length > 0 ? t('comments.nativeCommands', { n: String(commands.length) }) : undefined,
  ].filter(part => part !== undefined).join(' · ')

  return (
    <Disclosure title={t('comments.nativeActivity')} summary={summary} open={open} onToggle={() => { setOpen(!open) }}>
      <div className={css.nativeActivity}>
        {plan !== undefined && (
          <span className={css.nativeRow}>
            <span className={`${css.chip} ${plan.pending ? css.nativePlanPendingChip : css.nativePlanActiveChip}`}>
              {plan.pending ? t('comments.nativePlanPending') : t('comments.nativePlanActive')}
            </span>
            <span className={css.nativeHint}>{t('comments.nativePlanHint')}</span>
          </span>
        )}
        {goal !== undefined && (
          <span className={css.nativeRow}>
            <span className={`${css.chip}${goal.active ? ` ${css.nativeGoalOn}` : ''}`}>
              {goal.active ? t('comments.nativeGoalActive') : t('comments.nativeGoal')}
            </span>
            <span className={css.nativeGoalTitle}>{goal.title}</span>
          </span>
        )}
        {commands.length > 0 && (
          <span className={css.nativeCommands}>
            {commands.map(command => (
              <button
                key={command.name}
                type="button"
                className={css.nativeCommand}
                title={command.description ?? command.name}
                onClick={() => { onPickCommand(command.name) }}
              >
                {command.name}
                {command.description !== undefined && (
                  <span className={css.nativeCommandDesc}>{command.description}</span>
                )}
              </button>
            ))}
          </span>
        )}
      </div>
    </Disclosure>
  )
}
