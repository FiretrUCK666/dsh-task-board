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
import type { PendingInteractionKind } from '../../core/controller.ts'
import { taskUnviewed } from '../../core/session-display.ts'
import { relatedSessionIdsOf } from '../../core/task-live.ts'
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
  /** Moment instant: waiting rides the round's own activity clock
   *  (started→ended), review rides its settle — never task.updatedAt, so
   *  metadata writes (recolor, reorder, cruise toggles) cannot reorder the
   *  bell, fake arrivals, or poison the unseen waterline. */
  at: number
}

/** THE row key (`task|session|kind`): snooze stamps, drawer keys and the
 *  unseen set all derive from this one constructor — never a retyped
 *  template, so the three can never disagree on identity. */
export function noteKeyOf(note: Pick<NotificationItem, 'taskId' | 'sessionId' | 'kind'>): string {
  return `${note.taskId}|${note.sessionId}|${note.kind}`
}

/** Metadata-orthogonal row order: lexicographic key comparison for sort
 *  tiebreaks (stable across metadata writes, drags and reorders). */
function compareNoteKey(
  a: Pick<NotificationItem, 'taskId' | 'sessionId' | 'kind'>,
  b: Pick<NotificationItem, 'taskId' | 'sessionId' | 'kind'>,
): number {
  const left = noteKeyOf(a)
  const right = noteKeyOf(b)
  return left < right ? -1 : left > right ? 1 : 0
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
 * absent/false = waiting-only (legacy behavior). `linkedIdsOf` supplies live
 * linked-session ids per task so a bound-but-never-run waiting session still
 * notifies (same related set as the live state).
 */
export function notificationsExOf(
  tasks: readonly TaskRecord[],
  pendingOf: (sessionId: string | undefined) => PendingInteractionKind | undefined,
  titleOf: (sessionId: string) => string,
  isUnviewed: (task: TaskRecord) => boolean = taskUnviewed,
  linkedIdsOf: (task: TaskRecord) => readonly string[] = () => [],
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
    // The waiting moment is the round's own activity (started→ended): a
    // session-less binding (no round yet) falls back to the task clock.
    // Approximation, stated honestly: this is round activity, NOT the pending
    // arrival instant (a long run that starts waiting late still sorts by its
    // start). A dedicated pending-since clock would need ledger storage;
    // until then ordering among waits is approximate, arrival dots are exact
    // (any post-waterline activity lights, whatever its `at`).
    const round = task.executions.find(candidate => candidate.sessionId === sessionId)
    waiting.push({
      taskId: task.id,
      taskTitle: task.title,
      sessionId,
      sessionTitle: titleOf(sessionId),
      waitingKind,
      kind: 'waiting',
      at: round !== undefined ? (round.endedAt ?? round.startedAt) : task.updatedAt,
    })
  }
  for (const task of tasks) {
    for (const { sessionId } of relatedSessionIdsOf(task, linkedIdsOf(task))) push(task, sessionId)
  }
  // Newest moment first (the rows carry their own clocks now — no task-clock
  // lookup table, so metadata writes cannot reorder the bell). Ties break by
  // row key (task|session|kind, lexicographic) — metadata-orthogonal and
  // stable, never by task.updatedAt (which would smuggle the metadata clock
  // back through the tiebreak).
  waiting.sort((a, b) => b.at - a.at || compareNoteKey(a, b))

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
  review.sort((a, b) => {
    const rank = (result: NotificationItem['result']): number =>
      result === 'failed' ? 0 : result === 'succeeded' ? 1 : 2
    const rankDiff = rank(a.result) - rank(b.result)
    if (rankDiff !== 0) return rankDiff
    if (b.at !== a.at) return b.at - a.at
    return compareNoteKey(a, b)
  })
  return [...waiting, ...review]
}

/** One folded task entry: the head row plus every row sharing its task.
 *  The bell and the drawer read the same folded list, so the badge always
 *  equals the visible row count ("collapsed counts one" — a folded group of
 *  three reads 1, never 3). Order inherits the unfolded order. */
export interface FoldedNotification {
  head: NotificationItem
  /** Every row in this head's task (head first). */
  items: NotificationItem[]
  /** Rows folded into this head (items.length — 1 is unfolded and renders
   *  exactly as before). */
  count: number
}

/**
 * Fold notification rows by task (same-task rows share one head — the first,
 * which the waiting-first ordering already ranked loudest). Pure view-layer
 * grouping: `notificationsExOf` keeps its signature so existing callers and
 * tests never change; the bell badge and the drawer list fold the same way.
 */
export function foldNotesByTask(notes: readonly NotificationItem[]): FoldedNotification[] {
  const folded: FoldedNotification[] = []
  const index = new Map<string, FoldedNotification>()
  for (const note of notes) {
    const existing = index.get(note.taskId)
    if (existing !== undefined) {
      existing.items.push(note)
      existing.count += 1
      continue
    }
    const entry: FoldedNotification = { head: note, items: [note], count: 1 }
    index.set(note.taskId, entry)
    folded.push(entry)
  }
  return folded
}
