/**
 * Task card: the board's column item. Clicking opens the task detail — it
 * never executes anything directly (detail holds the Run button). Cards are
 * draggable onto other columns; the drop semantics are decided by the board
 * through resolveCardDrop.
 */
import { useState } from 'react'
import type { PendingInteractionKind } from '../../core/controller.ts'
import type { TaskRecord } from '../../core/tasks.ts'
import { hasOpenRun, pendingCommentCount, refining, ruleReadiness } from '../../core/tasks.ts'
import { isEnglish, t } from '../locales.ts'
import css from '../board.module.css'
import { STATUS_KEY } from './status.ts'
import { Chip } from './Chip.tsx'

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

/** Tooltip for the schedule chip: honest about the rule's readiness. */
function scheduleChipTitle(task: TaskRecord): string {
  const readiness = ruleReadiness(task)
  if (readiness.kind === 'active' && task.schedule?.nextRunAt !== undefined) {
    return `${t('card.scheduled')} · ${t('detail.schedule.nextRun')} ${new Date(task.schedule.nextRunAt).toLocaleString()}`
  }
  if (readiness.kind === 'paused') {
    return `${t('card.scheduled')} · ${t('detail.schedule.paused')} (${t(STATUS_KEY[task.status])})`
  }
  return `${t('card.scheduled')} · ${t('detail.schedule.standby')}`
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

/** One card in a column. */
export function TaskCard({ task, workspaceTitleOf, waiting, pendingCount, pendingTitle, onClick }: {
  task: TaskRecord
  /** Resolve a workspace id to its display title (raw id when unknown). */
  workspaceTitleOf: (workspaceId: string) => string
  /** The open run's session is blocked on the user (approval / plan review / question). */
  waiting?: PendingInteractionKind
  /** How many sessions of this task are waiting on the user (executions + refine). */
  pendingCount: number
  /** Tooltip detail listing which execution/session waits on what. */
  pendingTitle: string
  onClick: () => void
}) {
  const [dragging, setDragging] = useState(false)
  const latest = task.executions[task.executions.length - 1]
  const runs = task.executions.length
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
  return (
    <button
      type="button"
      className={`${css.card}${dragging ? ` ${css.dragging}` : ''}`}
      data-status={task.status}
      data-task-id={task.id}
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
      <span className={css.cardTitle}>{task.title}</span>
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
                {t('card.scheduled')}
              </Chip>
            )}
            {task.schedule?.enabled === true && task.schedule.maxRuns !== undefined && (
              <Chip kind="muted" fill={false} title={t('card.batchProgress')}>
                {task.schedule.runCount}/{task.schedule.maxRuns}
              </Chip>
            )}
            {queuedComments > 0 && (
              <Chip kind="warn" fill={false} title={t('card.commentQueueTitle', { n: String(queuedComments) })}>
                {t('card.commentQueue')} {queuedComments}
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
              <Chip kind="warn" fill={false} title={waiting !== undefined
                ? t('card.waitingTitle', { kind: t(`waiting.${waiting}` as 'waiting.approval') })
                : undefined}>
                <span className={css.spinner} aria-hidden="true" />
                {waiting !== undefined ? `${t('card.waiting')} · ${t(`waiting.${waiting}` as 'waiting.approval')}` : t('detail.result.running')} · {t('detail.executionNo', { n: String(runs) })}
              </Chip>
            ) : latest !== undefined && (
              <Chip
                kind={latest.result === 'failed' ? 'error' : latest.result === 'succeeded' ? 'success' : 'muted'}
                fill={false}
              >
                {runs} {t('board.runs')}
              </Chip>
            )}
          </span>
        )}
      </span>
    </button>
  )
}
