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
 * The truth source is the NATIVE session list, read through ONE activity
 * derivation: a related session is working right now when its OWN turn runs
 * OR when a subagent-origin descendant it summoned is still running
 * (session-activity.ts / session-lineage.ts — the official sidebar's
 * semantics). That covers every way work can still be in flight no matter
 * which surface started it (board execution, direct steer, a session rule, an
 * out-of-band native chat, a subagent continuing after its parent's turn
 * paused). Board rounds stay authoritative for their own settle events; this
 * module only answers the live question — and the callers pass the activity
 * reader in, never a locally re-derived flag.
 *
 * "Related" is defined ONCE here: the refine session, every bound session
 * source, every execution-round session and every live linked (workspace)
 * session — one de-duplicated, stable-ordered set. Every surface that asks
 * the live question reads this same set, so a workspace-bound card can never
 * go dark while one of its bound workspace's sessions is genuinely running
 * (the "行显示进行中、卡片不动" bug).
 */
import type { ExecutionRecord, TaskRecord, TaskStatus } from './tasks.ts'
import { openExecutionRoundsOf, settleColumnOf, taskBindsOf, taskExecutable } from './tasks.ts'

/**
 * The live question's answer.
 * - `running` — some related session is working (its own turn or a running
 *   subagent descendant — see session-activity.ts);
 * - `waiting` — some related session waits on the user (approval / plan review
 *   / question); the human's turn outranks everything;
 * - `idle` — every related session is PRESENT and provably not working;
 * - `unknown` — no verdict: a related row is missing from the snapshot (or the
 *   list has not arrived). It is deliberately NOT `idle`: an absent row cannot
 *   tell "the work stopped" from "the session is not in this list", and the
 *   exits that write the column must not treat it as evidence (see
 *   {@link leaveRunningTargetOf} and the controller's two-pass discipline).
 */
export type TaskLiveState = 'running' | 'waiting' | 'idle' | 'unknown'

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
 *
 * `removedSessions` is the authoritative NOT-related gate and is subtracted
 * from EVERY source here — the same set the display rows already filter on, so
 * a session the user deleted from the card (hidden-tray 删除) can never drive
 * the card's live state or an external round, even while its session bind
 * lingers (the bind survives when a workspace bind is also present). The
 * corollary the add-session picker relies on: a removed session leaves this
 * set, so it becomes re-offerable again (删除 = 可再拖回/再选回).
 * @param task - the task owning the sessions.
 * @param linkedSessionIds - the task's live linked-session ids (the
 *   controller derives them from the workspaces face; undefined = skip).
 */
