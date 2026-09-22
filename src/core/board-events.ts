/**
 * Board events: THE one derived moment model behind notifications, activity
 * and card badges. Derived from the ledger on every render, never stored —
 * a journal would be new synced state (merge grammar, migration), while the
 * moments already live in the ledger (createdAt/startedAt/endedAt/comments).
 *
 * Kind = what happened, state = lifecycle (queued/running/settled). The pair
 * is data-driven so new surfaces filter/group without new branches:
 * - created: one per task (settled, at createdAt);
 * - run: plain execution rounds (running while open, settled after);
 * - comment: user/automation comment rounds (queued while saved, running
 *   once injected, settled after; ruleId marks automation);
 * - external: out-of-band native turns (running while observed, settled after);
 * - direct: steer/direct sends (always settled at birth — the record);
 * - waiting: LIVE derived (pendingInteractionOf) — not ledger history.
 * Pure and framework-free so every consumer unit-tests in isolation.
 */
import type { PendingInteractionKind } from './controller.ts'
import { relatedSessionIdsOf } from './task-live.ts'
import { isOpenRound, type TaskRecord } from './tasks.ts'

/** What happened. */
export type BoardEventKind =
  | 'created'
  | 'run'
  | 'comment'
  | 'external'
  | 'direct'
  | 'waiting'

/** Lifecycle of the moment. */
export type BoardEventState = 'queued' | 'running' | 'settled'

/** One feed/notification moment. */
export interface BoardEvent {
  /** Stable row key (task + moment + state). */
  key: string
  taskId: string
  taskTitle: string
  kind: BoardEventKind
  state: BoardEventState
  /** Moment instant (createdAt/startedAt/injectedAt/endedAt/task.updatedAt). */
  at: number
  /** Settled outcome (run/comment/external only, when settled). */
  result?: 'succeeded' | 'failed' | 'cancelled'
  /** Comment/direct/external text excerpt source (trimmed, may be empty). */
  text?: string
  /** Related native session (run/comment/external/direct/waiting). */
  sessionId?: string
  /** Automation rule that created the round (comment/external with ruleId). */
  ruleId?: string
  /** Waiting kind (waiting events only). */
  waitingKind?: PendingInteractionKind
  /** Whether the moment is newer than the card's viewed baseline. */
  unviewed?: boolean
}

/** Context the derivation reads (all injected so core stays framework-free). */
export interface BoardEventContext {
  /** Live waiting signal (native amber dot). */
  pendingOf?: (sessionId: string | undefined) => PendingInteractionKind | undefined
  /** Card viewed baseline (taskUnviewed grammar lives in session-display to
   *  avoid a core→client import cycle; callers pass the instant). */
  viewedBaselineOf?: (task: TaskRecord) => number
  /** Resolve a session id to its display title (notifications only). */
  titleOf?: (sessionId: string) => string
  /** Live linked-session ids per task (bound workspace members). When absent,
   *  waiting falls back to binds + execution rounds (legacy). */
  linkedIdsOf?: (task: TaskRecord) => readonly string[]
}

/**
 * Collect every moment of every task, newest first (no cap — callers slice).
 * Running rounds ARE moments (started/observed/injected) — the old activity
 * feed skipped them, which hid "who is working now" from history. Empty
 * comment bodies are kept as moments (the row shows a placeholder) except
 * when the caller filters them — the derivation never drops facts.
 */
