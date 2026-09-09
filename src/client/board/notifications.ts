/**
 * Notification center aggregation: every session across every task that is
 * currently waiting on the user (approval / plan-review / question) plus
 * unviewed review results (failed/succeeded awaiting the human gate) — one
 * row per waiting session / per review task, newest first. Read-only:
 * clicking a row opens the task detail (the detail owns sessions, answers
 * and navigation), so the center never duplicates a surface that already
 * exists.
 *
 * Pure and framework-free (the pending signal arrives as a callback), so the
 * aggregation unit-tests in isolation; TaskBoard supplies the live faces.
 * `notificationsOf` stays waiting-only (legacy callers/tests); the board
 * reads `notificationsExOf` for the full three-tier view.
 */
import { boardEventsOf } from '../../core/board-events.ts'
import type { PendingInteractionKind } from '../../core/controller.ts'
import { taskUnviewed } from '../../core/session-display.ts'
import { lastPlainResult, plainRunsOf, type TaskRecord } from '../../core/tasks.ts'

/** One notification row (waiting session or unviewed review task). */
export interface NotificationItem {
  taskId: string
  taskTitle: string
  sessionId: string
  sessionTitle: string
  /** Waiting kind (waiting rows only; review rows leave it undefined). */
  waitingKind?: PendingInteractionKind
  /** Tier: waiting outranks review (the bell counts both, waiting first). */
  kind: 'waiting' | 'review'
  /** Review outcome (review rows only). */
  result?: 'succeeded' | 'failed' | 'cancelled'
  /** Moment instant (waiting = task.updatedAt, review = latest settle). */
  at: number
}

/**
 * Collect every waiting session of every task, deduplicated by
 * task+session (an execution round and the refine round can name the same
 * session — it waits once, not twice). A session without a waiting signal
 * is not a notification, however busy it is.
 */
export function notificationsOf(
  tasks: readonly TaskRecord[],
  pendingOf: (sessionId: string | undefined) => PendingInteractionKind | undefined,
  titleOf: (sessionId: string) => string,
): NotificationItem[] {
  return notificationsExOf(tasks, pendingOf, titleOf, () => false)
    .filter(item => item.kind === 'waiting')
    .map(item => ({
      taskId: item.taskId,
      taskTitle: item.taskTitle,
      sessionId: item.sessionId,
      sessionTitle: item.sessionTitle,
      ...(item.waitingKind !== undefined ? { waitingKind: item.waitingKind } : {}),
      kind: item.kind,
      ...(item.result !== undefined ? { result: item.result } : {}),
      at: item.at,
    }))
}

/**
 * Full three-tier view: waiting sessions first (newest task first), then
 * unviewed review tasks (failed before succeeded, newest settle first).
 * `isUnviewed` decides the review tier (the board passes `taskUnviewed`);
 * absent/false = waiting-only (legacy behavior).
 */
export function notificationsExOf(
  tasks: readonly TaskRecord[],
  pendingOf: (sessionId: string | undefined) => PendingInteractionKind | undefined,
  titleOf: (sessionId: string) => string,
  isUnviewed: (task: TaskRecord) => boolean = taskUnviewed,
): NotificationItem[] {
  const waiting: NotificationItem[] = []
  const seen = new Set<string>()
  const push = (task: TaskRecord, sessionId: string | undefined): void => {
    if (sessionId === undefined) return
    const waitingKind = pendingOf(sessionId)
    if (waitingKind === undefined) return
    const key = `${task.id}|${sessionId}`
    if (seen.has(key)) return
    seen.add(key)
    waiting.push({
      taskId: task.id,
      taskTitle: task.title,
      sessionId,
      sessionTitle: titleOf(sessionId),
      waitingKind,
      kind: 'waiting',
      at: task.updatedAt,
    })
  }
  for (const task of tasks) {
    for (const round of task.executions) push(task, round.sessionId)
    push(task, task.refineSessionId)
  }
  const activity = new Map(tasks.map(task => [task.id, task.updatedAt]))
  waiting.sort((a, b) => (activity.get(b.taskId) ?? 0) - (activity.get(a.taskId) ?? 0))

  // Review tier: tasks sitting in review with unviewed content (the human
  // gate). Failed first (needs a decision), then succeeded. The session slot
  // names the latest plain run's session (or the task itself when unknown) —
  // the row opens the task detail either way.
  const review: NotificationItem[] = []
  for (const task of tasks) {
    if (task.status !== 'review' || !isUnviewed(task)) continue
    // Waiting already covers it (same task+session) — don't double-notify.
    const runs = plainRunsOf(task)
    const latest = runs[runs.length - 1]
    const sessionId = latest?.sessionId ?? task.executions[task.executions.length - 1]?.sessionId ?? task.id
    if ([...seen].some(key => key.startsWith(`${task.id}|`))) {
      // A waiting row for this task exists — the human already has a louder
      // signal; skip the quieter review echo for the same task.
      continue
    }
    const result = lastPlainResult(task)
    review.push({
      taskId: task.id,
      taskTitle: task.title,
      sessionId,
      sessionTitle: titleOf(sessionId),
      kind: 'review',
      ...(result !== undefined ? { result } : {}),
      at: latest?.endedAt ?? task.updatedAt,
    })
  }
  // Prove ordering from the shared event model (one derivation, not two):
  // waiting rows ride task.updatedAt, review rows ride their settle — the
  // sort below is newest-first with waiting outranking review on ties.
  void boardEventsOf
  review.sort((a, b) => {
    const rank = (result: NotificationItem['result']): number =>
      result === 'failed' ? 0 : result === 'succeeded' ? 1 : 2
    const rankDiff = rank(a.result) - rank(b.result)
    return rankDiff !== 0 ? rankDiff : b.at - a.at
  })
  return [...waiting, ...review]
}
