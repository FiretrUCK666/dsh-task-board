/**
 * Task detail: the full view of one task — content, prompt, execution
 * history — and the only place execution can be triggered. Also offers
 * delete (with confirmation), manual status moves, and a jump to the
 * execution's session transcript.
 */
import { useEffect, useState } from 'react'
import type { BoardController } from '../../core/controller.ts'
import { DEFAULT_PRESETS, LocalStoragePresetStore, type SchedulePreset } from '../../core/presets.ts'
import { describeCron, isValidCron } from '../../core/schedule.ts'
import { MANUAL_STATUSES, hasOpenRun, plainRunsOf, ruleReadiness, type ExecutionRecord, type ScheduleMode, type TaskRecord, type TaskStatus } from '../../core/tasks.ts'
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
import { STATUS_KEY } from './status.ts'
import { commentsOf, commentKindOf, commentStateKey, type CommentView } from './comment-thread.ts'

/** Execution outcome → locale key. */
const RESULT_KEY: Record<NonNullable<ExecutionRecord['result']>, TaskBoardKey> = {
  succeeded: 'detail.result.succeeded',
  failed: 'detail.result.failed',
  cancelled: 'detail.result.cancelled',
}

/** Status → shared-chip color (detail badge). */
const STATUS_CHIP: Record<TaskStatus, ChipKind> = {
  backlog: 'neutral',
  todo: 'neutral',
  running: 'warn',
  review: 'neutral',
  done: 'success',
}

/** Execution outcome → shared-chip color. */
function resultChipKind(result: ExecutionRecord['result']): ChipKind {
  if (result === 'failed') return 'error'
  if (result === 'succeeded') return 'success'
  if (result === 'cancelled') return 'muted'
  return 'warn'
}

/** Paused-readiness explanation keyed by the pausing status. */
function pausedLabelOf(status: 'backlog' | 'review' | 'done'): TaskBoardKey {
  if (status === 'review') return 'detail.schedule.paused.review'
  if (status === 'done') return 'detail.schedule.paused.done'
  return 'detail.schedule.paused.backlog'
}

/** One execution-history row: sequence, outcome, exact start/end times,
 *  plus the session's at-a-glance dynamics (its own latest comment with its
 *  state, and whether the session waits on the user). Clicking the row opens
 *  the review page (review the conversation and comment to continue it); the
 *  native "view session" jump stays on the row. Re-running is one action on
 *  the detail footer — it always starts a fresh round with the task's
 *  current prompt, so rows carry no rerun button (a row's "rerun" would be
 *  ambiguous next to comments). */
