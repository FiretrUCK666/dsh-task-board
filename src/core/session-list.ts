/**
 * Unified session list: the "one session model" behind a task's 会话 section.
 *
 * A task's real conversations come from two sources — the sessions its board
 * executions ran in, and the external sessions bound in from the sidebar —
 * and they feed ONE view: a single list, de-duplicated by session id, where
 * every row is one session. A session reached from any entry (an execution
 * review page or a linked panel) shows the same comment thread, because the
 * list never shows the same session twice and comments are already keyed by
 * session id (sessionCommentsOf).
 *
 * Pure and framework-free so the merge/priority/hide rules are unit-testable.
 */
import type { PendingInteractionKind } from './controller.ts'
import type { LinkedSessionRow } from './linked-sessions.ts'
import { executionUnviewed, sessionDisplay, sessionTimes, type SessionDisplay } from './session-display.ts'
import { plainRunsOf, type TaskRecord } from './tasks.ts'

/** One displayed session row (one per real session, de-duplicated). */
export interface TaskSessionRow {
  /** The real native session this row shows. */
  sessionId: string
  /** Display title (native title; rows without a session fall back to the task title). */
  title: string
  /** Workspace label (rows whose session is an external workspace member). */
  workspaceLabel?: string
  /** The representative plain-run execution, when this session carried a run
   *  (opens its review page; external sessions carry none). */
  executionId?: string
  /** Quiet run sequence (run rows; comments/refine are never numbered). */
  runIndex?: number
  /** Live session state (the same shape every SessionRow reads). */
  display: SessionDisplay
  /** When the session last saw activity. */
  updatedAt: number
  /** Unviewed content (run rows only for now; external has no session-level read state). */
  unviewed: boolean
}

/**
 * The derived per-session hidden set: `hidden.sessions` (session ids) plus
 * `hidden.executions` mapped to their execution's session id. THE single
 * source of truth for "is this session hidden" — hide is defined once in
 * terms of sessions, and the unified list filters by this set alone.
 */
export function hiddenSessionIdsOf(task: TaskRecord): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const sessionId of task.hidden?.sessions ?? []) ids.add(sessionId)
  for (const executionId of task.hidden?.executions ?? []) {
    const execution = task.executions.find(round => round.id === executionId)
    if (execution?.sessionId !== undefined) ids.add(execution.sessionId)
  }
  return ids
}

/** Whether any session is display-hidden (drives the "恢复全部已隐藏" affordance). */
export function hasHiddenSessions(task: TaskRecord): boolean {
  return hiddenSessionIdsOf(task).size > 0
}

/** Live facts the derivation needs from the controller (all resolve to a
 *  session id; framework-free so tests pass fakes). */
export interface TaskSessionContext {
  /** The task's live linked rows (controller.linkedOf — already hidden/live). */
  linked: readonly LinkedSessionRow[]
  /** Resolve a session's native display title. */
  titleOf(sessionId: string): string | undefined
  /** Resolve a session's pending interaction. */
  pendingInteractionOf(sessionId: string): PendingInteractionKind | undefined
}

/**
 * Order + de-duplicate a task's sessions into the single visible list:
 * - run candidates: the latest plain run per session (comment rounds share
 *   their parent run's session and never create extra rows; refine rounds are
 *   not sessions of the board executions).
 * - linked candidates: the live linked rows.
 * - de-duplicate by sessionId, run wins over linked (a session the task both
 *   executed and bound reads as the task's own run — it carries the execution
 *   identity, the quiet run number and the unread state).
 * - hidden sessions are dropped; run rows sort by latest activity, then
 *   linked rows in workspace order.
 */
export function taskSessionsOf(task: TaskRecord, ctx: TaskSessionContext): TaskSessionRow[] {
  const hidden = hiddenSessionIdsOf(task)

  // Run candidates, one per session (the latest plain run of that session is
  // the representative — comments sharing the session never add a row).
  const runBySession = new Map<string, TaskSessionRow>()
  for (const execution of plainRunsOf(task)) {
    if (execution.sessionId === undefined) continue
    const sessionId = execution.sessionId
    runBySession.set(sessionId, {
      sessionId,
      title: ctx.titleOf(sessionId) ?? task.title,
      executionId: execution.id,
      runIndex: plainRunsOf(task).findIndex(run => run.id === execution.id) + 1,
      display: sessionDisplay(task, execution, ctx.pendingInteractionOf(sessionId)),
      updatedAt: sessionTimes(task, execution).endedAt ?? execution.startedAt,
      unviewed: executionUnviewed(task, execution),
    })
  }
  const rows: TaskSessionRow[] = []
  for (const row of runBySession.values()) {
    if (!hidden.has(row.sessionId)) rows.push(row)
  }
  // Run group: most recently active first.
  rows.sort((a, b) => b.updatedAt - a.updatedAt)

  // External candidates (bound workspace/session members) — skip any session
  // already shown as a run (the run carries the execution identity).
  for (const linked of ctx.linked) {
    if (hidden.has(linked.sessionId) || runBySession.has(linked.sessionId)) continue
    rows.push({
      sessionId: linked.sessionId,
      title: linked.title,
      ...linked.workspaceLabel !== undefined ? { workspaceLabel: linked.workspaceLabel } : {},
      display: {
        state: linked.pendingInteraction !== undefined
          ? 'waiting'
          : linked.running
            ? 'running'
            : linked.completed
              ? 'succeeded'
              : 'cancelled',
        lastActivity: linked.updatedAt,
        waitingKind: linked.pendingInteraction,
      },
      updatedAt: linked.updatedAt,
      unviewed: false,
    })
  }
  return rows
}
