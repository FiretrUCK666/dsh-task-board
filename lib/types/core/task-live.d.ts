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
import type { ExecutionRecord, TaskRecord, TaskStatus } from './tasks.ts';
/** The live question's answer. */
export type TaskLiveState = 'running' | 'waiting' | 'idle';
/** The classify facts a caller supplies for the derived set's rows. */
export interface RelatedSessionFact {
    sessionId: string;
    /** True only for the task's own refine session. */
    refine: boolean;
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
export declare function relatedSessionIdsOf(task: TaskRecord, linkedSessionIds?: readonly string[]): RelatedSessionFact[];
/**
 * The one live-state derivation:
 * - waiting — any related session is pending on the user (approval /
 *   plan-review / question); the human's turn outranks everything;
 * - running — any related session reports `running` (the agent is working);
 * - idle — otherwise.
 * Sources are injected callbacks so the module stays framework-free and
 * unit-testable; the controller wires the native list snapshot.
 */
export declare function taskLiveStateOf(task: TaskRecord, isRunningOf: (sessionId: string) => boolean, waitingOf: (sessionId: string) => unknown, linkedSessionIds?: readonly string[]): TaskLiveState;
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
 * - `'live'` — a related session genuinely working right now (native truth);
 * - `'schedule'` — an armed schedule whose next automatic run is still to
 *   come keeps the card parked in `running` between runs (the budgeted
 *   batch/chain gap — the same continuation `settleExecution` grants on a
 *   succeeded settle).
 * `undefined` = the card is an orphan: no evidence for `running` anywhere,
 * and it must leave (where to is `leaveRunningTargetOf`).
 */
export type RunningJustification = 'open' | 'live' | 'schedule';
/** The schedule-continuation half of the justification above: an armed rule
 *  whose budget still has a run left (chain and budgeted cron share one
 *  shape here — the settle path reads the same two counters, only adjusted
 *  for when each path increments them, see the branches). Unbudgeted cron
 *  never holds the column: a cron with no `maxRuns` keeps nothing pending
 *  between fires, so its card settles to review like any plain run. */
export declare function scheduleGapHolds(task: TaskRecord): boolean;
/**
 * The single leave-`running` judgment: why the card may stay, undefined when
 * it must leave. `live` is the native truth (`taskLiveStateOf` on the same
 * related set the caller renders from). `ignoreSchedule` drops the schedule
 * leg — a deletion that removed in-flight work is a cancellation (the work
 * is gone, there is nothing to continue), never a batch gap.
 */
export declare function runningJustificationOf(task: TaskRecord, live: TaskLiveState, opts?: {
    ignoreSchedule?: boolean;
}): RunningJustification | undefined;
/**
 * Where a `running`-column card with NO justification leaves to — the
 * cancellation semantics of `settleColumnOf` (a card holding completed work
 * keeps its human gate in review, otherwise it returns to the queue).
 * `undefined` = the card stays (either it is not in `running`, or one of
 * the three legs above still holds it).
 */
export declare function leaveRunningTargetOf(task: TaskRecord, live: TaskLiveState, opts?: {
    ignoreSchedule?: boolean;
}): TaskStatus | undefined;
/**
 * Whether a round is "direct-like": a direct steer round is settled at birth
 * and has NO host turn/end settle event — its completion is only visible as
 * the native session flipping back to idle, so the controller's fallback has
 * to judge it. Board execution rounds, injected comment rounds, refinement
 * rounds and externally-observed rounds all have their own event paths and
 * are never fallback material.
 */
export declare function isDirectLike(round: ExecutionRecord | undefined): boolean;
/** The fallback column for a finished direct-like round: a steer that ran to
 *  completion lands in 待审核 (a human gate, exactly like a successful run). */
export declare const DIRECT_FALLBACK_STATUS: "review";
/**
 * The task's newest direct-like round, or undefined. A direct round is
 * settled at birth, so it is never "the last row" for long — under
 * per-session lanes any later append (a saved comment on another conversation,
 * an observed native turn) slips past a `latestExecutionOf` check and the
 * steer's completion would never be seen. Searching from the end keeps the
 * judgment about ONE round (the newest steer) while making its position in the
 * array irrelevant.
 */
export declare function newestDirectLike(task: TaskRecord): ExecutionRecord | undefined;
