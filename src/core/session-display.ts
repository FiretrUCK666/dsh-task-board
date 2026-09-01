/**
 * Shared session display logic: derive the live state of any execution's
 * underlying session (across all its rounds: the original run + comments +
 * refine rounds). Used by execution rows, task cards, and the reminder
 * system so every surface shows the same truth.
 *
 * Pure functions — no side effects, fully unit-testable.
 */
import type { PendingInteractionKind } from './controller.ts'
import { isOpenRound, type TaskRecord, type ExecutionRecord } from './tasks.ts'

/**
 * The live state of an execution's session (aggregating all rounds that share
 * the session: the original run, comments, and any refine rounds).
 */
export interface SessionDisplay {
  /** The session's current state (waiting > running > latest settled). */
  state: 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled'
  /** When the session last saw activity (started or settled a round). */
  lastActivity: number | undefined
  /** The interaction kind if the session is waiting on the user. */
  waitingKind: PendingInteractionKind | undefined
}

/**
 * Collect every round belonging to an execution's session:
 * - Rounds with the same sessionId (comments injected into this session,
 *   refine rounds using the same refine session).
 * - Rounds whose parentExecutionId matches (comments attributed by parent
 *   rather than session — legacy data compatibility).
 * The execution itself is always included.
 */
export function sessionRoundsOf(task: TaskRecord, execution: ExecutionRecord): readonly ExecutionRecord[] {
  const id = execution.id
  const sid = execution.sessionId
  return task.executions.filter(round =>
    round.id === id ||
    // Session-anchored rounds (submitted from a linked-session panel) belong
    // to that session's own thread, never to an execution's review page —
    // even when the anchored session id coincides with an execution's.
    // EXCEPTION: externally-observed rounds (a native-side turn recorded onto
    // the task) are deliberately part of the session's activity — they keep
    // their thread slot, but the session's live state/unread MUST see them
    // (without this an out-of-band turn stays invisible to the row: the
    // "进行中不闪、光效不往下走" bug).
    (sid !== undefined && round.sessionId === sid && (round.sessionAnchor === undefined || round.external === true)) ||
    round.parentExecutionId === id
  )
}

/**
 * Derive the live state of an execution's session from its rounds.
 * @param task - the task owning the execution.
 * @param execution - the execution whose session we're displaying.
 * @param waitingKind - the interaction kind if the session is waiting on the
 *   user (from the controller's pendingInteractionOf); undefined otherwise.
 * @param nativeRunning - the session's NATIVE running flag (the host list).
 *   TRUE means the agent is working right now — no matter which surface
 *   started the turn (a plain run, a direct steer, a session rule, an
 *   out-of-band native chat). Without it a direct-steer round (settled at
 *   birth) would leave the row dark while the session was genuinely running —
 *   the "插话后卡片/会话行不动" bug. Board open rounds and refine rounds
 *   keep their own semantics below; this only ADDS the native truth.
 */
export function sessionDisplay(
  task: TaskRecord,
  execution: ExecutionRecord,
  waitingKind: PendingInteractionKind | undefined,
  nativeRunning = false,
): SessionDisplay {
  const rounds = sessionRoundsOf(task, execution)
  if (rounds.length === 0) {
    // Shouldn't happen (execution itself is always in the list), but defensive.
    return { state: 'cancelled', lastActivity: undefined, waitingKind: undefined }
  }

  // Any round currently open (running in its session)? A plain run or a
  // refine round is open from its start (they carry no `injectedAt`); a
  // comment round is open only once actually injected — a saved/queued
  // comment has not started and must not make the session look live. An
  // EXTERNALLY-observed round is open from its observation (it is the native
  // turn itself, never a queued comment): its comment field is a thread body,
  // not a queue marker. The displayed activity is the most recently opened
  // round's start.
  const open = rounds.filter(r => isOpenRound(r))
  if (open.length > 0) {
    const openRound = open.reduce((latest, r) => (r.startedAt > latest.startedAt ? r : latest))
    // Session is live.
    if (waitingKind !== undefined) {
      return { state: 'waiting', lastActivity: openRound.startedAt, waitingKind }
    }
    return { state: 'running', lastActivity: openRound.startedAt, waitingKind: undefined }
  }

  // All rounds settled — but the agent is genuinely working right now
  // (native truth): a direct-steer round is settled at birth, so without
  // this the session would read as finished while its turn was running.
  // A pending interaction still outranks (the human turn is first).
  if (waitingKind !== undefined) {
    return { state: 'waiting', lastActivity: rounds[0].startedAt, waitingKind }
  }
  if (nativeRunning) {
    return { state: 'running', lastActivity: rounds[0].startedAt, waitingKind: undefined }
  }

  // All rounds settled. Use the latest settled round's state.
  const settled = [...rounds]
    .filter(r => r.endedAt !== undefined)
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
  const latest = settled[0]
  if (latest === undefined) {
    // No settled rounds and no open rounds — shouldn't happen, but defensive.
    return { state: 'cancelled', lastActivity: undefined, waitingKind: undefined }
  }

  const state: SessionDisplay['state'] =
    latest.result === 'succeeded' ? 'succeeded' :
    latest.result === 'failed' ? 'failed' :
    latest.result === 'cancelled' ? 'cancelled' :
    'cancelled' // defensive fallback

  return { state, lastActivity: latest.endedAt, waitingKind: undefined }
}

