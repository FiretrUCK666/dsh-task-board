/**
 * Task detail: the full view of one task — content, prompt, execution
 * history — and the only place execution can be triggered. Also offers
 * delete (with confirmation), manual status moves, and a jump to the
 * execution's session transcript.
 */
import { useEffect, useState } from 'react'
import type { BoardController, PendingInteractionKind } from '../../core/controller.ts'
import { DEFAULT_PRESETS, LocalStoragePresetStore, type SchedulePreset } from '../../core/presets.ts'
import { describeCron, isValidCron, nextRunAtMs } from '../../core/schedule.ts'
import { MANUAL_STATUSES, hasHiddenRows, hasOpenRun, plainRunsOf, ruleReadiness, type ExecutionRecord, type ScheduleMode, type TaskRecord, type TaskStatus } from '../../core/tasks.ts'
import { executionUnviewed, sessionDisplay, sessionTimes } from '../../core/session-display.ts'
import { permissionLabel } from '../permission-label.ts'
import { isEnglish, t, type TaskBoardKey } from '../locales.ts'
import css from '../board.module.css'
import { ConfirmDialog } from './ConfirmDialog.tsx'
import { Chip, type ChipKind } from './Chip.tsx'
import { formatDateTime, formatDuration, formatTime } from './TaskCard.tsx'
import { TaskForm } from './TaskForm.tsx'
import { draftFromTask, draftToUpdatePatch, type TaskDraft } from './task-draft.ts'
import { mergedPresets, PresetManager } from './PresetManager.tsx'
import { RefineSection } from './RefineSection.tsx'
import { ReviewDetail } from './ReviewDetail.tsx'
import { SessionDetail } from './SessionDetail.tsx'
import { SessionRow } from './SessionRow.tsx'
import { commentsOf } from './comment-thread.ts'
import { Button, Icon, Section, Switch } from './ui.tsx'
import { STATUS_KEY } from './status.ts'

/** Status → shared-chip color (detail badge). */
const STATUS_CHIP: Record<TaskStatus, ChipKind> = {
  backlog: 'neutral',
  todo: 'neutral',
  running: 'warn',
  review: 'neutral',
  done: 'success',
}

/** Paused-readiness explanation keyed by the pausing status. */
function pausedLabelOf(status: 'backlog' | 'review' | 'done'): TaskBoardKey {
  if (status === 'review') return 'detail.schedule.paused.review'
  if (status === 'done') return 'detail.schedule.paused.done'
  return 'detail.schedule.paused.backlog'
}

/** Map session display state to chip kind. */
function stateToChipKind(state: 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled'): ChipKind {
  switch (state) {
    case 'running':
    case 'waiting':
      return 'warn'
    case 'succeeded':
      return 'success'
    case 'failed':
      return 'error'
    case 'cancelled':
      return 'muted'
  }
}

/** Session state → locale key. */
function sessionStateKey(state: 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled', waitingKind: PendingInteractionKind | undefined): TaskBoardKey {
  if (state === 'waiting' && waitingKind !== undefined) {
    return `waiting.${waitingKind}` as TaskBoardKey
  }
  switch (state) {
    case 'running':
      return 'detail.result.running'
    case 'succeeded':
      return 'detail.result.succeeded'
    case 'failed':
      return 'detail.result.failed'
    case 'cancelled':
      return 'detail.result.cancelled'
    default:
      return 'detail.result.running'
  }
}

/** One execution-history row: sequence, outcome, exact start/end times,
 *  plus the session's at-a-glance dynamics (its own latest comment with its
 *  state, and whether the session waits on the user). Clicking the row opens
 *  the review page (review the conversation and comment to continue it); the
 *  native "view session" jump stays on the row. Re-running is one action on
 *  the detail footer — it always starts a fresh round with the task's
 *  current prompt, so rows carry no rerun button (a row's "rerun" would be
 *  ambiguous next to comments). The row is an execution-kind SessionRow:
 *  the kind's data is computed here, the row skeleton is shared with the
 *  linked-session rows. */
