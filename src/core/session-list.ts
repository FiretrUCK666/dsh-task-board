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
  /** Live session state (the same shape every SessionRow reads). */
  display: SessionDisplay
  /** When the session last saw activity. */
  updatedAt: number
  /** Unviewed content (run rows only for now; external has no session-level read state). */
  unviewed: boolean
}

/**
 * The displayed title of one session row: the native title, else the
 * 未命名 placeholder — the ONE unnamed-grammar. A session without a durable
 * title is not nameless data: the host names it automatically from the
 * first real message (deterministic fallback + provider cadence), so the
 * honest display until then is exactly what the native New Session flow
 * would show. Title-less rows therefore read 「未命名」 (never a workspace
 * label, never a raw id dressed up as a name); the workspace still shows
 * in its own slot.
 */
export const UNTITLED_SESSION_KEY = 'detail.sessionUntitled'

export function sessionRowTitleOf(nativeTitle: string | undefined, fallback: string): string {
  return nativeTitle !== undefined && nativeTitle !== '' ? nativeTitle : fallback
}

/**
 * The activity window a session has ON this task — the earliest round's
 * start, the latest round's end, and the duration between them. The ONE
 * derivation for every session row (a board-run session and a bound
 * session's externally-observed turns read the same records), so the
 * 「开始 / 结束 / 耗时」line of a linked row is never a different grammar
 * from an execution row's. Empty when the session has no rounds.
 */
export function sessionWindowOf(task: TaskRecord, sessionId: string | undefined): {
  startedAt?: number
  endedAt?: number
  duration?: number
} {
  if (sessionId === undefined) return {}
  let startedAt: number | undefined
  let endedAt: number | undefined
  for (const round of task.executions) {
    if (round.sessionId !== sessionId) continue
    if (startedAt === undefined || round.startedAt < startedAt) startedAt = round.startedAt
    if (round.endedAt !== undefined && (endedAt === undefined || round.endedAt > endedAt)) endedAt = round.endedAt
  }
  if (startedAt === undefined) return {}
  return {
    startedAt,
    ...endedAt !== undefined ? { endedAt } : {},
    ...(endedAt !== undefined && endedAt >= startedAt) ? { duration: endedAt - startedAt } : {},
  }
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
  /** Resolve the session's ACTIVITY: is it still working right now (its own
   *  turn or a running subagent descendant)? The controller wires the one
   *  activity derivation (session-activity.ts) here; a direct steer's round is
   *  settled at birth and a session whose own turn paused but whose subagent
   *  keeps working is still working, so a bare flag would leave the row dark
   *  while the agent is genuinely busy. */
  sessionActiveOf?(sessionId: string): boolean
  /** Whether the session is ARCHIVED natively (the registry's archive set).
   *  An archived conversation is put away: its row leaves the card on every
   *  replica the instant the native state moves (derived, never ledger — zero
   *  sync delay by construction); the rounds stay in the ledger, so
   *  un-archiving brings the row back with its full history. */
  archivedOf?(sessionId: string): boolean
  /** The localized 未命名 placeholder (native title absent → row shows it). */
  untitledLabel?: string
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
  // Permanently removed sessions never show — even from a bound workspace
  // (the hidden set is reversible; removed is not).
  const removed = task.removedSessions ?? []
  // Natively archived conversations are put away — their rows leave the card
  // (the ledger rounds survive; un-archiving restores the row).
  const isArchived = (sessionId: string): boolean => ctx.archivedOf?.(sessionId) === true

  // Run candidates, one per session (the latest plain run of that session is
  // the representative — comments sharing the session never add a row).
  const runBySession = new Map<string, TaskSessionRow>()
  for (const execution of plainRunsOf(task)) {
    if (execution.sessionId === undefined) continue
    const sessionId = execution.sessionId
    if (removed.includes(sessionId) || isArchived(sessionId)) continue
    runBySession.set(sessionId, {
      sessionId,
      title: sessionRowTitleOf(ctx.titleOf(sessionId), ctx.untitledLabel ?? task.title),
      executionId: execution.id,
      display: sessionDisplay(task, execution, ctx.pendingInteractionOf(sessionId), ctx.sessionActiveOf?.(sessionId) ?? false),
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
  // already shown as a run (the run carries the execution identity) or one
  // permanently removed (the delete was irreversible).
  for (const linked of ctx.linked) {
    if (hidden.has(linked.sessionId) || removed.includes(linked.sessionId)
      || isArchived(linked.sessionId) || runBySession.has(linked.sessionId)) continue
    // The linked row's own title derivation falls back through the cwd
    // label and finally the id; an id-named row (no durable title, no cwd)
    // reads 未命名 like every other title-less session.
    const linkedTitle = linked.title !== linked.sessionId
      ? linked.title
      : sessionRowTitleOf(ctx.titleOf(linked.sessionId), ctx.untitledLabel ?? linked.sessionId)
    rows.push({
      sessionId: linked.sessionId,
      title: linkedTitle,
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
  return orderedSessionsOf(task, rows)
}

/**
 * The displayed order of the unified list: the user's manual array first
 * (rows inside it follow its exact order), then every other row — a session
 * that arrived after the reorder (a new bind, a fresh run, a rerun) lands at
 * the TOP, newest-activity first. A manual order never hides a row; it only
 * overrides the default sort.
 */
export function orderedSessionsOf(task: TaskRecord, rows: readonly TaskSessionRow[]): TaskSessionRow[] {
  const order = task.sessionsOrder ?? []
  if (order.length === 0) return [...rows]
  const indexOf = new Map(order.map((id, index) => [id, index]))
  const listed = rows.filter(row => indexOf.has(row.sessionId))
  listed.sort((a, b) => (indexOf.get(a.sessionId) ?? 0) - (indexOf.get(b.sessionId) ?? 0))
  const fresh = rows
    .filter(row => !indexOf.has(row.sessionId))
    .sort((a, b) => b.updatedAt - a.updatedAt)
  return [...fresh, ...listed]
}