export function boardEventsOf(
  tasks: readonly TaskRecord[],
  ctx: BoardEventContext = {},
): BoardEvent[] {
  const events: BoardEvent[] = []
  // Waiting moments ride the round's own activity clock (started→ended),
  // exactly like the notification rows: two derivations of "when is this
  // wait from" must never disagree, even though no view consumes this branch
  // today (activity skips waiting; notifications derive separately).
  function waitingAt(task: TaskRecord, sessionId: string): number {
    const round = task.executions.find(candidate => candidate.sessionId === sessionId)
    return round !== undefined ? (round.endedAt ?? round.startedAt) : task.updatedAt
  }
  for (const task of tasks) {
    const baseline = ctx.viewedBaselineOf?.(task)
    const isUnviewed = (at: number): boolean | undefined =>
      baseline === undefined ? undefined : at > baseline
    events.push({
      key: `${task.id}|created`,
      taskId: task.id,
      taskTitle: task.title,
      kind: 'created',
      state: 'settled',
      at: task.createdAt,
      unviewed: isUnviewed(task.createdAt),
    })
    for (const round of task.executions) {
      const atOf = (fallback: number): number => fallback
      if (round.direct === true) {
        events.push({
          key: `${task.id}|${round.id}|direct`,
          taskId: task.id,
          taskTitle: task.title,
          kind: 'direct',
          state: 'settled',
          at: round.endedAt ?? round.startedAt,
          result: round.result,
          ...round.comment !== undefined && round.comment.trim() !== '' ? { text: round.comment } : {},
          ...round.sessionId !== undefined ? { sessionId: round.sessionId } : {},
          unviewed: isUnviewed(atOf(round.endedAt ?? round.startedAt)),
        })
        continue
      }
      if (round.external === true) {
        const open = isOpenRound(round)
        const at = open ? round.startedAt : (round.endedAt ?? round.startedAt)
        events.push({
          key: `${task.id}|${round.id}|external`,
          taskId: task.id,
          taskTitle: task.title,
          kind: 'external',
          state: open ? 'running' : 'settled',
          at,
          ...!open && round.result !== undefined ? { result: round.result } : {},
          ...round.comment !== undefined && round.comment.trim() !== '' ? { text: round.comment } : {},
          ...round.sessionId !== undefined ? { sessionId: round.sessionId } : {},
          ...round.ruleId !== undefined ? { ruleId: round.ruleId } : {},
          unviewed: isUnviewed(at),
        })
        continue
      }
      if (round.comment !== undefined) {
        const queued = round.injectedAt === undefined && round.endedAt === undefined
        const running = !queued && round.endedAt === undefined
        const state: BoardEventState = queued ? 'queued' : running ? 'running' : 'settled'
        const at = state === 'queued' ? round.startedAt
          : state === 'running' ? (round.injectedAt ?? round.startedAt)
          : (round.endedAt ?? round.startedAt)
        events.push({
          key: `${task.id}|${round.id}|comment`,
          taskId: task.id,
          taskTitle: task.title,
          kind: 'comment',
          state,
          at,
          ...state === 'settled' && round.result !== undefined ? { result: round.result } : {},
          ...round.comment.trim() !== '' ? { text: round.comment } : {},
          ...round.sessionId !== undefined ? { sessionId: round.sessionId } : {},
          ...round.ruleId !== undefined ? { ruleId: round.ruleId } : {},
          unviewed: isUnviewed(at),
        })
        continue
      }
      // Plain run.
      const open = isOpenRound(round)
      const at = open ? round.startedAt : (round.endedAt ?? round.startedAt)
      events.push({
        key: `${task.id}|${round.id}|run`,
        taskId: task.id,
        taskTitle: task.title,
        kind: 'run',
        state: open ? 'running' : 'settled',
        at,
        ...!open && round.result !== undefined ? { result: round.result } : {},
        ...round.sessionId !== undefined ? { sessionId: round.sessionId } : {},
        unviewed: isUnviewed(at),
      })
    }
    // LIVE waiting moments (one per waiting RELATED session, deduped) — the
    // same related set the live state reads (binds + execution
    // rounds + linked ids), so a bound-but-never-run waiting session still
    // lights the bell instead of only breathing the card.
    if (ctx.pendingOf !== undefined) {
      const seen = new Set<string>()
      const pushWaiting = (sessionId: string | undefined): void => {
        if (sessionId === undefined || seen.has(sessionId)) return
        const waitingKind = ctx.pendingOf?.(sessionId)
        if (waitingKind === undefined) return
        seen.add(sessionId)
        events.push({
          key: `${task.id}|waiting|${sessionId}`,
          taskId: task.id,
          taskTitle: task.title,
          kind: 'waiting',
          state: 'running',
          at: waitingAt(task, sessionId),
          sessionId,
          waitingKind,
          unviewed: true,
        })
      }
      for (const { sessionId } of relatedSessionIdsOf(task, ctx.linkedIdsOf?.(task))) pushWaiting(sessionId)
    }
  }
  return events.sort((a, b) => b.at - a.at)
}

/** Day bucket key (local calendar day) for activity grouping — pure. */
export function dayBucketOf(at: number): string {
  const date = new Date(at)
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Group events into day buckets (newest day first, events newest-first
 * inside). Pure — the view renders one section per bucket.
 */
export function groupEventsByDay(events: readonly BoardEvent[]): Array<{ day: string; items: BoardEvent[] }> {
  const buckets = new Map<string, BoardEvent[]>()
  for (const event of events) {
    const day = dayBucketOf(event.at)
    const list = buckets.get(day)
    if (list !== undefined) list.push(event)
    else buckets.set(day, [event])
  }
  return [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([day, items]) => ({ day, items }))
}
