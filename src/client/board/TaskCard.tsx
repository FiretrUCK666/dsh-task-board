/**
 * Task card: the board's column item. Clicking opens the task detail — it
 * never executes anything directly (detail holds the Run button). Cards are
 * draggable onto other columns; the drop semantics are decided by the board
 * through resolveCardDrop.
 */
import { useState } from 'react'
import type { TaskRecord } from '../../core/tasks.ts'
import { executionLabel, ruleReadiness } from '../../core/tasks.ts'
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
export function TaskCard({ task, workspaceTitleOf, onClick, dropBefore = false }: {
  task: TaskRecord
  /** Resolve a workspace id to its display title (raw id when unknown). */
  workspaceTitleOf: (workspaceId: string) => string
  onClick: () => void
  /** Whether an active same-column drag targets this card as its "insert before" anchor. */
  dropBefore?: boolean
}) {
  const [dragging, setDragging] = useState(false)
  const latest = task.executions[task.executions.length - 1]
  const runs = task.executions.length
  // The card is genuinely executing while its latest run is still open; a
  // scheduled batch keeps the card 'running' between runs (latest settled),
  // so only an open execution shows the in-progress indicator.
  const running = latest !== undefined && executionLabel(latest) === 'running'
  const workspaceLabel = task.workspaceId !== undefined
    ? workspaceTitleOf(task.workspaceId)
    : t('card.workspaceDefault')
  return (
    <button
      type="button"
      className={`${css.card}${dragging ? ` ${css.dragging}` : ''}`}
      data-status={task.status}
      data-task-id={task.id}
      data-drop-before={dropBefore ? '' : undefined}
      draggable
      onClick={onClick}
      title={task.description !== '' ? task.description : task.title}
      onDragStart={event => {
        setDragging(true)
        event.dataTransfer.setData('text/plain', task.id)
        event.dataTransfer.effectAllowed = 'move'
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
            {running ? (
              <Chip kind="warn" fill={false}>
                <span className={css.spinner} aria-hidden="true" />
                {t('detail.result.running')} · {t('detail.executionNo', { n: String(runs) })}
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