function ExecutionRow({ execution, index, task, sessionTitle, waitingKind, cruiseOn, onReview, onOpen, onHide }: {
  execution: ExecutionRecord
  /** 1-based execution sequence (comment rounds are not part of the list). */
  index: number
  /** The task owning this execution. */
  task: TaskRecord
  /** The execution session's display title (native; falls back to the task
   *  title) — the identity slot shares one leading grammar with linked rows. */
  sessionTitle: string
  /** The session's pending-interaction kind when it waits on the user. */
  waitingKind: PendingInteractionKind | undefined
  /** Whether the auto-cruise is on (comment states derive from it). */
  cruiseOn: boolean
  onReview: () => void
  onOpen: (sessionId: string) => void
  /** Hide this row from the list (non-destructive; numbering stays stable). */
  onHide: () => void
}) {
  const session = sessionDisplay(task, execution, waitingKind)
  const times = sessionTimes(task, execution)
  // Session is active if running or waiting.
  const isActive = session.state === 'running' || session.state === 'waiting'
  // This execution's own comment thread (summary: count + latest text/time,
  // without opening the review page).
  const comments = commentsOf(task, execution, cruiseOn)
  const latestComment = comments.length > 0 ? comments[comments.length - 1] : undefined
  // The row's unread reminder: the session (run + comments) has content
  // newer than the last time its review page was opened.
  const unviewed = executionUnviewed(task, execution)
  const sessionId = execution.sessionId
  return (
    <SessionRow
      kind="execution"
      state={session.state}
      chip={{
        kind: stateToChipKind(session.state),
        label: t(sessionStateKey(session.state, session.waitingKind)),
        spinner: isActive,
      }}
      leading={
        <span className={css.sessionRowLeading} title={sessionTitle}>
          <span className={css.sessionRowName}>{sessionTitle}</span>
          <span className={css.sessionRowMetaNote}>{t('detail.executionNo', { n: String(index) })}</span>
        </span>
      }
      meta={
        <>
          {t('detail.executionStarted')} {formatDateTime(times.startedAt)}
          {' · '}
          {t('detail.executionEnded')} {times.endedAt !== undefined ? formatDateTime(times.endedAt) : '—'}
          {times.duration !== undefined && (
            <> · {t('detail.duration', { d: formatDuration(times.duration) })}</>
          )}
        </>
      }
      footer={
        <>
          {/* The comment summary: how many comments, the latest one and when —
              visible without opening the review page. */}
          {latestComment !== undefined && (
            <span className={css.executionComments} title={latestComment.round.comment}>
              <span className={css.executionCommentsCount}>{t('detail.comments', { n: String(comments.length) })}</span>
              <span className={css.executionCommentsLatest}>{t('detail.latestComment', { text: latestComment.round.comment ?? '' })}</span>
              <span className={css.executionCommentsTime}>{formatTime(latestComment.round.startedAt)}</span>
            </span>
          )}
          {/* Only show dynamics when session is active (reduce clutter for settled executions). */}
          {isActive && (
            <span className={css.executionDynamics}>
              <span className={css.executionDynamicsLabel}>
                {session.state === 'waiting'
                  ? t('detail.handleHint', { kind: t(`waiting.${session.waitingKind}` as 'waiting.approval') })
                  : t('detail.sessionActive')}
              </span>
            </span>
          )}
          {execution.error !== undefined && execution.error !== '' && (
            <span className={css.executionError}>{execution.error}</span>
          )}
        </>
      }
      unviewed={unviewed}
      unviewedTitle={t('detail.unviewedTitle')}
      handle={session.state === 'waiting' && sessionId !== undefined ? t('detail.handle') : undefined}
      sessionId={sessionId}
      onActivate={onReview}
      onOpenSession={() => { if (sessionId !== undefined) onOpen(sessionId) }}
      onHide={onHide}
      hideTitle={t('detail.hideRow')}
    />
  )
}

/** One linked-session row + its live status chip, rendered in the linked
 *  section. The whole row opens the session's detail panel (same shell as
 *  the execution review page, read-only); the row's own actions stay on the
 *  row and never bubble into the click. The row is a linked-kind SessionRow:
 *  same skeleton as the execution rows, with the kind's data computed here. */
function LinkedRow({ row, task, controller, onOpen }: {
  row: import('../../core/linked-sessions.ts').LinkedSessionRow
  task: TaskRecord
  controller: BoardController
  onOpen: () => void
}) {
  const waiting = row.pendingInteraction
  const chip = waiting !== undefined
    ? { kind: 'warn' as const, label: t(`waiting.${waiting}` as 'waiting.approval'), spinner: true }
    : row.running
      ? { kind: 'warn' as const, label: t('detail.result.running'), spinner: true }
      : row.completed
        ? { kind: 'success' as const, label: t('detail.linkedDone') }
        : undefined
  return (
    <SessionRow
      kind="linked"
      chip={chip}
      leading={
        <span className={css.sessionRowLeading}>
          <Icon name="link" className={css.sessionRowIcon} />
          <span className={css.sessionRowName} title={row.title}>{row.title}</span>
          {row.workspaceLabel !== undefined && row.workspaceLabel !== row.title && (
            <span className={css.sessionRowWorkspace}>{row.workspaceLabel}</span>
          )}
        </span>
      }
      meta={
        <>
          {t('detail.sessionUpdated')} {formatDateTime(row.updatedAt)}
        </>
      }
      sessionId={row.sessionId}
      onActivate={onOpen}
      onOpenSession={() => { controller.openSession(row.sessionId) }}
      onHide={() => { controller.hideTaskRow(task.id, 'sessions', row.sessionId) }}
      hideTitle={t('detail.hideRow')}
    />
  )
}

