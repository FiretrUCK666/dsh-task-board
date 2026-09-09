/**
 * Board activity feed: the recent notable moments of every task in one
 * read-only list (creations, settlements, comments, refine completions —
 * newest first, capped). DERIVED from the snapshot on every render, never
 * stored: a journal would be new synced state (merge grammar, migration),
 * while the moments themselves already live in the ledger (createdAt,
 * endedAt, comment bodies). Clicking a row opens the task detail — the feed
 * owns no surface of its own.
 *
 * Pure and framework-free so the derivation unit-tests in isolation.
 */
import type { TaskRecord } from '../../core/tasks.ts'

/** Cap: the feed is a glance, not an archive (older moments live on cards). */
export const ACTIVITY_LIMIT = 30

/** One feed row: what happened, where, when. */
export interface ActivityItem {
  /** Stable row key (task + moment). */
  key: string
  taskId: string
  taskTitle: string
  kind: 'created' | 'settled' | 'comment' | 'refined'
  /** Settled outcome (only for `settled`). */
  result?: 'succeeded' | 'failed' | 'cancelled'
  /** Comment/refine text excerpt source (only for `comment`/`refined`). */
  text?: string
  at: number
}

/**
 * Collect every notable moment of every task, newest first. A round that is
 * still running is not a moment yet (its settlement will be); an empty
 * comment round carries no text and reads as noise, so it is skipped.
 */
export function activityOf(tasks: readonly TaskRecord[]): ActivityItem[] {
  const items: ActivityItem[] = []
  for (const task of tasks) {
    items.push({
      key: `${task.id}|created`,
      taskId: task.id,
      taskTitle: task.title,
      kind: 'created',
      at: task.createdAt,
    })
    for (const round of task.executions) {
      if (round.endedAt === undefined) continue
      if (round.comment !== undefined) {
        if (round.comment.trim() === '') continue
        items.push({
          key: `${task.id}|${round.id}`,
          taskId: task.id,
          taskTitle: task.title,
          kind: 'comment',
          text: round.comment,
          at: round.endedAt,
        })
        continue
      }
      if (round.refine === true) {
        items.push({
          key: `${task.id}|${round.id}`,
          taskId: task.id,
          taskTitle: task.title,
          kind: 'refined',
          at: round.endedAt,
        })
        continue
      }
      items.push({
        key: `${task.id}|${round.id}`,
        taskId: task.id,
        taskTitle: task.title,
        kind: 'settled',
        result: round.result,
        at: round.endedAt,
      })
    }
  }
  return items
    .sort((a, b) => b.at - a.at)
    .slice(0, ACTIVITY_LIMIT)
}
