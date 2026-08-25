/**
 * Task live state — THE one derivation of "is this task actually active"
 * (running / waiting / idle), consumed by the card breathing, the session-row
 * glow and the controller's state drive. It answers a class of bugs that
 * repeated themselves because every surface read a different source: the
 * card read `task.status`, the session row read board rounds only, the
 * detect-external pass read flips, and a direct-send (插话) round was
 * settled at birth so NOTHING ever reflected that the session was truly
 * running.
 *
 * The truth source is the NATIVE session list: a related session whose
 * `running === true` means the agent is working right now — no matter which
 * surface started it (board execution, direct steer, a session rule, an
 * out-of-band native chat). Board rounds stay authoritative for their own
 * settle events; this module only answers the live question.
 */
import type { ExecutionRecord, TaskRecord } from './tasks.ts'

/** The live question's answer. */
export type TaskLiveState = 'running' | 'waiting' | 'idle'

/** Every session this task relates to (execution/comment/direct/external
 *  rounds + the refine session, de-duplicated, stable order). */
export function relatedSessionIdsOf(task: TaskRecord): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const push = (sessionId: string | undefined): void => {
    if (sessionId === undefined || sessionId === '' || seen.has(sessionId)) return
    seen.add(sessionId)
    out.push(sessionId)
  }
  push(task.refineSessionId)
  for (const round of task.executions) push(round.sessionId)
  return out
}

/**
 * The one live-state derivation:
 * - waiting — any related session is pending on the user (approval /
 *   plan-review / question); the human's turn outranks everything;
 * - running — any related session reports `running` (the agent is working);
 * - idle — otherwise.
 * Sources are injected callbacks so the module stays framework-free and
 * unit-testable; the controller wires the native list snapshot.
 */
export function taskLiveStateOf(
  task: TaskRecord,
  isRunningOf: (sessionId: string) => boolean,
  waitingOf: (sessionId: string) => unknown,
): TaskLiveState {
  const sessions = relatedSessionIdsOf(task)
  for (const sessionId of sessions) {
    const waiting = waitingOf(sessionId)
    if (waiting !== undefined && waiting !== null) return 'waiting'
  }
  for (const sessionId of sessions) {
    if (isRunningOf(sessionId)) return 'running'
  }
  return 'idle'
}

/** The latest board round of a task (executions are append-only). */
export function latestRoundOf(task: TaskRecord): ExecutionRecord | undefined {
  return task.executions[task.executions.length - 1]
}

/**
 * Whether a round is "direct-like": a direct steer round is settled at birth
 * and has NO host turn/end settle event — its completion is only visible as
 * the native session flipping back to idle, so the controller's fallback has
 * to judge it. Board execution rounds, injected comment rounds, refinement
 * rounds and externally-observed rounds all have their own event paths and
 * are never fallback material.
 */
export function isDirectLike(round: ExecutionRecord | undefined): boolean {
  return round !== undefined && round.direct === true && round.endedAt !== undefined
}

/** The fallback column for a finished direct-like round: a steer that ran to
 *  completion lands in 待审核 (a human gate, exactly like a successful run). */
export const DIRECT_FALLBACK_STATUS = 'review' as const