function ExecutionRow({ execution, index, dynamics, waitingKind, onReview, onOpen }: {
  execution: ExecutionRecord
  /** 1-based execution sequence (comment rounds are not part of the list). */
  index: number
  /** The execution's own comment rounds (oldest first; empty = no comments). */
  dynamics: readonly CommentView[]
  /** The session's pending-interaction kind when it waits on the user. */
  waitingKind: string | undefined
  onReview: () => void
  onOpen: (sessionId: string) => void
}) {
  const result = execution.result
  const running = result === undefined
  // The latest comment round: its text and live state, so the board reads
  // what the session was last told without opening the review page.
  const latest = dynamics.length > 0 ? dynamics[dynamics.length - 1] : undefined
  return (
    <li
      className={css.executionRow}
      data-result={result}
      onClick={onReview}
      role="button"
      tabIndex={0}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onReview() } }}
    >
      <div className={css.executionRowTop}>
        <span className={css.executionIndex}>{t('detail.executionNo', { n: String(index) })}</span>
        <Chip kind={resultChipKind(result)}>
          {running && <span className={css.spinner} aria-hidden="true" />}
          {running ? t('detail.result.running') : t(RESULT_KEY[result as NonNullable<ExecutionRecord['result']>])}
        </Chip>
        {execution.sessionId !== undefined && (
          <button
            type="button"
            className={css.executionOpen}
            onClick={event => { event.stopPropagation(); onOpen(execution.sessionId as string) }}
            title={execution.sessionId}
          >
            {t('detail.viewSession')} →
          </button>
        )}
      </div>
      <span className={css.executionTimes}>
        {t('detail.executionStarted')} {formatDateTime(execution.startedAt)}
        {' · '}
        {t('detail.executionEnded')} {execution.endedAt !== undefined ? formatDateTime(execution.endedAt) : '—'}
        {execution.endedAt !== undefined && (
          <> · {t('detail.duration', { d: formatDuration(execution.endedAt - execution.startedAt) })}</>
        )}
      </span>
      {latest !== undefined && (
        <span className={css.executionDynamics}>
          <span className={css.executionDynamicsLabel}>{t('detail.rowComment')}</span>
          <span className={css.executionDynamicsText} title={latest.round.comment}>{latest.round.comment}</span>
          <Chip kind={commentKindOf(latest.state)}>{t(commentStateKey(latest.state))}</Chip>
          {dynamics.length > 1 && (
            <span className={css.executionDynamicsCount}>{t('detail.rowCommentCount', { n: String(dynamics.length) })}</span>
          )}
        </span>
      )}
      {waitingKind !== undefined && (
        <span className={css.executionDynamics}>
          <Chip kind="warn" fill={false}>{t('review.waiting')}</Chip>
          <span className={css.executionDynamicsText}>{t(`waiting.${waitingKind}` as 'waiting.approval')}</span>
        </span>
      )}
      {execution.error !== undefined && execution.error !== '' && (
        <span className={css.executionError}>{execution.error}</span>
      )}
    </li>
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

  /** Arm/disarm the schedule (arming first persists the edited cron). */
  const toggleEnabled = (next: boolean): void => {
    const trimmed = cron.trim()
    if (next && mode === 'cron' && (trimmed === '' || !isValidCron(trimmed))) {
      setError(t('detail.schedule.invalid'))
      return
    }
    setError(undefined)
    if (next && mode === 'cron' && trimmed !== schedule?.cron) controller.setSchedule(task.id, { cron: trimmed })
    if (controller.setSchedule(task.id, { enabled: next, mode })) setEnabled(next)
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
  const nextLabel = !enabled || mode !== 'cron' || nextRunAt === undefined
    ? t('detail.schedule.notScheduled')
    : nextRunAt <= Date.now()
      ? t('detail.schedule.dueSoon')
      : new Date(nextRunAt).toLocaleString()
  const lastLabel = lastTriggeredAt === undefined ? '—' : new Date(lastTriggeredAt).toLocaleString()

  // Collapsed by default: the detail stays quiet, one summary line shows the
  // rule's state; expanding reveals the full editor.
  const [open, setOpen] = useState(false)
  const summary = !enabled
    ? t('detail.schedule.off')
    : mode === 'cron'
      ? `${t('detail.schedule.mode.cron')} · ${nextLabel}`
      : t('detail.schedule.mode.chain')

  return (
    <section className={css.detailSection}>
      <button
        type="button"
        className={css.scheduleDisclosure}
        aria-expanded={open}
        onClick={() => { setOpen(!open) }}
      >
        <span className={css.scheduleChevron} data-open={open} aria-hidden="true">▾</span>
        <span className={css.scheduleDisclosureTitle}>{t('detail.schedule')}</span>
        <span className={css.scheduleSummary}>{summary}</span>
      </button>
      {open && (
        <>
      <label className={css.scheduleToggle}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={event => { toggleEnabled(event.target.checked) }}
        />
        <span>{t('detail.schedule.enable')}</span>
      </label>

      {/* Driving mode: fixed times (cron) or run-after-completion (chain). */}
      <div className={css.scheduleModeRow} role="radiogroup" aria-label={t('detail.schedule')}>
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'cron'}
          className={`${css.scheduleMode}${mode === 'cron' ? ` ${css.scheduleModeActive}` : ''}`}
          title={t('detail.schedule.mode.cronHint')}
          onClick={() => { switchMode('cron') }}
        >
          {t('detail.schedule.mode.cron')}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'chain'}
          className={`${css.scheduleMode}${mode === 'chain' ? ` ${css.scheduleModeActive}` : ''}`}
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
            <button
              type="button"
              className={css.ghostButton}
              onClick={() => { setShowPresets(true) }}
            >
              {t('detail.schedule.managePresets')}
            </button>
          </span>
        </div>
      ) : (
        <>
          <p className={css.scheduleMeta}>{t('detail.schedule.chainNote')}</p>
          {readiness.kind === 'standby' && (
            <p className={css.scheduleMeta}>{t('detail.schedule.standby')}</p>
          )}
          {readiness.kind === 'paused' && (
            <p className={css.scheduleMeta}>
              {t(pausedLabelOf(readiness.status))}
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
          <p className={css.scheduleMeta}>
            {cronDescriptionLabel(cron)}
            {' · '}
            {readiness.kind === 'active'
              ? `${t('detail.schedule.nextRun')} ${nextLabel}`
              : readiness.kind === 'standby'
                ? t('detail.schedule.standby')
                : t('detail.schedule.paused')}
            {' · '}{t('detail.schedule.lastTriggered')} {lastLabel}
          </p>
          {readiness.kind === 'paused' && (
            <p className={css.scheduleMeta}>
              {t(pausedLabelOf(readiness.status))}
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

  // Keep the overlay in sync if the task record changes underneath.
  const [latest, setLatest] = useState(task)
  useEffect(() => { setLatest(task) }, [task])
  const current = latest

  // A card is busy while its latest run is still open AND the task is
  // running (hasOpenRun): a scheduled batch keeps the card 'running'
  // between runs, so `running` alone must not disable the button; a pending
  // comment round (task not running) must never disable it either.
  const busy = hasOpenRun(current)

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
            <button
              type="button"
              className={css.ghostButton}
              onClick={startEditing}
            >
              {t('detail.edit')}
            </button>
          )}
          <button
            type="button"
            className={css.iconButton}
            aria-label={t('detail.close')}
            onClick={() => { controller.closeTask() }}
          >
            ×
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
              <section className={css.detailSection}>
                <h4>{t('detail.description')}</h4>
                <div className={css.contentBlock}>{current.description !== '' ? current.description : '—'}</div>
              </section>

              <section className={css.detailSection}>
                <h4>{t('detail.prompt')}</h4>
                <pre className={css.promptBlock}>{current.prompt !== '' ? current.prompt : current.title}</pre>
              </section>

              <section className={css.detailSection}>
                <h4>{t('detail.runConfig')}</h4>
                <dl className={css.configGrid}>
                  <div className={css.configRow}>
                    <dt className={css.configLabel}>{t('new.workspace')}</dt>
                    <dd className={css.configValue}>
                      {current.workspaceId !== undefined
                        ? workspaceTitleOf(current.workspaceId)
                        : t('new.workspaceDefault')}
                    </dd>
                  </div>
                  {current.agentPreset !== undefined && (
                    <div className={css.configRow}>
                      <dt className={css.configLabel}>{t('new.agentPreset')}</dt>
                      <dd className={css.configValue}>{current.agentPreset}</dd>
                    </div>
                  )}
                  {current.provider !== undefined && current.model !== undefined && (
                    <div className={css.configRow}>
                      <dt className={css.configLabel}>{t('new.model')}</dt>
                      <dd className={css.configValue}>{current.provider} / {current.model}</dd>
                    </div>
                  )}
                  {current.reasoningEffort !== undefined && (
                    <div className={css.configRow}>
                      <dt className={css.configLabel}>{t('new.effort')}</dt>
                      <dd className={css.configValue}>{current.reasoningEffort}</dd>
                    </div>
                  )}
                  {current.permission !== undefined && (
                    <div className={css.configRow}>
                      <dt className={css.configLabel}>{t('new.permission')}</dt>
                      <dd className={css.configValue}>{permissionLabel(current.permission)}</dd>
                    </div>
                  )}
                </dl>
              </section>
            </>
          )}

          <ScheduleSection controller={controller} task={current} />

          {current.status === 'backlog' && (
            <RefineSection controller={controller} task={current} />
          )}

          <section className={css.detailSection}>
            <h4>{t('detail.execution')}</h4>
            <p className={css.detailHint}>{t('detail.executionHint')}</p>
            {(() => {
              // Comment continuation rounds are not part of the execution
              // history list — they live in the review page's comment thread.
              const runs = plainRunsOf(current)
              const cruiseOn = controller.getSnapshot().cruise.enabled
              if (runs.length === 0) return <p className={css.detailText}>{t('detail.noExecution')}</p>
              return (
                <ul className={css.executionList}>
                  {[...runs].reverse().map((execution, reversedIndex) => (
                    <ExecutionRow
                      key={execution.id}
                      execution={execution}
                      index={runs.length - reversedIndex}
                      dynamics={commentsOf(current, execution, cruiseOn)}
                      waitingKind={controller.pendingInteractionOf(execution.sessionId)}
                      onReview={() => { setReviewExecution(execution) }}
                      onOpen={sessionId => { controller.openSession(sessionId) }}
                    />
                  ))}
                </ul>
              )
            })()}
          </section>

          <section className={css.detailSection}>
            <h4>{t('board.status')}</h4>
            <div className={css.moveRow}>
              {MANUAL_STATUSES.map(status => (
                <button
                  key={status}
                  type="button"
                  className={css.ghostButton}
                  disabled={current.status === status || busy}
                  onClick={() => { controller.moveTask(current.id, status) }}
                >
                  {t(`status.move.${status}` as TaskBoardKey)}
                </button>
              ))}
            </div>
          </section>
        </div>

        <footer className={css.detailFooter}>
          {editing ? (
            <>
              <button
                type="button"
                className={css.primaryButton}
                onClick={saveEdit}
              >
                {t('detail.save')}
              </button>
              <button
                type="button"
                className={css.ghostButton}
                onClick={cancelEdit}
              >
                {t('detail.cancel')}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={css.primaryButton}
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
              </button>
            </>
          )}
          <button
            type="button"
            className={css.dangerButton}
            onClick={() => { setConfirmDelete(true) }}
          >
            {t('detail.delete')}
          </button>
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
    </div>
  )
}
