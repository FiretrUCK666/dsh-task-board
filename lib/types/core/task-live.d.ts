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
 * "Related" is defined ONCE here: every bound session source, every
 * execution-round session and every live linked (workspace)
 * session — one de-duplicated, stable-ordered set. Every surface that asks
 * the live question reads this same set, so a workspace-bound card can never
 * go dark while one of its bound workspace's sessions is genuinely running
 * (the "行显示进行中、卡片不动" bug).
 */
import type { ExecutionRecord, TaskRecord, TaskStatus } from './tasks.ts';
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
export type TaskLiveState = 'running' | 'waiting' | 'idle' | 'unknown';
/** The classify facts a caller supplies for the derived set's rows. */
export interface RelatedSessionFact {
    sessionId: string;
}
/**
 * THE related-session set of a task (de-duplicated, stable order — binds
 * first, then execution rounds, then injected linked ids; the same order
 * every consumer has always read):
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
 *
 * ── AND SO IS EXISTENCE, WHICH IS THE SECOND HALF OF THE SAME GATE ──────────
 *
 * 一个读者数得出来的偏差：**卡片外面显示的会话数比实际多**——他删掉了不少会话，而那个数
 * 一直比屏上的会话多。根因就在这里：这个集合有三个来源，而**只有第三个**（`linkedSessionIds`，由
 * `linkedSessionIdsOf` 从工作区快照派生）在路上做过存在性检查。另外两条——绑定与轮次——
 * 只要 id 写进过那张卡，就永远算一条相关会话；会话本体被删掉，它们照旧被数进去，
 * 于是圆点与 `+N` 比屏上实际存在的会话多。
 *
 * 所以存在性检查提到**这一个函数里来**，与 `removedSessions` 并列、对每个来源一视同仁：
 * 一个集合的成员资格只能有一个答案，而「这条会话在不在」是它的一半。
 * `isPresentOf` 由调用方注入（控制器读 `sessionAvailability`——那里有归档/删除/快照三件事
 * 合起来的那一个判据）；不传时**不过滤**，因为一个看不见会话表的调用者无权把「我看不见」
 * 说成「不存在」——这与「读不到」不许画成「空」是同一条规矩。
 * @param task - the task owning the sessions.
 * @param linkedSessionIds - the task's live linked-session ids (the
 *   controller derives them from the workspaces face; undefined = skip).
 * @param isPresentOf - whether a session still EXISTS, when the caller can tell.
 *   **必填，而且可以显式是 `undefined`。** 它必填：做成可选参数，忘掉它不会有任何声音——
 *   一处不传，一条**已经被删除**的会话就仍然能让卡片停在「等你处理」，而屏上没有任何东西
 *   说这件事。必填之下，每一个调用点都必须**写出它的判决**（能看就说能看，看不见就写
 *   `undefined`），而「看不见」仍然不等于「不存在」。
 */
export declare function relatedSessionIdsOf(task: TaskRecord, linkedSessionIds: readonly string[] | undefined, isPresentOf: ((sessionId: string) => boolean) | undefined): RelatedSessionFact[];
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
export declare function taskLiveStateOf(task: TaskRecord, isActiveOf: (sessionId: string) => boolean, waitingOf: (sessionId: string) => unknown, opts?: {
    linkedSessionIds?: readonly string[];
    isKnownOf?: (sessionId: string) => boolean;
    /** Whether a related session still EXISTS — see {@link relatedSessionIdsOf}. */
    isPresentOf?: (sessionId: string) => boolean;
}): TaskLiveState;
/**
 * Why a `running`-column card is allowed to keep its column — THE one
 * leave-running judgment behind every non-settle exit (session deletion,
 * the reconcile orphan sweep, the direct-steer fallback). The settled
 * exits keep their own decision (`settleColumnOf`): they record an outcome
 * first, then decide; the exits here decide on the CURRENT facts only.
 *
 * One three-way justification, read in order:
 * - `'open'` — an in-flight execution round: real work is still running on
 *   this card;
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
 * THE re-entry judgment — the mirror of {@link leaveRunningTargetOf}, and the
 * half that did not exist.
 *
 * ── WHY THIS IS NOT A PATCH ────────────────────────────────────────────────
 *
 * The column has writers in ONE direction only. Rounds SETTLE (and
 * `settleColumnOf` decides where they land); {@link leaveRunningTargetOf}
 * empties a `running` card whose evidence is gone. Nothing ever wrote a card
 * BACK into 进行中 once it had left, so a card could sit in 待审核 while real
 * work was still in flight under it — the reported state: the main agent had
 * handed the job to a subagent, its own turn ended, the card landed in 待审核,
 * and the subagent kept working for another 40 minutes with the board saying
 * 「待你决断」.
 *
 * Why the settle path cannot catch it: a settle judges with the facts of ITS
 * OWN instant (`settleExecution`'s `stillWorking`). The main agent stops and
 * dispatches in the same breath, so at that instant the descendant often has
 * not flipped `running` yet. One frame later it has — and by then the card is
 * no longer `running`, so the leave sweep does not consider it either. The
 * window between "the round ended" and "the child started" is the hole, and it
 * is unavoidable in the settle direction: no reader can predict a subagent
 * that has not been spawned yet.
 *
 * So the fix is the missing direction, not a stricter settle. The facts are the
 * same facts; only the writer was absent.
 *
 * ── WHY THE `delegating` GATE, AND NOT "any live session" ──────────────────
 *
 * `delegating` (主 Agent 停了、子 Agent 还在跑) is the ONE lane with no writer
 * of its own. Every other lane already drives the column on its own path: a
 * native turn becomes an external round (`recordExternalRound` → 进行中), a
 * steer is driven by `driveLiveStates`, a run/appointment has its settle. Only
 * "the parent stopped and left its children working" arrives with no round and
 * no event, so only that one needs this door. Widening it to every live
 * session would fight the user's own manual placement, which the board
 * deliberately allows whenever no round is in flight (`resolveCardDrop`).
 *
 * `live` must be `'running'` — POSITIVE evidence. `'unknown'` is never a
 * verdict (the same law as everywhere else in this file), and `'waiting'`
 * means a conversation is suspended on the human, which is not this door's
 * business.
 *
 * @param task - the card, read for its current column.
 * @param live - the caller's ONE live derivation (`taskLiveStateOf`).
 * @param opts.delegating - whether a related session is working ONLY through
 *   its subagent descendants (some related session's activity is `'descendant'`).
 * @returns `'running'` when the card must re-enter, undefined when it stays.
 */
export declare function reenterRunningTargetOf(task: TaskRecord, live: TaskLiveState, opts?: {
    delegating?: boolean;
}): TaskStatus | undefined;
/**
 * Whether a round is "direct-like": a direct steer round is settled at birth
 * and has NO host turn/end settle event — its completion is only visible as
 * the native session flipping back to idle, so the controller's fallback has
 * to judge it. Board execution rounds, injected comment rounds and
 * externally-observed rounds all have their own event paths and
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
