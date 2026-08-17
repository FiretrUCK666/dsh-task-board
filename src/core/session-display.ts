/**
 * Shared session display logic: derive the live state of any execution's
 * underlying session (across all its rounds: the original run + comments +
 * refine rounds). Used by execution rows, task cards, and the reminder
 * system so every surface shows the same truth.
 *
 * Pure functions — no side effects, fully unit-testable.
 */
import type { PendingInteractionKind } from './controller.ts'
import type { TaskRecord, ExecutionRecord } from './tasks.ts'

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
function sessionRounds(task: TaskRecord, execution: ExecutionRecord): readonly ExecutionRecord[] {
  const id = execution.id
  const sid = execution.sessionId
  return task.executions.filter(round =>
    round.id === id ||
    (sid !== undefined && round.sessionId === sid) ||
    round.parentExecutionId === id
  )
}

/**
 * Derive the live state of an execution's session from its rounds.
 * @param task - the task owning the execution.
 * @param execution - the execution whose session we're displaying.
 * @param waitingKind - the interaction kind if the session is waiting on the
 *   user (from the controller's pendingInteractionOf); undefined otherwise.
 */
export function sessionDisplay(
  task: TaskRecord,
  execution: ExecutionRecord,
  waitingKind: PendingInteractionKind | undefined,
): SessionDisplay {
  const rounds = sessionRounds(task, execution)
  if (rounds.length === 0) {
    // Shouldn't happen (execution itself is always in the list), but defensive.
    return { state: 'cancelled', lastActivity: undefined, waitingKind: undefined }
  }

  // Any round currently open (injected but not settled)?
  const openRound = rounds.find(r => r.injectedAt !== undefined && r.endedAt === undefined)
  if (openRound !== undefined) {
    // Session is live.
    if (waitingKind !== undefined) {
      return { state: 'waiting', lastActivity: openRound.startedAt, waitingKind }
    }
    return { state: 'running', lastActivity: openRound.startedAt, waitingKind: undefined }
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
  const rounds = sessionRounds(task, execution)
  if (rounds.length === 0) {
    return { startedAt: execution.startedAt, endedAt: undefined, duration: undefined }
  }

  const startedAt = Math.min(...rounds.map(r => r.startedAt))
  const anyOpen = rounds.some(r => r.endedAt === undefined)
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