/**
 * The time range of an execution's session (reflecting all its rounds' activity).
 * - startedAt = earliest round's start.
 * - endedAt = latest settled round's end; undefined if any round is still open.
 * - duration = endedAt - startedAt; undefined if the session is still open.
 */
export function sessionTimes(task: TaskRecord, execution: ExecutionRecord): {
  startedAt: number
  endedAt: number | undefined
  duration: number | undefined
} {
  const rounds = sessionRoundsOf(task, execution)
  if (rounds.length === 0) {
    return { startedAt: execution.startedAt, endedAt: undefined, duration: undefined }
  }

  const startedAt = Math.min(...rounds.map(r => r.startedAt))
  // THE open-round judgment (shared with the dispatcher): a round that is
  // merely saved-and-queued is not work in progress, and a round that has
  // settled is finished — reading `endedAt` alone here would re-derive the
  // same rule a second time and drift from it.
  const anyOpen = rounds.some(r => isOpenRound(r))
  const endedAt = anyOpen
    ? undefined
    : Math.max(...rounds.map(r => r.endedAt ?? 0).filter(t => t > 0))
  const duration = endedAt !== undefined ? endedAt - startedAt : undefined

  return { startedAt, endedAt, duration }
}

/**
 * Count how many sessions (executions + refine) are waiting on the user.
 * Used by the task card badge to show "N 待处理" when the task has pending
 * interactions across its sessions.
 */
export function taskPendingCount(
  task: TaskRecord,
  pendingInteractionOf: (sessionId: string | undefined) => PendingInteractionKind | undefined,
): { count: number; items: Array<{ executionId?: string; waitingKind: PendingInteractionKind }> } {
  const items: Array<{ executionId?: string; waitingKind: PendingInteractionKind }> = []

  // Check every execution's session.
  for (const execution of task.executions) {
    if (execution.sessionId === undefined) continue
    const waitingKind = pendingInteractionOf(execution.sessionId)
    if (waitingKind !== undefined) {
      items.push({ executionId: execution.id, waitingKind })
    }
  }

  // Check the refine session (if any).
  if (task.refineSessionId !== undefined) {
    const waitingKind = pendingInteractionOf(task.refineSessionId)
    if (waitingKind !== undefined) {
      items.push({ waitingKind })
    }
  }

  return { count: items.length, items }
}

// --- unviewed-content reminders ----------------------------------------------
//
// Every surface that can hold new content (a settled run, an injected or
// settled comment, a refine turn) carries a `viewedAt`: the instant the user
// last opened the surface that reveals it (the task detail for the card, the
// review page for an execution row). Content whose activity is newer than the
// baseline counts as unviewed and drives the reminder affordances — the
// card's breathing glow + "新" badge and the row's unread dot — exactly like
// an inbox's unread signal: opening the surface clears it, new activity
// re-lights it. Legacy rows without `viewedAt` default to their own latest
// activity, so nothing already-seen lights up after an upgrade.

/** The activity instant of a round: when it settled, else its last start. */
function roundActivity(round: ExecutionRecord): number {
  return round.endedAt ?? round.startedAt
}

/**
 * The viewed baseline of an execution row: when the user last opened its
 * review page; absent, the run's own start (every created/normalized run
 * carries a viewedAt, so this only guards test fixtures). A stable anchor —
 * a run starts viewed at its start, its settlement (or a later comment)
 * then lights the unread dot until the review page opens.
 */
export function executionViewedBaseline(execution: ExecutionRecord): number {
  return execution.viewedAt ?? execution.startedAt
}

/**
 * Whether an execution's session has content newer than the last time its
 * review page was opened: any round of the session (the run itself plus its
 * comments) with activity after the baseline. The single source for the
 * execution row's unread dot and the card's "新" badge.
 */
export function executionUnviewed(task: TaskRecord, execution: ExecutionRecord): boolean {
  const baseline = executionViewedBaseline(execution)
  return sessionRoundsOf(task, execution).some(round => roundActivity(round) > baseline)
}

/**
 * The viewed baseline of a task card: when the user last opened the task
 * detail; absent (legacy) it equals the task's newest round activity, so
 * already-seen content stays quiet after an upgrade.
 */
export function taskViewedBaseline(task: TaskRecord): number {
  if (task.viewedAt !== undefined) return task.viewedAt
  let latest = 0
  for (const round of task.executions) latest = Math.max(latest, roundActivity(round))
  return latest
}

/**
 * Whether the task has any unviewed content: any round — a run settling, a
 * comment being injected or settling, a refine turn — with activity newer
 * than the card's viewed baseline. Drives the card's breathing glow.
 */
export function taskUnviewed(task: TaskRecord): boolean {
  const baseline = taskViewedBaseline(task)
  return task.executions.some(round => roundActivity(round) > baseline)
}

/**
 * How many plain-run executions of the task are unviewed — the "新 N" count
 * on the card. Comment/refine-only unread (no unviewed plain runs) shows a
 * bare "新" instead.
 */
export function taskUnviewedCount(task: TaskRecord): number {
  let count = 0
  for (const execution of task.executions) {
    if (execution.comment !== undefined || execution.refine === true) continue
    if (executionUnviewed(task, execution)) count += 1
  }
  return count
}
