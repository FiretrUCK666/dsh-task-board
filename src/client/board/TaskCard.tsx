/**
 * Task card: the board's column item. Clicking opens the task detail — it
 * never executes anything directly (detail holds the Run button). Cards are
 * draggable onto other columns; the drop semantics are decided by the board
 * through resolveCardDrop.
 */
import { useState, type CSSProperties } from 'react'
import type { PendingInteractionKind } from '../../core/controller.ts'
import type { Tag } from '../../core/tags.ts'
import type { TaskRecord } from '../../core/tasks.ts'
import { hasOpenRun, pendingCommentCount, plainRunsOf, refining, ruleReadiness } from '../../core/tasks.ts'
import { isEnglish, t } from '../locales.ts'
import css from '../board.module.css'
import { STATUS_KEY } from './status.ts'
import { Chip } from './Chip.tsx'
import { Icon } from './ui.tsx'

/** Compact relative/absolute time label. */
export function formatTime(ms: number): string {
  const date = new Date(ms)
  const now = Date.now()
  const minutes = Math.floor((now - ms) / 60000)
  if (minutes < 1) return t('time.justNow')
  if (minutes < 60) return `${minutes}m`
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Exact local time label: `YYYY-MM-DD HH:mm:ss`. */
export function formatDateTime(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** Tooltip for the schedule chip: honest about the rule's readiness —
 *  automation is active as soon as it is armed (no manual-first gate):
 *  chain reports its run budget, cron its next due instant, paused its
 *  blocking status. */
function scheduleChipTitle(task: TaskRecord): string {
  const schedule = task.schedule
  if (schedule === undefined || !schedule.enabled) return t('card.scheduled')
  if (schedule.mode === 'chain') {
    return `${t('detail.schedule.mode.chain')} · ${t('detail.schedule.runsSoFar')} ${schedule.runCount}`
  }
  if (ruleReadiness(task).kind === 'active' && schedule.nextRunAt !== undefined) {
    return `${t('card.scheduled')} · ${t('detail.schedule.nextRun')} ${new Date(schedule.nextRunAt).toLocaleString()}`
  }
  return `${t('card.scheduled')} · ${t('detail.schedule.paused')} (${t(STATUS_KEY[task.status])})`
}

/** Human duration label (zh: `X 分 Y 秒`; en: `Xm Ys`). */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return isEnglish() ? `${hours}h ${minutes}m` : `${hours} 小时 ${minutes} 分`
  if (minutes > 0) {
    return isEnglish()
      ? seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
      : seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`
  }
  return isEnglish() ? `${seconds}s` : `${seconds} 秒`
}

/** The open run's state text: either working ("进行中") or blocked on the
 *  user ("等待回应 · 计划确认"). Pure so the chip composition is testable. */
export function runningStateLabel(waiting: PendingInteractionKind | undefined): string {
  return waiting !== undefined
    ? `${t('card.waiting')} · ${t(`waiting.${waiting}` as 'waiting.approval')}`
    : t('detail.result.running')
}

/** The run-sequence label: "第 N 次执行" / "Run N". */
export function executionNoLabel(runs: number): string {
  return t('detail.executionNo', { n: String(runs) })
}

/** The settled-run count label: "N 次执行" / "N runs". */
export function settledChipLabel(runs: number): string {
  return `${runs} ${t('board.runs')}`
}

/** One card in a column. */
export function TaskCard({ task, tags, selected, workspaceTitleOf, waiting, pendingCount, pendingTitle, unviewed, unviewedCount, onClick, onQuickRun, onTagClick }: {
  task: TaskRecord
  /** The resolved tag rows this card carries (catalog lookup done by the board). */
  tags: readonly Tag[]
  /** Whether the card is picked in the board's organize (tidy) mode. */
  selected?: boolean
  /** Resolve a workspace id to its display title (raw id when unknown). */
  workspaceTitleOf: (workspaceId: string) => string
  /** The open run's session is blocked on the user (approval / plan review / question). */
  waiting?: PendingInteractionKind
  /** How many sessions of this task are waiting on the user (executions + refine). */
  pendingCount: number
  /** Tooltip detail listing which execution/session waits on what. */
  pendingTitle: string
  /** Whether the task has content (settled run / comment / refine) newer than its last open. */
  unviewed: boolean
  /** How many plain-run executions are unviewed (the "新 N" badge figure). */
  unviewedCount: number
  onClick: () => void
  /** Optional hover quick-action: run the task right from the card (rerun
   *  semantics, same run guard; disabled while a run is open). */
  onQuickRun?: () => void
  /** Clicking a card's tag chip filters the board to that tag. */
  onTagClick?: (tagId: string) => void
}) {
  const [dragging, setDragging] = useState(false)
  const latest = task.executions[task.executions.length - 1]
  // Plain-run count (comment continuation rounds are not executions): the
  // single numbering source shared with the detail list and review badge.
  const runs = plainRunsOf(task).length
  const lastPlain = plainRunsOf(task)[plainRunsOf(task).length - 1]
  // Only a genuinely open run shows the in-progress indicator: the card's
  // status must be 'running' AND its latest round unsettled. A pending
  // comment round (task sitting in review) must never spin.
  const running = hasOpenRun(task)
  // Comments saved but not yet injected (the task's queue): a quiet warn
  // badge so a card waiting for the dispatcher is never mistaken for idle.
  const queuedComments = pendingCommentCount(task)
  const workspaceLabel = task.workspaceId !== undefined
    ? workspaceTitleOf(task.workspaceId)
    : t('card.workspaceDefault')
  // Automation paused because the latest plain run failed (the "failure
  // pauses the rule" signal), vs. a review pause for a successful run.
  const readiness = ruleReadiness(task)
  const pausedFailed = readiness.kind === 'paused' && readiness.status === 'review'
    && lastPlain !== undefined && lastPlain.result === 'failed'
  return (
    <button
      type="button"
      className={`${css.card}${dragging ? ` ${css.dragging}` : ''}${selected ? ` ${css.selectedCard}` : ''}`}
      style={task.color !== undefined ? ({ '--card-tint': task.color } as CSSProperties) : undefined}
      data-status={task.status}
      data-task-id={task.id}
      data-unviewed={unviewed ? '' : undefined}
      draggable
      onClick={onClick}
      title={task.description !== '' ? task.description : task.title}
      onDragStart={event => {
        setDragging(true)
        event.dataTransfer.setData('text/plain', task.id)
        event.dataTransfer.effectAllowed = 'move'
        // Anchor the drag image on the pointer's center, so the ghost's
        // visual position always matches the pointer — the insertion
        // decision is made from the pointer, never from an offset ghost.
        const element = event.currentTarget
        event.dataTransfer.setDragImage(element, element.offsetWidth / 2, element.offsetHeight / 2)
      }}
      onDragEnd={() => { setDragging(false) }}
    >
      {onQuickRun !== undefined && (
        <span
          className={css.cardQuickRun}
          role="button"
          tabIndex={running ? -1 : 0}
          title={t('card.quickRun')}
          aria-disabled={running ? true : undefined}
          onClick={event => {
            if (running) return
            event.stopPropagation()
            onQuickRun()
          }}
          onKeyDown={event => {
            if (running) return
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              event.stopPropagation()
              onQuickRun()
            }
          }}
        >
          <Icon name="play" />
        </span>
      )}
      <span className={css.cardTitle}>{task.title}</span>
      {/* The card's labels: small colored-dot chips (capped with a +N tail so
          a long set can never crowd the card), clicking one filters the board
          to that tag. */}
      {tags.length > 0 && (
        <span className={css.cardTags}>
          {tags.slice(0, 3).map(tag => (
            <span
              key={tag.id}
              role="button"
              tabIndex={0}
              className={css.cardTag}
              title={tag.name}
              onClick={event => { event.stopPropagation(); onTagClick?.(tag.id) }}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  event.stopPropagation()
                  onTagClick?.(tag.id)
                }
              }}
            >
              <span className={css.cardTagDot} style={{ background: tag.color }} aria-hidden="true" />
              {tag.name}
            </span>
          ))}
          {tags.length > 3 && (
            <span className={css.cardTagMore} title={tags.slice(3).map(tag => tag.name).join('、')}>+{tags.length - 3}</span>
          )}
        </span>
      )}
      {task.description !== '' && <span className={css.cardExcerpt}>{task.description}</span>}
      <span className={css.cardMeta}>
        {/* Row 1 is identical on every card: workspace + last activity. */}
        <span className={css.cardMetaRow}>
          <span
            className={css.cardWorkspace}
            title={task.workspaceId ?? t('card.workspaceDefault')}
          >
            <span className={css.cardWorkspaceDot} aria-hidden="true" />
            <span className={css.cardWorkspaceName}>{workspaceLabel}</span>
          </span>
          <span className={css.cardTime} title={formatDateTime(task.updatedAt)}>
            {t('board.updated')} {formatTime(task.updatedAt)}
          </span>
        </span>
        {/* Row 2 only when there are badges; plain text badges keep the
            left edge flush with the title above, and wrap instead of
            overflowing. */}
        {(task.schedule?.enabled === true || latest !== undefined) && (
          <span className={css.cardBadges}>
            {task.schedule?.enabled === true && (
              <Chip
                fill={false}
                title={scheduleChipTitle(task)}
              >
                {task.schedule.mode === 'chain' ? t('card.chain') : t('card.scheduled')}
              </Chip>
            )}
            {task.schedule?.enabled === true && task.schedule.maxRuns !== undefined && (
              <Chip kind="muted" fill={false} title={t('card.batchProgress')}>
                {task.schedule.runCount}/{task.schedule.maxRuns}
              </Chip>
            )}
            {/* A live chain keeps the card in progress: the "接续中" chip
                names the automation mode behind the running state. */}
            {task.schedule?.enabled === true && task.schedule.mode === 'chain' && task.status === 'running' && (
              <Chip kind="warn" fill={false} title={t('card.chainingTitle')}>
                {t('card.chaining')}
              </Chip>
            )}
            {/* Automation paused by a failed run: the review column reads
                "failure stopped the rule" at a glance, distinct from "success
                awaiting confirmation". */}
            {pausedFailed && (
              <Chip kind="error" fill={false} title={t('card.autoPausedFailedTitle')}>
                {t('card.autoPausedFailed')}
              </Chip>
            )}
            {queuedComments > 0 && (
              <Chip
                kind="warn"
                fill={false}
                title={task.status === 'done'
                  ? t('card.commentQueueDone', { n: String(queuedComments) })
                  : t('card.commentQueueTitle', { n: String(queuedComments) })}
              >
                {t('card.commentQueue')} {queuedComments}
              </Chip>
            )}
            {unviewed && (
              <Chip kind="warn" fill={false} title={t('card.newContentTitle')}>
                {t('card.newContent')}{unviewedCount > 0 ? ` ${unviewedCount}` : ''}
              </Chip>
            )}
            {refining(task) && (
              <Chip kind="warn" fill={false} title={t('card.refiningTitle')}>
                {t('card.refining')}
              </Chip>
            )}
            {pendingCount > 0 && (
              <Chip kind="warn" fill={false} title={pendingTitle}>
                {t('card.pending')} {pendingCount}
              </Chip>
            )}
            {running ? (
              /* The open run renders as two short chips instead of one long
                 one: state (spinner + "进行中"/waiting) and the run
                 sequence ("第 N 次执行") separately, so each stays short and
                 both fall under the shared chip truncation — the sequence
                 keeps the best chance of rendering whole, and the chip's own
                 title always resurfaces the full label on hover. */
              <>
                <Chip kind="warn" fill={false} title={waiting !== undefined
                  ? t('card.waitingTitle', { kind: t(`waiting.${waiting}` as 'waiting.approval') })
                  : undefined}
                  icon={<span className={css.spinner} aria-hidden="true" />}>
                  {runningStateLabel(waiting)}
                </Chip>
                <Chip kind="warn" fill={false} title={executionNoLabel(runs)}>
                  {executionNoLabel(runs)}
                </Chip>
              </>
            ) : latest !== undefined && (
              <Chip
                kind={latest.result === 'failed' ? 'error' : latest.result === 'succeeded' ? 'success' : 'muted'}
                fill={false}
              >
                {settledChipLabel(runs)}
              </Chip>
            )}
          </span>
        )}
      </span>
    </button>
  )
}
