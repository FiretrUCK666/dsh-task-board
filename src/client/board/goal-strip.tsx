/**
 * The session goal strip: the board's GoalBar — a goal glyph, the phase
 * label, the truncated objective, and the native verbs (pause / resume /
 * edit-inline / clear), verbatim the harness GoalBar grammar: loading
 * (undefined), no goal (null) and complete goals render nothing; a cleared
 * goal stays hidden until a new id arrives; one action at a time
 * (single-flight); failures land on an inline error line (never a silent
 * no-op, never a throw at the click site).
 *
 * Durable state arrives as the projected whole snapshot (the context's goal,
 * same source as the native surface); the CAS ref for each verb is read at
 * call time from the live binding (the RPC guards staleness). Creation lives
 * on the `/goal` command, not here — exactly like the official strip.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { BoardController } from '../../core/controller.ts'
import type { GoalVerbResult, GoalVerbs } from '../../core/goal-verbs.ts'
import { t } from '../locales.ts'
import css from '../board.module.css'
import { Chip } from './Chip.tsx'
import { Icon } from './ui.tsx'
import type { SessionGoalView } from './use-interaction.ts'

/** Strip label per visible phase; complete goals render nothing. */
function phaseLabel(phase: SessionGoalView['phase'], activation: SessionGoalView['activation']): string {
  if (phase === 'paused') return t('review.goalPhasePaused')
  if (phase === 'blocked') return t('review.goalPhaseBlocked')
  if (activation === 'disarmed') return t('review.goalPhaseDisarmed')
  return t('review.goalPhaseActive')
}

export function GoalStrip({ sessionId, controller, goal, activation }: {
  sessionId: string
  controller: BoardController
  /** The projected goal (undefined/null = the strip renders nothing). */
  goal: SessionGoalView | undefined | null
  /** Process-local activation (unknown = treat an active goal as armed). */
  activation: 'armed' | 'disarmed' | undefined
}) {
  const verbs = controller.goalVerbs(sessionId)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [clearedGoalId, setClearedGoalId] = useState<string | null>(null)
  const pendingRef = useRef(false)
  const goalId = goal?.id
  // A new goal id resets the strip (official: editing/error/cleared never
  // leak from the previous goal into the next one).
  useEffect(() => {
    setEditing(false)
    setActionError(null)
    setClearedGoalId(null)
  }, [goalId])
  const runAction = useCallback(async (action: () => Promise<GoalVerbResult>): Promise<GoalVerbResult | undefined> => {
    if (pendingRef.current) return undefined
    pendingRef.current = true
    setPending(true)
    setActionError(null)
    const result = await action()
    pendingRef.current = false
    setPending(false)
    if (!result.ok) setActionError(`${result.error.message} (${result.error.code})`)
    return result
  }, [])
  const startEdit = useCallback((): void => {
    setDraft(goal?.title ?? '')
    setEditing(true)
  }, [goal?.title])
  const handleEdit = useCallback(async (call: GoalVerbs['edit']): Promise<void> => {
    const trimmed = draft.trim()
    if (trimmed === '') return
    if ((await runAction(() => call(trimmed)))?.ok) setEditing(false)
  }, [draft, runAction])
  const handleClear = useCallback(async (call: GoalVerbs['clear'], clearedId: string | undefined): Promise<void> => {
    if ((await runAction(call))?.ok && clearedId !== undefined) setClearedGoalId(clearedId)
  }, [runAction])

  if (verbs === undefined || goal === undefined || goal === null) return null
  if (goal.phase === 'complete') return null
  if (goalId !== undefined && goalId === clearedGoalId) return null
  const phase = goal.phase ?? (goal.active ? 'active' : undefined)
  if (phase === undefined) return null
  const showResume = phase === 'paused' || (phase === 'active' && activation === 'disarmed')
  const showPause = phase === 'active' && activation !== 'disarmed'

  if (editing) {
    return (
      <div className={css.goalStrip} data-goal-strip="">
        <input
          className={`${css.input} ${css.goalStripInput}`}
          type="text"
          aria-label={t('review.goalObjectiveAria')}
          value={draft}
          onChange={event => { setDraft(event.target.value) }}
          onKeyDown={event => {
            if (event.key === 'Enter') void handleEdit(verbs.edit)
            // Editing owns Escape (same law as the session rename): cancel
            // here, never bubble to the shared stack (one key, one owner).
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setEditing(false) }
          }}
          disabled={pending}
          autoFocus
        />
        <span className={css.goalStripActions}>
          <button
            type="button"
            className={css.iconButton}
            aria-label={t('review.goalSave')}
            title={t('review.goalSave')}
            disabled={pending || draft.trim() === ''}
            onClick={() => { void handleEdit(verbs.edit) }}
          >
            <Icon name="check" />
          </button>
          <button
            type="button"
            className={css.iconButton}
            aria-label={t('review.goalCancel')}
            title={t('review.goalCancel')}
            disabled={pending}
            onClick={() => { setEditing(false) }}
          >
            <Icon name="close" />
          </button>
        </span>
        {actionError !== null && <span className={css.goalStripError}>{actionError}</span>}
      </div>
    )
  }
  return (
    <div className={css.goalStrip} data-goal-strip="">
      <div className={css.sessionContextRow}>
        <Chip fill={false} className={css.sessionContextGoalOn}>
          {phaseLabel(phase, activation)}
        </Chip>
        <span className={css.sessionContextText} title={goal.title}>{goal.title}</span>
        <span className={css.goalStripActions}>
          {showResume && (
            <button
              type="button"
              className={css.iconButton}
              aria-label={t('review.goalResume')}
              title={t('review.goalResume')}
              disabled={pending}
              onClick={() => { void runAction(verbs.resume) }}
            >
              <Icon name="play" />
            </button>
          )}
          {showPause && (
            <button
              type="button"
              className={css.iconButton}
              aria-label={t('review.goalPause')}
              title={t('review.goalPause')}
              disabled={pending}
              onClick={() => { void runAction(verbs.pause) }}
            >
              <Icon name="pause" />
            </button>
          )}
          <button
            type="button"
            className={css.iconButton}
            aria-label={t('review.goalEdit')}
            title={t('review.goalEdit')}
            disabled={pending}
            onClick={startEdit}
          >
            <Icon name="pencil" />
          </button>
          <button
            type="button"
            className={css.iconButton}
            aria-label={t('review.goalClear')}
            title={t('review.goalClear')}
            disabled={pending}
            onClick={() => { void handleClear(verbs.clear, goalId) }}
          >
            <Icon name="close" />
          </button>
        </span>
      </div>
      {phase === 'blocked' && goal.blockedReason !== undefined && (
        <p className={css.goalStripBlocked}>{goal.blockedReason.message}</p>
      )}
      {actionError !== null && <span className={css.goalStripError}>{actionError}</span>}
    </div>
  )
}