/**
 * The linked-session rows of a bound task (live derivation, non-destructive
 * hide/restore, unbind): rendered inside the task's unified "会话" section,
 * below the execution rows. Each row is a live view of one native session
 * (its title, workspace, running/waiting state, last update) — never copies,
 * always a pure derivation of the native snapshots.
 */
function LinkedRows({ controller, task, onOpenSession }: {
  controller: BoardController
  task: TaskRecord
  /** Open the session's detail panel (the shared review shell, read-only). */
  onOpenSession: (sessionId: string) => void
}) {
  const rows = controller.linkedOf(task)
  return (
    <>
      {rows.length === 0 ? (
        <p className={css.detailText}>{t('detail.linkedEmpty')}</p>
      ) : (
        <ul className={css.sessionList}>
          {rows.map(row => (
            <LinkedRow
              key={row.sessionId}
              row={row}
              task={task}
              controller={controller}
              onOpen={() => { onOpenSession(row.sessionId) }}
            />
          ))}
        </ul>
      )}
      <div className={css.linkedActions}>
        {/* The linked view is a live derivation (new sessions, archiving and
            renames sync automatically), so the only user-mutable state is
            the display-only hide set: the restore affordance shows only when
            there is something to restore — a dead "同步" button never renders,
            for both workspace-bound and single-session-bound tasks. */}
        {hasHiddenRows(task, 'sessions') && (
          <Button onClick={() => { controller.unhideTaskRows(task.id, 'sessions') }}>
            {t('detail.restoreHidden')}
          </Button>
        )}
        <Button variant="ghost" onClick={() => { controller.unbindTask(task.id) }}>
          {t('detail.linkedUnbind')}
        </Button>
      </div>
      <p className={css.detailHint}>{t('detail.linkedHint')}</p>
    </>
  )
}

/** Short weekday names (0 = Sunday), locale-aware. */
const WEEKDAYS_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Human label for a list of weekday numbers. */
function weekdayLabel(weekdays: readonly number[]): string {
  const names = isEnglish() ? WEEKDAYS_EN : WEEKDAYS_ZH
  const joiner = isEnglish() ? ', ' : '、'
  return weekdays.map(day => names[day] ?? String(day)).join(joiner)
}

/** Human-readable description of the cron text currently in the editor. */
function cronDescriptionLabel(expr: string): string {
  const description = describeCron(expr)
  if (description === undefined) return t('detail.schedule.invalid')
  switch (description.kind) {
    case 'everyMinute':
      return t('schedule.desc.everyMinute')
    case 'everyMinutes':
      return t('schedule.desc.everyMinutes', { n: String(description.minutes) })
    case 'everyHours':
      return t('schedule.desc.everyHours', { n: String(description.hours) })
    case 'dailyAt':
      return t('schedule.desc.dailyAt', { time: description.time })
    case 'weekdaysAt':
      return t('schedule.desc.weekdaysAt', { time: description.time })
    case 'weeklyAt':
      return t('schedule.desc.weeklyAt', {
        days: weekdayLabel(description.weekdays),
        time: description.time,
      })
    case 'monthlyAt':
      return t('schedule.desc.monthlyAt', {
        days: description.days.map(String).join(isEnglish() ? ', ' : '、'),
        time: description.time,
      })
    case 'custom':
      return t('schedule.desc.custom')
  }
}

