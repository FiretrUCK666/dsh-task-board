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
 *
 * "Related" is defined ONCE here: the refine session, every bound session
 * source, every execution-round session and every live linked (workspace)
 * session — one de-duplicated, stable-ordered set. Every surface that asks
 * the live question reads this same set, so a workspace-bound card can never
 * go dark while one of its bound workspace's sessions is genuinely running
 * (the "行显示进行中、卡片不动" bug).
 */
import type { ExecutionRecord, TaskRecord } from './tasks.ts'
import { taskBindsOf } from './tasks.ts'

/** The live question's answer. */
export type TaskLiveState = 'running' | 'waiting' | 'idle'

/** The classify facts a caller supplies for the derived set's rows. */
export interface RelatedSessionFact {
  sessionId: string
  /** True only for the task's own refine session. */
  refine: boolean
}

/**
 * THE related-session set of a task (de-duplicated, stable order — refine
 * first, then binds, then execution rounds, then injected linked ids; the
 * same order every consumer has always read):
 * - the task's refine session,
 * - every bound session source (session binds; a workspace bind contributes
 *   through the linked ids below),
 * - every session an execution round ran in,
 * - every live linked session id the caller derived from the native
 *   workspace snapshots (`linkedSessionIdsOf`) — bound workspaces surface
 *   their CURRENT members, so a workspace member counts without ever having
 *   carried a board round.
 * @param task - the task owning the sessions.
 * @param linkedSessionIds - the task's live linked-session ids (the
 *   controller derives them from the workspaces face; undefined = skip).
 */
export function relatedSessionIdsOf(task: TaskRecord, linkedSessionIds?: readonly string[]): RelatedSessionFact[] {
  const seen = new Set<string>()
  const out: RelatedSessionFact[] = []
  const push = (sessionId: string | undefined, refine: boolean): void => {
    if (sessionId === undefined || sessionId === '' || seen.has(sessionId)) return
    seen.add(sessionId)
    out.push({ sessionId, refine })
  }
  push(task.refineSessionId, true)
  for (const bind of taskBindsOf(task)) {
    if (bind.kind === 'session') push(bind.sessionId, false)
  }
  for (const round of task.executions) push(round.sessionId, false)
  for (const sessionId of linkedSessionIds ?? []) push(sessionId, false)
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
  linkedSessionIds?: readonly string[],
): TaskLiveState {
  const sessions = relatedSessionIdsOf(task, linkedSessionIds)
  for (const { sessionId } of sessions) {
    const waiting = waitingOf(sessionId)
    if (waiting !== undefined && waiting !== null) return 'waiting'
  }
  for (const { sessionId } of sessions) {
    if (isRunningOf(sessionId)) return 'running'
  }
  return 'idle'
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
