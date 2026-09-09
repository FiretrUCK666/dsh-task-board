/**
 * Notification center aggregation: every session across every task that is
 * currently waiting on the user (approval / plan-review / question) — one
 * row per waiting session, newest task first. Read-only: clicking a row
 * opens the task detail (the detail owns sessions, answers and navigation),
 * so the center never duplicates a surface that already exists.
 *
 * Pure and framework-free (the pending signal arrives as a callback), so the
 * aggregation unit-tests in isolation; TaskBoard supplies the live faces.
 */
import type { PendingInteractionKind } from '../../core/controller.ts'
import type { TaskRecord } from '../../core/tasks.ts'

/** One waiting session row. */
export interface NotificationItem {
  taskId: string
  taskTitle: string
  sessionId: string
  sessionTitle: string
  waitingKind: PendingInteractionKind
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
  const items: NotificationItem[] = []
  const seen = new Set<string>()
  const push = (task: TaskRecord, sessionId: string | undefined): void => {
    if (sessionId === undefined) return
    const waitingKind = pendingOf(sessionId)
    if (waitingKind === undefined) return
    const key = `${task.id}|${sessionId}`
    if (seen.has(key)) return
    seen.add(key)
    items.push({
      taskId: task.id,
      taskTitle: task.title,
      sessionId,
      sessionTitle: titleOf(sessionId),
      waitingKind,
    })
  }
  for (const task of tasks) {
    for (const round of task.executions) push(task, round.sessionId)
    push(task, task.refineSessionId)
  }
  const activity = new Map(tasks.map(task => [task.id, task.updatedAt]))
  return items.sort((a, b) => (activity.get(b.taskId) ?? 0) - (activity.get(a.taskId) ?? 0))
}
