/**
 * Shared session display logic: derive the live state of any execution's
 * underlying session (across all its rounds: the original run + comments).
 * Used by execution rows, task cards, and the reminder
 * system so every surface shows the same truth.
 *
 * Pure functions — no side effects, fully unit-testable.
 */
import type { PendingInteractionKind } from './controller.ts';
import { type TaskRecord, type ExecutionRecord } from './tasks.ts';
/**
 * The live state of an execution's session (aggregating all rounds that share
 * the session: the original run and its comments).
 */
export interface SessionDisplay {
    /** The session's current state (waiting > running > latest settled). */
    state: 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled';
    /** When the session last saw activity (started or settled a round). */
    lastActivity: number | undefined;
    /** The interaction kind if the session is waiting on the user. */
    waitingKind: PendingInteractionKind | undefined;
}
/**
 * Collect every round belonging to an execution's session:
 * - Rounds with the same sessionId (comments injected into this session).
 * - Rounds whose parentExecutionId matches (comments attributed by parent
 *   rather than session — legacy data compatibility).
 * The execution itself is always included.
 */
export declare function sessionRoundsOf(task: TaskRecord, execution: ExecutionRecord): readonly ExecutionRecord[];
/**
 * Derive the live state of an execution's session from its rounds.
 * @param task - the task owning the execution.
 * @param execution - the execution whose session we're displaying.
 * @param waitingKind - the interaction kind if the session is waiting on the
 *   user (from the controller's pendingInteractionOf); undefined otherwise.
 * @param active - whether the session is still working right now: its own
 *   native turn OR a running subagent descendant it summoned (the controller's
 *   single activity derivation, session-activity.ts — never a locally
 *   re-derived flag). TRUE means the agent is working, no matter which surface
 *   started the turn (a plain run, a direct steer, a session rule, an
 *   out-of-band native chat) and no matter whose turn holds the session. Board
 *   open rounds keep their own semantics below; this only
 *   ADDS the native/lineage truth.
 */
export declare function sessionDisplay(task: TaskRecord, execution: ExecutionRecord, waitingKind: PendingInteractionKind | undefined, active?: boolean): SessionDisplay;
/**
 * The live state of a LINKED session ON one task — the session-level twin of
 * {@link sessionDisplay}, for rows whose identity is the binding rather than
 * an execution. The task's own rounds for that session ARE its activity (the
 * same plain-by-session read `sessionWindowOf` uses for the meta line): a
 * bound conversation that ran reads its settled outcome, and an open round or
 * a live native turn reads running. Priority mirrors `sessionDisplay` —
 * waiting, open, active, settled — and a binding with no rounds on this task
 * reads 未运行: there is nothing in the ledger to read, and the host session
 * row carries no outcome of its own.
 *
 * `rounds` is the plain same-session set (like `sessionWindowOf`), not an
 * execution's thread: a linked row IS the whole conversation, so every lane
 * counts — including session-anchored comment rounds an execution thread
 * deliberately excludes.
 */
export declare function linkedSessionDisplay(task: TaskRecord, sessionId: string, waitingKind: PendingInteractionKind | undefined, active: boolean): SessionDisplay;
/**
 * The time range of an execution's session (reflecting all its rounds' activity).
 * - startedAt = earliest round's start.
 * - endedAt = latest settled round's end; undefined if any round is still open.
 * - duration = endedAt - startedAt; undefined if the session is still open.
 */
export declare function sessionTimes(task: TaskRecord, execution: ExecutionRecord): {
    startedAt: number;
    endedAt: number | undefined;
    duration: number | undefined;
};
/**
 * Count how many sessions (executions) are waiting on the user.
 * Used by the task card badge to show "N 待处理" when the task has pending
 * interactions across its sessions. ONE row per waiting SESSION (deduped):
 * three executions on the same waiting session wait once, not three times —
 * the same session-keyed law the notification center already uses.
 */
export declare function taskPendingCount(task: TaskRecord, pendingInteractionOf: (sessionId: string | undefined) => PendingInteractionKind | undefined): {
    count: number;
    items: Array<{
        executionId?: string;
        sessionId: string;
        waitingKind: PendingInteractionKind;
    }>;
};
/**
 * The viewed baseline of an execution row: when the user last opened its
 * review page; absent, the run's own start (every created/normalized run
 * carries a viewedAt, so this only guards test fixtures). A stable anchor —
 * a run starts viewed at its start, its settlement (or a later comment)
 * then lights the unread dot until the review page opens.
 */
export declare function executionViewedBaseline(execution: ExecutionRecord): number;
/**
 * Whether an execution's session has content newer than the last time its
 * review page was opened: any round of the session (the run itself plus its
 * comments) with activity after the baseline. The single source for the
 * execution row's unread dot and the card's "新" badge.
 */
export declare function executionUnviewed(task: TaskRecord, execution: ExecutionRecord): boolean;
/**
 * The viewed baseline of a task card: when the user last opened the task
 * detail; absent (legacy) it equals the task's newest round activity, so
 * already-seen content stays quiet after an upgrade.
 */
export declare function taskViewedBaseline(task: TaskRecord): number;
/**
 * Whether the task has any unviewed content: any round — a run settling, a
 * comment being injected or settling — with activity newer
 * than the card's viewed baseline. Drives the card's breathing glow.
 */
export declare function taskUnviewed(task: TaskRecord): boolean;
/**
 * How many plain-run executions of the task are unviewed — the "新 N" count
 * on the card. Comment-only unread (no unviewed plain runs) shows a
 * bare "新" instead.
 */
export declare function taskUnviewedCount(task: TaskRecord): number;
/**
 * Whether ONE session of a task still owes the user a look — THE per-session
 * read clock, shared by the detail's session-row glow and the card's session
 * dot, so the two surfaces can never disagree about which conversation just
 * finished.
 *
 * ONE sentence: the session's LATEST activity is newer than the last time
 * anything of it was acknowledged. Both edges are maxima over ALL of the
 * session's rounds — plain runs, saved comments, observed native turns and
 * direct sends alike — because "this conversation produced something new"
 * does not care which lane produced it:
 *
 *  - activity = max(round.endedAt ?? round.startedAt) — an open round counts
 *    as its own start, which never beats an equal-or-later acknowledgment;
 *  - acknowledgment = max(round.viewedAt ?? round.startedAt) — rounds are
 *    born seen (their creator stamps `viewedAt`; storage backfills old rows
 *    to their own activity), and the existing funnels move it forward
 *    (review page open, 标已读 单·组·全部, approve, notification per-session
 *    open). An unstamped round falls back to its start: activity after an
 *    acknowledgment nobody recorded is exactly what should glow.
 *
 * It never writes; opening the task DETAIL does not clear it (reading the
 * list is not acknowledging the conversation — the card ring keeps its own,
 * coarser task-level clock).
 */
export declare function sessionUnviewedOf(task: TaskRecord, sessionId: string): boolean;