export function relatedSessionIdsOf(task: TaskRecord, linkedSessionIds?: readonly string[]): RelatedSessionFact[] {
  const removed = new Set(task.removedSessions ?? [])
  const seen = new Set<string>()
  const out: RelatedSessionFact[] = []
  const push = (sessionId: string | undefined, refine: boolean): void => {
    if (sessionId === undefined || sessionId === '' || seen.has(sessionId) || removed.has(sessionId)) return
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
 * - running — any related session is ACTIVE (its own turn, or a subagent
 *   descendant it summoned — the session-activity derivation, never a second
 *   reading of the bare flag);
 * - unknown — nothing is active AND at least one related row is missing from
 *   the snapshot: no verdict (see `TaskLiveState`);
 * - idle — otherwise: every related session is present and not working.
 * Sources are injected callbacks so the module stays framework-free and
 * unit-testable; the controller wires the native list snapshot.
 * @param task - the task owning the sessions.
 * @param isActiveOf - whether a session is still working (activity: own ∨
 *   descendant — `sessionActiveOf` from session-activity.ts).
 * @param waitingOf - the session's pending interaction, if any.
 * @param opts.linkedSessionIds - the task's live linked-session ids.
 * @param opts.isKnownOf - whether a session's row is PRESENT in the snapshot.
 *   Absent (old wirings, fakes) = every related session counts as known, which
 *   is exactly the pre-`unknown` behavior — a judge never invents a verdict it
 *   cannot support, but a caller that cannot testify about presence must not
 *   hold the card hostage either.
 */
export function taskLiveStateOf(
  task: TaskRecord,
  isActiveOf: (sessionId: string) => boolean,
  waitingOf: (sessionId: string) => unknown,
  opts: {
    linkedSessionIds?: readonly string[]
    isKnownOf?: (sessionId: string) => boolean
  } = {},
): TaskLiveState {
  const sessions = relatedSessionIdsOf(task, opts.linkedSessionIds)
  for (const { sessionId } of sessions) {
    const waiting = waitingOf(sessionId)
    if (waiting !== undefined && waiting !== null) return 'waiting'
  }
  let incomplete = false
  for (const { sessionId } of sessions) {
    if (isActiveOf(sessionId)) return 'running'
    // No positive evidence yet: an absent row leaves the verdict open instead
    // of reading as "it stopped" — a card must never be written out of 进行中
    // on a row the snapshot simply does not carry (the reconcile/watchFor
    // Settlement "an absent snapshot never judges" law).
    if (opts.isKnownOf !== undefined && !opts.isKnownOf(sessionId)) incomplete = true
  }
  return incomplete ? 'unknown' : 'idle'
}

/**
 * Why a `running`-column card is allowed to keep its column — THE one
 * leave-running judgment behind every non-settle exit (session deletion,
 * the reconcile orphan sweep, the direct-steer fallback). The settled
 * exits keep their own decision (`settleColumnOf`): they record an outcome
 * first, then decide; the exits here decide on the CURRENT facts only.
 *
 * One three-way justification, read in order:
 * - `'open'` — an in-flight execution round (refinement excluded, same law
 *   as the column gate): real work is still running on this card;
 * - `'live'` — a related session genuinely working right now (native truth:
 *   its own turn OR a running subagent descendant). `'unknown'` lands here
 *   too, deliberately: with no verdict the card keeps its column (leaving on
 *   an incomplete snapshot is how a working card gets persisted out of
 *   进行中), and the controller's two-pass discipline converts a SECOND
 *   consecutive incomplete pass into `'idle'` before asking — so "no verdict"
 *   can never hold the column forever;
 * - `'schedule'` — an armed schedule whose next automatic run is still to
 *   come keeps the card parked in `running` between runs (the budgeted
 *   batch/chain gap — the same continuation `settleExecution` grants on a
 *   succeeded settle).
 * `undefined` = the card is an orphan: no evidence for `running` anywhere,
 * and it must leave (where to is `leaveRunningTargetOf`).
 */
export type RunningJustification = 'open' | 'live' | 'schedule'

/** The schedule-continuation half of the justification above: an armed rule
 *  whose budget still has a run left (chain and budgeted cron share one
 *  shape here — the settle path reads the same two counters, only adjusted
 *  for when each path increments them, see the branches). Unbudgeted cron
 *  never holds the column: a cron with no `maxRuns` keeps nothing pending
 *  between fires, so its card settles to review like any plain run. */
export function scheduleGapHolds(task: TaskRecord): boolean {
  const schedule = task.schedule
  if (schedule === undefined || !schedule.enabled || !taskExecutable(task)) return false
  if (schedule.mode === 'chain') {
    // The hand-off increments the counter when it launches the NEXT run, so
    // a just-settled run is one behind — the same `runCount + 1` form the
    // settle path uses for chains.
    return schedule.maxRuns === undefined || schedule.runCount + 1 < schedule.maxRuns
  }
  // The scheduler increments the counter at fire-accept, so a just-settled
  // run is already counted — the same plain `runCount` form as the settle
  // path's batch branch.
  return schedule.maxRuns !== undefined && schedule.runCount < schedule.maxRuns
}

/**
 * The single leave-`running` judgment: why the card may stay, undefined when
 * it must leave. `live` is the native truth (`taskLiveStateOf` on the same
 * related set the caller renders from). `ignoreSchedule` drops the schedule
 * leg — a deletion that removed in-flight work is a cancellation (the work
 * is gone, there is nothing to continue), never a batch gap.
 */
export function runningJustificationOf(
  task: TaskRecord,
  live: TaskLiveState,
  opts: { ignoreSchedule?: boolean } = {},
): RunningJustification | undefined {
  if (task.status !== 'running') return undefined
  if (openExecutionRoundsOf(task).length > 0) return 'open'
  if (live !== 'idle') return 'live'
  if (!opts.ignoreSchedule && scheduleGapHolds(task)) return 'schedule'
  return undefined
}

/**
 * Where a `running`-column card with NO justification leaves to — the
 * cancellation semantics of `settleColumnOf` (a card holding completed work
 * keeps its human gate in review, otherwise it returns to the queue).
 * `undefined` = the card stays (either it is not in `running`, or one of
 * the three legs above still holds it).
 */
export function leaveRunningTargetOf(
  task: TaskRecord,
  live: TaskLiveState,
  opts: { ignoreSchedule?: boolean } = {},
): TaskStatus | undefined {
  if (task.status !== 'running') return undefined
  if (runningJustificationOf(task, live, opts) !== undefined) return undefined
  return settleColumnOf(task, 'cancelled', false, false, false)
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

/**
 * The task's newest direct-like round, or undefined. A direct round is
 * settled at birth, so it is never "the last row" for long — under
 * per-session lanes any later append (a saved comment on another conversation,
 * an observed native turn) slips past a `latestExecutionOf` check and the
 * steer's completion would never be seen. Searching from the end keeps the
 * judgment about ONE round (the newest steer) while making its position in the
 * array irrelevant.
 */
export function newestDirectLike(task: TaskRecord): ExecutionRecord | undefined {
  for (let index = task.executions.length - 1; index >= 0; index -= 1) {
    const round = task.executions[index]
    if (round !== undefined && isDirectLike(round)) return round
  }
  return undefined
}