/** The scheduled-runs editor: mode, cron input + presets, run budget, next-run info. */
function ScheduleSection({ controller, task }: { controller: BoardController; task: TaskRecord }) {
  const schedule = task.schedule
  // `||` (not `??`) falls back to the default even for an empty stored
  // expression, so switching modes can never leave the editor with a blank
  // cron value.
  const [cron, setCron] = useState(schedule?.cron || '0 9 * * *')
  const [enabled, setEnabled] = useState(schedule?.enabled ?? false)
  const [mode, setMode] = useState<ScheduleMode>(schedule?.mode ?? 'cron')
  const [maxRuns, setMaxRuns] = useState(schedule?.maxRuns?.toString() ?? '')
  const [nextRunAt, setNextRunAt] = useState<number | undefined>(schedule?.nextRunAt)
  const [lastTriggeredAt, setLastTriggeredAt] = useState<number | undefined>(schedule?.lastTriggeredAt)
  const [error, setError] = useState<string | undefined>(undefined)
  const [showPresets, setShowPresets] = useState(false)
  const [presetStore] = useState(() => new LocalStoragePresetStore())
  // The merged preset list (built-ins + custom); rebuilt when the manager closes.
  const [presets, setPresets] = useState(() => mergedPresets(presetStore))

  // Keep the editor in sync when the task record changes underneath (the
  // schedule rolls forward as runs trigger).
  useEffect(() => {
    setCron(schedule?.cron || '0 9 * * *')
    setEnabled(schedule?.enabled ?? false)
    setMode(schedule?.mode ?? 'cron')
    setMaxRuns(schedule?.maxRuns?.toString() ?? '')
    setNextRunAt(schedule?.nextRunAt)
    setLastTriggeredAt(schedule?.lastTriggeredAt)
    setError(undefined)
  }, [task.id, schedule?.enabled, schedule?.mode, schedule?.cron, schedule?.nextRunAt, schedule?.lastTriggeredAt, schedule?.maxRuns, schedule?.runCount])

  /** Validate + persist the current cron text (Enter or blur). */
  const saveCron = (value: string): void => {
    const trimmed = value.trim()
    setCron(trimmed)
    if (trimmed === '' || !isValidCron(trimmed)) {
      setError(t('detail.schedule.invalid'))
      return
    }
    setError(undefined)
    controller.setSchedule(task.id, { cron: trimmed })
  }

  /** Persist the run budget (blank = unlimited). */
  const saveMaxRuns = (value: string): void => {
    const trimmed = value.trim()
    setMaxRuns(trimmed)
    if (trimmed === '') {
      controller.setSchedule(task.id, { maxRuns: undefined })
      return
    }
    const parsed = Number(trimmed)
    if (!Number.isInteger(parsed) || parsed < 1) {
      setError(t('detail.schedule.invalidRuns'))
      return
    }
    setError(undefined)
    controller.setSchedule(task.id, { maxRuns: parsed })
  }

  /** Arm/disarm the schedule. Arming a chain without a run budget (unlimited)
   *  risks an endless loop of real agent sessions — confirm once first. */
  const applyEnabled = (next: boolean): void => {
    if (next && mode === 'cron' && cron.trim() !== schedule?.cron) controller.setSchedule(task.id, { cron: cron.trim() })
    if (controller.setSchedule(task.id, { enabled: next, mode })) setEnabled(next)
  }

  /** Arm/disarm the schedule (arming first persists the edited cron). */
  const toggleEnabled = (next: boolean): void => {
    const trimmed = cron.trim()
    if (next && mode === 'cron' && (trimmed === '' || !isValidCron(trimmed))) {
      setError(t('detail.schedule.invalid'))
      return
    }
    setError(undefined)
    if (next && mode === 'chain' && (maxRuns.trim() === '' || Number(maxRuns) < 1)) {
      setConfirm('unlimited-enable')
      return
    }
    applyEnabled(next)
  }

  /** Switch the driving mode (cron ↔ chain). Switching back to cron first
   *  persists the editor's current expression, so the stored rule is never
   *  left with an empty cron (which cron mode would reject). */
  const switchMode = (next: ScheduleMode): void => {
    if (next === mode) return
    if (next === 'cron' && (cron.trim() === '' || !isValidCron(cron))) {
      setError(t('detail.schedule.invalid'))
      return
    }
    setError(undefined)
    setMode(next)
    if (next === 'cron' && cron.trim() !== schedule?.cron) {
      controller.setSchedule(task.id, { cron: cron.trim() })
    }
    if (controller.setSchedule(task.id, { mode: next })) {
      // Re-arm under the new mode so an enabled switch takes effect at once.
      controller.setSchedule(task.id, { enabled, mode: next })
    }
  }

  /** Stop an active chain: only the automation stops (enabled:false — the
   *  card's column is untouched). Unlimited chains confirm once (endless
   *  loop of real agent sessions is a big side effect). */
  const stopChain = (): void => {
    if (maxRuns.trim() === '' || Number(maxRuns) < 1) {
      setConfirm('stop-chain')
      return
    }
    if (controller.setSchedule(task.id, { enabled: false, mode })) setEnabled(false)
  }
  const applyStopChain = (): void => {
    if (controller.setSchedule(task.id, { enabled: false, mode })) setEnabled(false)
  }

  /** Skip the next cron firing: roll nextRunAt forward to the following
   *  match while keeping the rule armed — a "defer once", never a catch-up. */
  const skipNext = (): void => {
    if (mode !== 'cron' || nextRunAt === undefined) return
    const next = nextRunAtMs(cron, nextRunAt)
    if (next === undefined) return
    setNextRunAt(next)
    controller.applyScheduleNextRun(task.id, next, lastTriggeredAt)
  }

  const applyPreset = (preset: string): void => {
    if (preset === '') return
    setCron(preset)
    setError(undefined)
    controller.setSchedule(task.id, { cron: preset })
  }

  const closePresets = (): void => {
    setShowPresets(false)
    setPresets(mergedPresets(presetStore))
  }

  const readiness = ruleReadiness(task)
  const chainRuns = schedule?.runCount ?? 0
  const chainBudget = schedule?.maxRuns
  const nextLabel = !enabled || mode !== 'cron' || nextRunAt === undefined
    ? t('detail.schedule.notScheduled')
    : nextRunAt <= Date.now()
      ? t('detail.schedule.dueSoon')
      : new Date(nextRunAt).toLocaleString()
  const lastLabel = lastTriggeredAt === undefined ? '—' : new Date(lastTriggeredAt).toLocaleString()
  // Cron skip is offered only when a future due instant actually exists.
  const canSkip = enabled && mode === 'cron' && readiness.kind === 'active'
    && nextRunAt !== undefined && nextRunAt > Date.now()
  // A paused rule names its blocking status; a review pause caused by a
  // failed run adds the "because it failed" reason word.
  const stoppedReason = readiness.kind === 'paused'
    ? {
        extraFailed: readiness.status === 'review'
          && task.executions[task.executions.length - 1]?.result === 'failed',
        key: pausedLabelOf(readiness.status),
      }
    : undefined

  // Collapsed by default: the detail stays quiet, one summary line reads the
  // rule's true state — closed / paused (with the blocking reason) / running.
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState<'unlimited-enable' | 'stop-chain' | undefined>(undefined)
  const summary = !enabled
    ? t('detail.schedule.off')
    : readiness.kind === 'paused'
      ? `${t('detail.schedule.paused')}${stoppedReason?.extraFailed === true
          ? ` · ${t('detail.schedule.pausedFailedShort')}`
          : ` (${t(STATUS_KEY[readiness.status])})`}`
      : mode === 'cron'
        ? `${t('detail.schedule.mode.cron')} · ${nextLabel}`
        : `${t('detail.schedule.mode.chain')} · ${t('detail.schedule.runsSoFar')} ${chainRuns}${chainBudget !== undefined ? `/${chainBudget}` : ''}`

  return (
    <section className={css.detailSection}>
      <button
        type="button"
        className={css.scheduleDisclosure}
        aria-expanded={open}
        onClick={() => { setOpen(!open) }}
      >
        <Icon name="chevronDown" className={css.scheduleChevron} />
        <span className={css.scheduleDisclosureTitle}>{t('detail.schedule')}</span>
        <span className={css.scheduleSummary}>{summary}</span>
      </button>
      {open && (
        <>
      <Switch
        checked={enabled}
        onChange={toggleEnabled}
        label={t('detail.schedule.enable')}
      />

      {/* One line that names the scopes: this rule is task-level; cruise is
          board-level — the two "auto" concepts never blur. */}
      <p className={css.scheduleMeta}>{t('detail.schedule.scope')}</p>

      {/* Driving mode: fixed times (cron) or run-after-completion (chain). */}
      <div className={css.segmentedRow} role="radiogroup" aria-label={t('detail.schedule')}>
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'cron'}
          className={`${css.segmentedButton}${mode === 'cron' ? ` ${css.segmentedActive}` : ''}`}
          title={t('detail.schedule.mode.cronHint')}
          onClick={() => { switchMode('cron') }}
        >
          {t('detail.schedule.mode.cron')}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'chain'}
          className={`${css.segmentedButton}${mode === 'chain' ? ` ${css.segmentedActive}` : ''}`}
          title={t('detail.schedule.mode.chainHint')}
          onClick={() => { switchMode('chain') }}
        >
          {t('detail.schedule.mode.chain')}
        </button>
      </div>

      {mode === 'cron' ? (
        <div className={css.scheduleGrid}>
          <span className={css.scheduleLabel}>{t('detail.schedule.cron')}</span>
          <span className={css.scheduleCronRow}>
            <input
              className={`${css.input} ${css.scheduleInput}${error !== undefined ? ` ${css.scheduleInputInvalid}` : ''}`}
              value={cron}
              placeholder="0 9 * * *"
              spellCheck={false}
              aria-label={t('detail.schedule.cron')}
              onChange={event => { setCron(event.target.value); setError(undefined) }}
              onBlur={() => { saveCron(cron) }}
              onKeyDown={event => { if (event.key === 'Enter') saveCron(cron) }}
            />
            <span className={css.selectWrap}>
              <select
                className={css.schedulePreset}
                value=""
                aria-label={t('detail.schedule.presets')}
                onChange={event => { applyPreset(event.target.value) }}
              >
                <option value="">{t('detail.schedule.presets')}…</option>
                {presets.map(preset => (
                  <option key={preset.id} value={preset.cron}>
                    {preset.label}
                    {!presetIsDefault(preset) ? ` (${t('detail.schedule.presets.custom')})` : ''}
                  </option>
                ))}
              </select>
            </span>
            <Button onClick={() => { setShowPresets(true) }}>
              {t('detail.schedule.managePresets')}
            </Button>
          </span>
        </div>
      ) : (
        <>
          <p className={css.scheduleMeta}>{t('detail.schedule.chainNote')}</p>
          <div className={css.scheduleActionRow}>
            <span className={css.scheduleMeta}>
              {t('detail.schedule.runsSoFar')} {chainRuns}
              {chainBudget !== undefined ? ` / ${chainBudget}` : ` · ${t('detail.schedule.unlimited')}`}
            </span>
            {enabled && (
              <Button size="sm" variant="ghost" onClick={stopChain}>
                {t('detail.schedule.stopChain')}
              </Button>
            )}
          </div>
          {stoppedReason !== undefined && (
            <p className={css.scheduleMeta}>
              {stoppedReason.extraFailed && <>{t('detail.schedule.pausedFailed')} </>}
              {t(stoppedReason.key)}
            </p>
          )}
        </>
      )}

      <div className={css.scheduleGrid}>
        <span className={css.scheduleLabel}>{t('detail.schedule.maxRuns')}</span>
        <span className={css.scheduleMaxRow}>
          <input
            className={`${css.input} ${css.scheduleMaxInput}`}
            value={maxRuns}
            type="number"
            min={1}
            placeholder="∞"
            spellCheck={false}
            aria-label={t('detail.schedule.maxRuns')}
            onChange={event => { setMaxRuns(event.target.value); setError(undefined) }}
            onBlur={() => { saveMaxRuns(maxRuns) }}
            onKeyDown={event => { if (event.key === 'Enter') saveMaxRuns(maxRuns) }}
          />
          <span className={css.scheduleMeta}>
            {t('detail.schedule.runsSoFar')} {schedule?.runCount ?? 0}
            {schedule?.maxRuns !== undefined && ` / ${schedule.maxRuns}`}
          </span>
        </span>
      </div>
      {error !== undefined && <p className={css.formError}>{error}</p>}
      {mode === 'cron' && (
        <>
          <div className={css.scheduleActionRow}>
            <span className={css.scheduleMeta}>
              {cronDescriptionLabel(cron)}
              {' · '}
              {readiness.kind === 'active'
                ? `${t('detail.schedule.nextRun')} ${nextLabel}`
                : t('detail.schedule.paused')}
              {' · '}{t('detail.schedule.lastTriggered')} {lastLabel}
            </span>
            {canSkip && (
              <Button size="sm" variant="ghost" onClick={skipNext}>
                {t('detail.schedule.skip')}
              </Button>
            )}
          </div>
          {stoppedReason !== undefined && (
            <p className={css.scheduleMeta}>
              {stoppedReason.extraFailed && <>{t('detail.schedule.pausedFailed')} </>}
              {t(stoppedReason.key)}
            </p>
          )}
        </>
      )}

      {showPresets && (
        <PresetManager
          store={presetStore}
          onClose={closePresets}
        />
      )}
        </>
      )}

      {/* Side-effect confirms for automation: enabling an unlimited chain and
          stopping one both confirm once — an endless loop of real agent
          sessions is a big side effect. */}
      {confirm === 'unlimited-enable' && (
        <ConfirmDialog
          title={t('detail.schedule.unlimitedTitle')}
          message={t('detail.schedule.unlimitedConfirm')}
          confirmLabel={t('detail.schedule.unlimitedOk')}
          danger
          onCancel={() => { setConfirm(undefined) }}
          onConfirm={() => { setConfirm(undefined); applyEnabled(true) }}
        />
      )}
      {confirm === 'stop-chain' && (
        <ConfirmDialog
          title={t('detail.schedule.stopChainTitle')}
          message={t('detail.schedule.stopChainConfirm')}
          confirmLabel={t('detail.schedule.stopChain')}
          danger
          onCancel={() => { setConfirm(undefined) }}
          onConfirm={() => { setConfirm(undefined); applyStopChain() }}
        />
      )}
    </section>
  )
}

