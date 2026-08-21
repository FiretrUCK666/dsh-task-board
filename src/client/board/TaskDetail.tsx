/**
 * Task detail: the full view of one task — content, prompt, execution
 * history — and the only place execution can be triggered. Also offers
 * delete (with confirmation), manual status moves, and a jump to the
 * execution's session transcript.
 */
import { useEffect, useRef, useState } from 'react'
import type { BoardController, PendingInteractionKind } from '../../core/controller.ts'
import { DEFAULT_PRESETS, LocalStoragePresetStore, type SchedulePreset } from '../../core/presets.ts'
import { describeCron, isValidCron, nextRunAtMs } from '../../core/schedule.ts'
import { MANUAL_STATUSES, hasOpenRun, plainRunsOf, ruleReadiness, taskBindsOf, type ExecutionRecord, type ScheduleMode, type TaskRecord, type TaskStatus } from '../../core/tasks.ts'
import { hiddenSessionIdsOf, sessionWindowOf } from '../../core/session-list.ts'
import { sessionDisplay, sessionTimes } from '../../core/session-display.ts'
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
import { latestCommentView, sessionCommentsOf } from './comment-thread.ts'
import { editDraftKey, draftStore } from './drafts.ts'
import { Button, Disclosure, Icon, Section, Switch } from './ui.tsx'
import { STATUS_KEY } from './status.ts'
import { candidateExternalDrag, externalDragOf } from '../sidebar-drag.ts'

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

/** One session row of a task — THE single row grammar for every session
 *  (run rows open their review page + show run index/comments/dynamics/error;
 *  external workspace sessions show workspace label + last-updated). */
