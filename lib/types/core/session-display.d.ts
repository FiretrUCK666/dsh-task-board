/**
 * Shared session display logic: derive the live state of any execution's
 * underlying session (across all its rounds: the original run + comments +
 * refine rounds). Used by execution rows, task cards, and the reminder
 * system so every surface shows the same truth.
 *
 * Pure functions — no side effects, fully unit-testable.
 */
import type { PendingInteractionKind } from './controller.ts';
import { type TaskRecord, type ExecutionRecord } from './tasks.ts';
/**
 * The live state of an execution's session (aggregating all rounds that share
 * the session: the original run, comments, and any refine rounds).
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
 * - Rounds with the same sessionId (comments injected into this session,
 *   refine rounds using the same refine session).
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
 *   open rounds and refine rounds keep their own semantics below; this only
 *   ADDS the native/lineage truth.
 */
export declare function sessionDisplay(task: TaskRecord, execution: ExecutionRecord, waitingKind: PendingInteractionKind | undefined, active?: boolean): SessionDisplay;
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
 * Count how many sessions (executions + refine) are waiting on the user.
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
 * comment being injected or settling, a refine turn — with activity newer
 * than the card's viewed baseline. Drives the card's breathing glow.
 */
export declare function taskUnviewed(task: TaskRecord): boolean;
/**
 * How many plain-run executions of the task are unviewed — the "新 N" count
 * on the card. Comment/refine-only unread (no unviewed plain runs) shows a
 * bare "新" instead.
 */
export declare function taskUnviewedCount(task: TaskRecord): number;
