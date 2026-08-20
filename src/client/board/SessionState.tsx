/**
 * Session state: the narrow plan/goal readout over a session's live native
 * state — a compact Disclosure above the composer ("会话状态"), collapsed to a
 * one-line summary. Data comes from the host's read-only bridge
 * (/api/dsh-task-board/session-state: planMode + goals only — deliberately no
 * command catalog). Missing view blocks or an unreachable bridge render
 * nothing; 3s poll while mounted, cleared on unmount.
 */
import { useEffect, useState } from 'react'
import css from '../board.module.css'
import { t } from '../locales.ts'
import { Disclosure } from './ui.tsx'

interface SessionStateView {
  plan?: { active: boolean; pending: boolean }
  goal?: { title: string; active: boolean }
}

const STATE_URL = '/api/dsh-task-board/session-state'

export function SessionState({ sessionId, pollMs = 3000 }: { sessionId: string | undefined; pollMs?: number }) {
  const [view, setView] = useState<SessionStateView | undefined>(undefined)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (sessionId === undefined) {
      setView(undefined)
      return undefined
    }
    let live = true
    let timer: number | undefined
    const load = (): void => {
      void fetch(`${STATE_URL}?sessionId=${encodeURIComponent(sessionId)}`)
        .then(response => (response.ok ? response.json() as Promise<SessionStateView> : undefined))
        .then(data => {
          if (live) setView(data)
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
  if (sessionId === undefined || (plan === undefined && goal === undefined)) return null
  const summary = [
    plan !== undefined ? (plan.pending ? t('review.planPending') : t('review.planActive')) : undefined,
    goal !== undefined ? goal.title : undefined,
  ].filter(part => part !== undefined).join(' · ')

  return (
    <Disclosure title={t('review.sessionState')} summary={summary} open={open} onToggle={() => { setOpen(!open) }}>
      <div className={css.sessionState}>
        {plan !== undefined && (
          <span className={css.sessionStateRow}>
            <span className={`${css.chip} ${plan.pending ? css.sessionStatePlanPending : css.sessionStatePlanActive}`}>
              {plan.pending ? t('review.planPending') : t('review.planActive')}
            </span>
            <span className={css.sessionStateHint}>{t('review.planHint')}</span>
          </span>
        )}
        {goal !== undefined && (
          <span className={css.sessionStateRow}>
            <span className={`${css.chip}${goal.active ? ` ${css.sessionStateGoalOn}` : ''}`}>
              {goal.active ? t('review.goalActive') : t('review.goal')}
            </span>
            <span className={css.sessionStateTitle}>{goal.title}</span>
          </span>
        )}
      </div>
    </Disclosure>
  )
}