function SessionActionRow({ row, task, controller, cruiseOn, onReviewExecution, onOpenSessionPanel }: {
  row: import('../../core/session-list.ts').TaskSessionRow
  task: TaskRecord
  controller: BoardController
  cruiseOn: boolean
  /** A run row opens its review page (review the conversation and comment). */
  onReviewExecution: (execution: ExecutionRecord) => void
  /** Every row opens the session panel/thread for its native session. */
  onOpenSessionPanel: (sessionId: string) => void
}) {
  const isRun = row.executionId !== undefined
  const sessionId = row.sessionId
  if (isRun) {
    const execution = task.executions.find(candidate => candidate.id === row.executionId)
    if (execution === undefined) return null
    const session = sessionDisplay(task, execution, row.display.waitingKind)
    const times = sessionTimes(task, execution)
    const isActive = session.state === 'running' || session.state === 'waiting'
    const comments = sessionId !== undefined ? sessionCommentsOf(task, sessionId, cruiseOn) : []
    const latest = sessionId !== undefined ? latestCommentView(task, sessionId, cruiseOn) : undefined
    return (
      <SessionRow
        state={session.state}
        chip={{
          kind: stateToChipKind(session.state),
          label: t(sessionStateKey(session.state, session.waitingKind)),
          spinner: isActive,
        }}
        leading={
          <span className={css.sessionRowLeading} title={row.title}>
            <span className={css.sessionRowName}>{row.title}</span>
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
            {latest !== undefined && (
              <span className={css.executionComments} title={latest.text}>
                <span className={css.executionCommentsCount}>{t('detail.comments', { n: String(comments.length) })}</span>
                {/* The newest body when there IS one; a body-less round leaves
                    the slot to the row's state chip + time — never a state
                    word dressed up as content. */}
                {latest.text !== '' && (
                  <span className={css.executionCommentsLatest}>{t('detail.latestComment', { text: latest.text })}</span>
                )}
                <span className={css.executionCommentsTime}>{latest.at !== undefined ? formatTime(latest.at) : ''}</span>
              </span>
            )}
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
        unviewed={row.unviewed}
        unviewedTitle={t('detail.unviewedTitle')}
        handle={session.state === 'waiting' && sessionId !== undefined ? t('detail.handle') : undefined}
        sessionId={sessionId}
        onActivate={() => { onReviewExecution(execution) }}
        onOpenSession={() => { if (sessionId !== undefined) controller.openSession(sessionId) }}
        onHide={() => { controller.hideTaskSession(task.id, sessionId) }}
        hideTitle={t('detail.hideRow')}
      />
    )
  }
  const waiting = row.display.waitingKind
  const chip = waiting !== undefined
    ? { kind: 'warn' as const, label: t(`waiting.${waiting}` as 'waiting.approval'), spinner: true }
    : row.display.state === 'running'
      ? { kind: 'warn' as const, label: t('detail.result.running'), spinner: true }
      : row.display.state === 'succeeded'
        ? { kind: 'success' as const, label: t('detail.linkedDone') }
        : undefined
  // The SAME grammar as a run row: the session's activity window (its rounds
  // on this task — board runs and externally-observed turns alike) plus its
  // comment thread (count + newest body; the state chip is the row's own).
  const window = sessionWindowOf(task, sessionId)
  const comments = sessionId !== undefined ? sessionCommentsOf(task, sessionId, cruiseOn) : []
  const latest = sessionId !== undefined ? latestCommentView(task, sessionId, cruiseOn) : undefined
  return (
    <SessionRow
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
        window.startedAt !== undefined ? (
          <>
            {t('detail.executionStarted')} {formatDateTime(window.startedAt)}
            {' · '}
            {t('detail.executionEnded')} {window.endedAt !== undefined ? formatDateTime(window.endedAt) : '—'}
            {window.duration !== undefined && (
              <> · {t('detail.duration', { d: formatDuration(window.duration) })}</>
            )}
          </>
        ) : (
          <>
            {t('detail.sessionUpdated')} {formatDateTime(row.updatedAt)}
          </>
        )
      }
      footer={
        latest !== undefined && (
          <span className={css.executionComments} title={latest.text}>
            <span className={css.executionCommentsCount}>{t('detail.comments', { n: String(comments.length) })}</span>
            {/* The newest body when there IS one; a body-less round leaves
                the slot to the row's state chip + time — never a state word
                dressed up as content. */}
            {latest.text !== '' && (
              <span className={css.executionCommentsLatest}>{t('detail.latestComment', { text: latest.text })}</span>
            )}
            <span className={css.executionCommentsTime}>{latest.at !== undefined ? formatTime(latest.at) : ''}</span>
          </span>
        )
      }
      sessionId={sessionId}
      onActivate={() => { onOpenSessionPanel(sessionId) }}
      onOpenSession={() => { controller.openSession(sessionId) }}
      onHide={() => { controller.hideTaskSession(task.id, sessionId) }}
      hideTitle={t('detail.hideRow')}
    />
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

/** The automation module (task-level orchestration): one collapsed line = the
 *  live state; the expanded editor = 触发方式 (分段) + 当前模式的配置 + 按状态
 *  显隐的最小操作 (跳过本次 / 停止接续) — no save/cancel (即改即生效), and its
 *  boundary with the board-level 自动巡航 is one quiet line, not prose. */
function AutomationSection({ controller, task }: { controller: BoardController; task: TaskRecord }) {
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

  // Arming the rule expands the editor at once (the initial state already
  // keeps an armed rule expanded on open — "按过启用后下次打开自动展开").
  useEffect(() => {
    if (schedule?.enabled === true) setOpen(true)
  }, [task.id, schedule?.enabled])

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
  // Collapsed by default UNLESS the rule is already enabled: an armed
  // automation opens expanded, so its live state is immediately visible —
  // "按过启用后，下次打开必自动展开" (the user asked for exactly this).
  const [open, setOpen] = useState(() => schedule?.enabled === true)
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
    <Disclosure
      title={t('detail.schedule')}
      summary={summary}
      open={open}
      onToggle={() => { setOpen(!open) }}
    >
      <Switch
        checked={enabled}
        onChange={toggleEnabled}
        label={t('detail.schedule.enable')}
      />

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
    </Disclosure>
  )
}

/** Whether a preset id belongs to the built-in defaults. */
function presetIsDefault(preset: SchedulePreset): boolean {
  return DEFAULT_PRESETS.some(candidate => candidate.id === preset.id)
}

/** Task detail overlay. */
export function TaskDetail({ controller, task, workspaceTitleOf, dragSourceRef }: {
  controller: BoardController
  task: TaskRecord
  /** Resolve a workspace id to its display title (raw id when unknown). */
  workspaceTitleOf: (workspaceId: string) => string
  /** The board's card-drag latch (set synchronously at card dragstart), so the
   *  session-area drop zone can tell a sidebar drag from the board's own card
   *  drags (both advertise `text/plain`). */
  dragSourceRef: { readonly current: boolean }
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  // Red-flag per-session removal (hidden-tray only): the session's rounds
  // and hide history are permanently removed after confirmation.
  const [confirmRemoveSession, setConfirmRemoveSession] = useState<string | undefined>(undefined)
  // Edit-mode draft; undefined = not editing. Kept separate from `current`
  // so live record updates (e.g. an execution settling) never clobber it.
  const [draft, setDraft] = useState<TaskDraft | undefined>(undefined)
  const [editError, setEditError] = useState<string | undefined>(undefined)
  // True while the current edit was restored from the persisted draft store:
  // the user switched away mid-edit and came back to their own text — a quiet
  // inline note says so instead of silently surprising them.
  const [draftRestored, setDraftRestored] = useState(false)
  // Whether the run-config disclosure is expanded (collapsed by default: the
  // detail stays quiet, one summary line "默认设置 / 已自定义 N 项" is enough).
  const [configOpen, setConfigOpen] = useState(false)
  // The execution row whose review page is open (undefined = none).
  const [reviewExecution, setReviewExecution] = useState<ExecutionRecord | undefined>(undefined)
  // The linked session whose detail panel is open (undefined = none).
  const [linkedSession, setLinkedSession] = useState<string | undefined>(undefined)

  // Keep the overlay in sync if the task record changes underneath.
  const [latest, setLatest] = useState(task)
  useEffect(() => { setLatest(task) }, [task])
  const current = latest
  // The task's related sessions for every composer's @ mention (edit form,
  // review/refine surfaces share the same picker grammar).
  const mentions = controller.sessionLabelsOf(current.id).map(({ sessionId, title }) => ({ id: sessionId, title }))

  // Unsaved-edit draft memory: switching to a task restores its stored draft
  // (auto-entering edit mode), so half-typed edits survive switching away and
  // coming back. Saved or explicitly discarded drafts are cleared, so only
  // truly unfinished text returns.
  useEffect(() => {
    setDraft(undefined)
    setEditError(undefined)
    setDraftRestored(false)
    const stored = draftStore.get(editDraftKey(task.id))
    if (stored !== undefined) {
      try {
        setDraft(JSON.parse(stored) as TaskDraft)
        setDraftRestored(true)
      } catch {
        draftStore.clear(editDraftKey(task.id))
      }
    }
  }, [task.id])

  // A card is busy while its latest run is still open AND the task is
  // running (hasOpenRun): a scheduled batch keeps the card 'running'
  // between runs, so `running` alone must not disable the button; a pending
  // comment round (task not running) must never disable it either.
  const busy = hasOpenRun(current)

  // Run-config summary for the collapsed disclosure (单来源:重算于每次渲染).
  const customizedCount = [
    current.workspaceId, current.agentPreset, current.provider, current.model,
    current.reasoningEffort, current.permission,
  ].filter(value => value !== undefined && value !== '').length
  const configSummary = customizedCount === 0
    ? t('detail.runConfigDefault')
    : t('detail.runConfigCustom', { n: String(customizedCount) })

  // The unified session list (run + linked, de-duplicated by session id):
  // the single source for the 会话 section — a session reached from an
  // execution page or a linked panel is one row here, one comment thread.
  const sessions = controller.sessionsOf(current)
  // The hidden sessions (unified set), for the per-session restore tray.
  const hiddenIds = hiddenSessionIdsOf(current)

  // Session-area bind drop zone: dragging a sidebar session/workspace onto
  // the open task's 会话 area binds (or rebinds) the task's live source —
  // complement of the board-level "drop onto a column = new bound card".
  // Latched on dragenter like the board root: dragover cannot read the
  // payload (protected store), and the board's own card drags (also
  // `text/plain`) are excluded via the shared dragSourceRef.
  const [bindDropActive, setBindDropActive] = useState(false)
  const bindDropLatch = useRef(false)
  // One-shot confirm flash after a successful bind drop.
  const [bindDropFlash, setBindDropFlash] = useState(false)
  const bindDropTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Window-level safety net (same contract as the board root): a drag ending
  // outside the zone — on the sidebar, outside the window, or cancelled —
  // must clear the latch so no ring can survive the gesture.
  useEffect(() => {
    const clear = (): void => {
      bindDropLatch.current = false
      setBindDropActive(false)
    }
    window.addEventListener('drop', clear)
    window.addEventListener('dragend', clear)
    return () => {
      window.removeEventListener('drop', clear)
      window.removeEventListener('dragend', clear)
      if (bindDropTimer.current !== undefined) clearTimeout(bindDropTimer.current)
    }
    // The handlers read only stable refs/setters; a mount-time instance works.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Latch an external sidebar drag once, on entry into the zone. */
  const onZoneDragEnter = (event: React.DragEvent): void => {
    if (!dragSourceRef.current && candidateExternalDrag(Array.from(event.dataTransfer.types))) {
      bindDropLatch.current = true
      setBindDropActive(true)
    }
  }

  /** Allow the drop only for a latched external drag. */
  const onZoneDragOver = (event: React.DragEvent): void => {
    if (bindDropLatch.current) event.preventDefault()
  }

  /** A sidebar session/workspace dropped on the zone ADDS the live source to
   *  this task (an already-bound source is an idempotent no-op — never a
   *  replace); board card drags resolve to undefined and are left untouched.
   *  Every drop ends by clearing the latch. */
  const onZoneDrop = (event: React.DragEvent): void => {
    bindDropLatch.current = false
    setBindDropActive(false)
    const external = externalDragOf(
      event.dataTransfer,
      id => controller.getSnapshot().tasks.some(task => task.id === id),
      id => controller.externalKindOf(id),
    )
    if (external === undefined) return
    event.preventDefault()
    event.stopPropagation()
    const bind = external.kind === 'session'
      ? { kind: 'session' as const, sessionId: external.id }
      : { kind: 'workspace' as const, workspaceId: external.id }
    controller.addTaskSource(current.id, bind)
    setBindDropFlash(true)
    if (bindDropTimer.current !== undefined) clearTimeout(bindDropTimer.current)
    bindDropTimer.current = setTimeout(() => { setBindDropFlash(false) }, 600)
  }

  // Copy-prompt inline feedback (近处反馈，位于滚动区内).
  const [promptCopied, setPromptCopied] = useState(false)

  const editing = draft !== undefined

  /** Enter edit mode with a draft of the current record. */
  const startEditing = (): void => {
    setDraft(draftFromTask(current))
    setEditError(undefined)
    setDraftRestored(false)
  }

  /** New-task copy of this task ("复制为模板"): fresh card, same content, run
   *  config AND automation rule, landing in 待规划; runs/links are not
   *  copied (controller.copyTask). */
  const duplicateTask = (): void => {
    const copy = controller.copyTask(current.id)
    if (copy !== undefined) controller.closeTask()
  }

  /** Copy the execution prompt to the clipboard (best-effort; no throw). */
  const copyPrompt = (): void => {
    if (current.prompt === '') return
    void navigator.clipboard?.writeText(current.prompt).then(() => {
      setPromptCopied(true)
      window.setTimeout(() => { setPromptCopied(false) }, 1500)
    }).catch(() => { /* clipboard unavailable — select manually */ })
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
    setDraftRestored(false)
    draftStore.clear(editDraftKey(current.id))
  }

  /** Discard the draft and leave edit mode (explicit discard clears too). */
  const cancelEdit = (): void => {
    setDraft(undefined)
    setEditError(undefined)
    setDraftRestored(false)
    draftStore.clear(editDraftKey(current.id))
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
              <TaskForm
                draft={draft}
                onChange={next => {
                  setDraft(next)
                  // Draft memory: every keystroke is written through so
                  // switching away keeps the half-typed edit.
                  draftStore.set(editDraftKey(current.id), JSON.stringify(next))
                }}
                controller={controller}
                mentions={mentions}
              />
              {editError !== undefined && <p className={css.formError}>{editError}</p>}
              {draftRestored && <p className={css.detailHint}>{t('detail.editDraftRestored')}</p>}
            </>
          ) : (
            <>
              <Section title={t('detail.description')}>
                <div className={css.contentBlock}>{current.description !== '' ? current.description : '—'}</div>
              </Section>

              <Section title={t('detail.prompt')}>
                {/* An empty run prompt is nothing — the same em dash as the
                    description. It never shows the title as if it were a
                    prompt (the title only serves as the execution fallback).
                    The copy action floats INSIDE the block's top-right
                    corner (hover/focus revealed, check-mark feedback), so it
                    reads as part of the block instead of a loose row below. */}
                <div className={css.promptBlock}>
                  <pre className={css.promptBlockText}>{current.prompt !== '' ? current.prompt : '—'}</pre>
                  {current.prompt !== '' && (
                    <button
                      type="button"
                      className={css.promptCopy}
                      title={promptCopied ? t('detail.copied') : t('detail.copyPrompt')}
                      aria-label={t('detail.copyPrompt')}
                      onClick={copyPrompt}
                    >
                      <Icon name={promptCopied ? 'check' : 'copy'} />
                    </button>
                  )}
                </div>
              </Section>

              <Disclosure
                title={t('detail.runConfig')}
                summary={configSummary}
                open={configOpen}
                onToggle={() => { setConfigOpen(!configOpen) }}
              >
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
              </Disclosure>
            </>
          )}

          <AutomationSection controller={controller} task={current} />

          {/* 会话：任务的全部真实会话（板内执行 + 链接外部）按 sessionId 去重后
              显示在一个列表里——同一会话绝不出现两次，从执行页或链接面板进入
              同一会话看到的是同一条评论线程。行文法统一（SessionRow）。
              本区同时是绑定落点：把侧栏的会话/工作区拖进来 = 绑定（或换绑）到
              当前任务（与「拖到列上 = 新建绑定卡」互补）。 */}
          <Section title={`${t('detail.sessions')} ${sessions.length}`}>
            <div
              className={css.sessionDropZone}
              data-bindactive={bindDropActive ? '' : undefined}
              data-flash={bindDropFlash ? '' : undefined}
              onDragEnter={onZoneDragEnter}
              onDragOver={onZoneDragOver}
              onDrop={onZoneDrop}
            >
              <p className={css.detailHint}>{t('detail.executionHint')}</p>
              {sessions.length === 0 ? (
                <p className={css.detailText}>
                  {plainRunsOf(current).length > 0
                    ? t('detail.executionHiddenAll')
                    : taskBindsOf(current).length > 0
                      ? t('detail.noExecutionLinked')
                      : t('detail.noExecution')}
                </p>
              ) : (
                <ul className={css.sessionList}>
                  {sessions.map(row => (
                    <SessionActionRow
                      key={row.sessionId}
                      row={row}
                      task={current}
                      controller={controller}
                      cruiseOn={controller.getSnapshot().cruise.enabled}
                      onReviewExecution={execution => { setReviewExecution(execution) }}
                      onOpenSessionPanel={sessionId => { setLinkedSession(sessionId) }}
                    />
                  ))}
                </ul>
              )}
              {/* 隐藏托盘：逐条恢复（不逼用户一次全恢复），头部一条「恢复全部」。
                  行名取原生会话标题，会话已消失时回退到 sessionId。 */}
              {hiddenIds.size > 0 && (
                <div className={css.hiddenTray}>
                  <div className={css.hiddenTrayHead}>
                    <span className={css.hiddenTrayTitle}>
                      {t('detail.hiddenTrayTitle', { n: String(hiddenIds.size) })}
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => { controller.unhideTaskSessions(current.id) }}>
                      {t('detail.restoreHidden')}
                    </Button>
                  </div>
                  <ul className={css.hiddenTrayList}>
                    {Array.from(hiddenIds).map(sessionId => (
                      <li key={sessionId} className={css.hiddenTrayRow}>
                        <span className={css.hiddenTrayName} title={sessionId}>
                          {controller.sessionTitle(sessionId) ?? sessionId}
                        </span>
                        <Button size="sm" variant="ghost" onClick={() => { controller.unhideTaskSession(current.id, sessionId) }}>
                          {t('detail.restoreOne')}
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => { setConfirmRemoveSession(sessionId) }}>
                          {t('detail.delete')}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
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
          <Button title={t('detail.duplicateTitle')} onClick={duplicateTask}>
            {t('detail.duplicate')}
          </Button>
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
      {confirmRemoveSession !== undefined && (
        <ConfirmDialog
          title={t('detail.sessionRemoveTitle', { name: controller.sessionTitle(confirmRemoveSession) ?? confirmRemoveSession })}
          message={t('detail.sessionRemoveConfirm')}
          confirmLabel={t('detail.sessionRemoveOk')}
          danger
          onCancel={() => { setConfirmRemoveSession(undefined) }}
          onConfirm={() => {
            controller.removeTaskSession(current.id, confirmRemoveSession)
            setConfirmRemoveSession(undefined)
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