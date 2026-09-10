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
 * - refined: requirement-refinement rounds (running/settled, never move columns);
 * - waiting: LIVE derived (pendingInteractionOf) — not ledger history.
 * Pure and framework-free so every consumer unit-tests in isolation.
 */
import type { PendingInteractionKind } from './controller.ts';
import { type TaskRecord } from './tasks.ts';
/** What happened. */
export type BoardEventKind = 'created' | 'run' | 'comment' | 'external' | 'direct' | 'refined' | 'waiting';
/** Lifecycle of the moment. */
export type BoardEventState = 'queued' | 'running' | 'settled';
/** One feed/notification moment. */
export interface BoardEvent {
    /** Stable row key (task + moment + state). */
    key: string;
    taskId: string;
    taskTitle: string;
    kind: BoardEventKind;
    state: BoardEventState;
    /** Moment instant (createdAt/startedAt/injectedAt/endedAt/task.updatedAt). */
    at: number;
    /** Settled outcome (run/comment/external/refined only, when settled). */
    result?: 'succeeded' | 'failed' | 'cancelled';
    /** Comment/direct/external text excerpt source (trimmed, may be empty). */
    text?: string;
    /** Related native session (run/comment/external/direct/waiting). */
    sessionId?: string;
    /** Automation rule that created the round (comment/external with ruleId). */
    ruleId?: string;
    /** Waiting kind (waiting events only). */
    waitingKind?: PendingInteractionKind;
    /** Whether the moment is newer than the card's viewed baseline. */
    unviewed?: boolean;
}
/** Context the derivation reads (all injected so core stays framework-free). */
export interface BoardEventContext {
    /** Live waiting signal (native amber dot). */
    pendingOf?: (sessionId: string | undefined) => PendingInteractionKind | undefined;
    /** Card viewed baseline (taskUnviewed grammar lives in session-display to
     *  avoid a core→client import cycle; callers pass the instant). */
    viewedBaselineOf?: (task: TaskRecord) => number;
    /** Resolve a session id to its display title (notifications only). */
    titleOf?: (sessionId: string) => string;
    /** Live linked-session ids per task (bound workspace members). When absent,
     *  waiting falls back to refine + binds + execution rounds (legacy). */
    linkedIdsOf?: (task: TaskRecord) => readonly string[];
}
/**
 * Collect every moment of every task, newest first (no cap — callers slice).
 * Running rounds ARE moments (started/observed/injected) — the old activity
 * feed skipped them, which hid "who is working now" from history. Empty
 * comment bodies are kept as moments (the row shows a placeholder) except
 * when the caller filters them — the derivation never drops facts.
 */
export declare function boardEventsOf(tasks: readonly TaskRecord[], ctx?: BoardEventContext): BoardEvent[];
/** Day bucket key (local calendar day) for activity grouping — pure. */
export declare function dayBucketOf(at: number): string;
/**
 * Group events into day buckets (newest day first, events newest-first
 * inside). Pure — the view renders one section per bucket.
 */
export declare function groupEventsByDay(events: readonly BoardEvent[]): Array<{
    day: string;
    items: BoardEvent[];
}>;