/** Whether a preset id belongs to the built-in defaults. */
function presetIsDefault(preset: SchedulePreset): boolean {
  return DEFAULT_PRESETS.some(candidate => candidate.id === preset.id)
}

/** Task detail overlay. */
export function TaskDetail({ controller, task, workspaceTitleOf }: {
  controller: BoardController
  task: TaskRecord
  /** Resolve a workspace id to its display title (raw id when unknown). */
  workspaceTitleOf: (workspaceId: string) => string
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  // Edit-mode draft; undefined = not editing. Kept separate from `current`
  // so live record updates (e.g. an execution settling) never clobber it.
  const [draft, setDraft] = useState<TaskDraft | undefined>(undefined)
  const [editError, setEditError] = useState<string | undefined>(undefined)
  // The execution row whose review page is open (undefined = none).
  const [reviewExecution, setReviewExecution] = useState<ExecutionRecord | undefined>(undefined)
  // The linked session whose detail panel is open (undefined = none).
  const [linkedSession, setLinkedSession] = useState<string | undefined>(undefined)

  // Keep the overlay in sync if the task record changes underneath.
  const [latest, setLatest] = useState(task)
  useEffect(() => { setLatest(task) }, [task])
  const current = latest

  // A card is busy while its latest run is still open AND the task is
  // running (hasOpenRun): a scheduled batch keeps the card 'running'
  // between runs, so `running` alone must not disable the button; a pending
  // comment round (task not running) must never disable it either.
  const busy = hasOpenRun(current)

  // The visible execution-history list: plain runs minus the user's
  // display-hidden rows. The section title counts exactly what the list
  // shows (计数即所见), and row numbering stays absolute — hiding a middle
  // row never renumbers the others.
  const hiddenExecutions = current.hidden?.executions !== undefined ? new Set(current.hidden.executions) : undefined
  const visibleRuns = plainRunsOf(current).filter(run => hiddenExecutions === undefined || !hiddenExecutions.has(run.id))

  const editing = draft !== undefined

  /** Enter edit mode with a draft of the current record. */
  const startEditing = (): void => {
    setDraft(draftFromTask(current))
    setEditError(undefined)
  }

  /** Persist the draft; a blank title is rejected with an inline error. */
  const saveEdit = (): void => {
    if (draft === undefined) return
    if (!controller.updateTask(current.id, draftToUpdatePatch(draft))) {
      setEditError(t('new.required'))
      return
    }
    setDraft(undefined)
    setEditError(undefined)
  }

  /** Discard the draft and leave edit mode. */
  const cancelEdit = (): void => {
    setDraft(undefined)
    setEditError(undefined)
  }

  return (
    <div className={css.modalBackdrop} onMouseDown={event => { if (event.target === event.currentTarget) controller.closeTask() }}>
      <div className={css.detail} role="dialog" aria-label={t('detail.title')}>
        <header className={css.detailHeader}>
          <h2 className={css.detailTitle}>{current.title}</h2>
          <Chip kind={STATUS_CHIP[current.status]}>{t(STATUS_KEY[current.status])}</Chip>
          {!editing && (
            <Button onClick={startEditing}>
              {t('detail.edit')}
            </Button>
          )}
          <button
            type="button"
            className={css.iconButton}
            aria-label={t('detail.close')}
            onClick={() => { controller.closeTask() }}
          >
            <Icon name="close" />
          </button>
        </header>

        <div className={css.detailBody}>
          {editing && draft !== undefined ? (
            <>
              <TaskForm draft={draft} onChange={setDraft} controller={controller} />
              {editError !== undefined && <p className={css.formError}>{editError}</p>}
            </>
          ) : (
            <>
              <Section title={t('detail.description')}>
                <div className={css.contentBlock}>{current.description !== '' ? current.description : '—'}</div>
              </Section>

              <Section title={t('detail.prompt')}>
                {/* An empty run prompt is nothing — the same em dash as the
                    description. It never shows the title as if it were a
                    prompt (the title only serves as the execution fallback). */}
                <pre className={css.promptBlock}>{current.prompt !== '' ? current.prompt : '—'}</pre>
              </Section>

              <Section title={t('detail.runConfig')}>
                {/* The five rows always render: an unset field means "use the
                    deployment default", shown as 默认 — a dragged-in or fresh
                    card reads complete instead of silently missing rows. */}
                <dl className={css.configGrid}>
                  <div className={css.configRow}>
                    <dt className={css.configLabel}>{t('new.workspace')}</dt>
                    <dd className={css.configValue}>
                      {current.workspaceId !== undefined
                        ? workspaceTitleOf(current.workspaceId)
                        : t('new.workspaceDefault')}
                    </dd>
                  </div>
                  <div className={css.configRow}>
                    <dt className={css.configLabel}>{t('new.agentPreset')}</dt>
                    <dd className={css.configValue}>
                      {current.agentPreset !== undefined ? current.agentPreset : t('new.agentPresetDefault')}
                    </dd>
                  </div>
                  <div className={css.configRow}>
                    <dt className={css.configLabel}>{t('new.model')}</dt>
                    <dd className={css.configValue}>
                      {current.provider !== undefined && current.model !== undefined
                        ? `${current.provider} / ${current.model}`
                        : t('new.modelDefault')}
                    </dd>
                  </div>
                  <div className={css.configRow}>
                    <dt className={css.configLabel}>{t('new.effort')}</dt>
                    <dd className={css.configValue}>
                      {current.reasoningEffort !== undefined ? current.reasoningEffort : t('new.effortDefault')}
                    </dd>
                  </div>
                  <div className={css.configRow}>
                    <dt className={css.configLabel}>{t('new.permission')}</dt>
                    <dd className={css.configValue}>
                      {current.permission !== undefined ? permissionLabel(current.permission) : t('new.permissionDefault')}
                    </dd>
                  </div>
                </dl>
              </Section>
            </>
          )}

          <ScheduleSection controller={controller} task={current} />

          {/* 会话视角：执行记录与链接会话统一进同一个「会话」section ——
              同一行文法（SessionRow）、同一容器（sessionList）、同一标题节奏；
              执行行在上、链接行在下，中间用安静分组标签隔开，两块从此读作
              同一个"会话"区块而不是两个互不相干的部件。 */}
          <Section title={`${t('detail.sessions')} ${visibleRuns.length + (current.bind !== undefined ? controller.linkedOf(current).length : 0)}`}>
            <p className={css.detailHint}>{t('detail.executionHint')}</p>
            {visibleRuns.length === 0 ? (
              <p className={css.detailText}>
                {plainRunsOf(current).length > 0
                  ? t('detail.executionHiddenAll')
                  : current.bind !== undefined
                    ? t('detail.noExecutionLinked')
                    : t('detail.noExecution')}
              </p>
            ) : (
              <ul className={css.sessionList}>
                {[...visibleRuns].reverse().map(execution => (
                  <ExecutionRow
                    key={execution.id}
                    execution={execution}
                    index={plainRunsOf(current).findIndex(candidate => candidate.id === execution.id) + 1}
                    task={current}
                    sessionTitle={controller.sessionTitle(execution.sessionId) ?? current.title}
                    waitingKind={controller.pendingInteractionOf(execution.sessionId)}
                    cruiseOn={controller.getSnapshot().cruise.enabled}
                    onReview={() => { setReviewExecution(execution) }}
                    onOpen={sessionId => { controller.openSession(sessionId) }}
                    onHide={() => { controller.hideTaskRow(current.id, 'executions', execution.id) }}
                  />
                ))}
              </ul>
            )}
            {hasHiddenRows(current, 'executions') && (
              <Button onClick={() => { controller.unhideTaskRows(current.id, 'executions') }}>
                {t('detail.restoreHidden')}
              </Button>
            )}

            {current.bind !== undefined && (
              <>
                <h5 className={css.sessionGroupLabel}>
                  {t('detail.linked')}
                  {controller.linkedOf(current).length > 0 ? ` ${controller.linkedOf(current).length}` : ''}
                </h5>
                <LinkedRows
                  controller={controller}
                  task={current}
                  onOpenSession={sessionId => { setLinkedSession(sessionId) }}
                />
              </>
            )}
          </Section>

          {current.status === 'backlog' && (
            <RefineSection controller={controller} task={current} />
          )}

          <Section title={t('board.status')}>
            <div className={css.moveRow}>
              {MANUAL_STATUSES.map(status => (
                <Button
                  key={status}
                  disabled={current.status === status || busy}
                  onClick={() => { controller.moveTask(current.id, status) }}
                >
                  {t(`status.move.${status}` as TaskBoardKey)}
                </Button>
              ))}
            </div>
          </Section>
        </div>

        <footer className={css.detailFooter}>
          {editing ? (
            <>
              <Button variant="primary" onClick={saveEdit}>
                {t('detail.save')}
              </Button>
              <Button onClick={cancelEdit}>
                {t('detail.cancel')}
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              disabled={busy}
              title={t('detail.rerunHint')}
              onClick={() => {
                // Running kicks off a real agent session; close the detail so
                // the whole board stays visible while the task executes.
                controller.closeTask()
                void controller.rerunTask(current.id)
              }}
            >
              {current.executions.length === 0 ? t('detail.run') : t('detail.rerun')}
            </Button>
          )}
          <Button variant="danger" onClick={() => { setConfirmDelete(true) }}>
            {t('detail.delete')}
          </Button>
          <span className={css.detailMeta}>
            {t('board.created')} {formatTime(current.createdAt)}
          </span>
        </footer>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={t('delete.title')}
          message={t('delete.confirm', { name: current.title })}
          confirmLabel={t('delete.ok')}
          danger
          onCancel={() => { setConfirmDelete(false) }}
          onConfirm={() => {
            setConfirmDelete(false)
            controller.deleteTask(current.id)
            controller.closeTask()
          }}
        />
      )}
      {reviewExecution !== undefined && (
        <ReviewDetail
          controller={controller}
          task={current}
          execution={reviewExecution}
          onClose={() => { setReviewExecution(undefined) }}
        />
      )}
      {linkedSession !== undefined && (
        <SessionDetail
          controller={controller}
          task={current}
          sessionId={linkedSession}
          onClose={() => { setLinkedSession(undefined) }}
        />
      )}
    </div>
  )
}
