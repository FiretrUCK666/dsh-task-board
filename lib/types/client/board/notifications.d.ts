/**
 * Notification center aggregation: every session across every task that is
 * currently waiting on the user (approval / plan-review / question) plus
 * unviewed review results (failed/succeeded awaiting the human gate) — one
 * row per waiting session / per review task, newest first. Read-only:
 * clicking a row opens the task detail (the detail owns sessions, answers
 * and navigation), so the center never duplicates a surface that already
 * exists.
 *
 * Pure and framework-free (the pending signal arrives as a callback), so the
 * aggregation unit-tests in isolation; TaskBoard supplies the live faces.
 * `notificationsOf` stays waiting-only (legacy callers/tests); the board
 * reads `notificationsExOf` for the full three-tier view.
 */
import type { PendingInteractionKind } from '../../core/controller.ts';
import { type TaskRecord } from '../../core/tasks.ts';
/** One notification row (waiting session or unviewed review task). */
export interface NotificationItem {
    taskId: string;
    taskTitle: string;
    sessionId: string;
    sessionTitle: string;
    /** Waiting kind (waiting rows only; review rows leave it undefined). */
    waitingKind?: PendingInteractionKind;
    /** Tier: waiting outranks review (the bell counts both, waiting first). */
    kind: 'waiting' | 'review';
    /** Review outcome (review rows only). */
    result?: 'succeeded' | 'failed' | 'cancelled';
    /** Moment instant: waiting rides the round's own activity clock
     *  (started→ended), review rides its settle — never task.updatedAt, so
     *  metadata writes (recolor, reorder, cruise toggles) cannot reorder the
     *  bell, fake arrivals, or poison the unseen waterline. */
    at: number;
}
/** THE row key (`task|session|kind`): snooze stamps, drawer keys and the
 *  unseen set all derive from this one constructor — never a retyped
 *  template, so the three can never disagree on identity. */
export declare function noteKeyOf(note: Pick<NotificationItem, 'taskId' | 'sessionId' | 'kind'>): string;
/**
 * Collect every waiting session of every task, deduplicated by
 * task+session (an execution round and the refine round can name the same
 * session — it waits once, not twice). A session without a waiting signal
 * is not a notification, however busy it is.
 */
export declare function notificationsOf(tasks: readonly TaskRecord[], pendingOf: (sessionId: string | undefined) => PendingInteractionKind | undefined, titleOf: (sessionId: string) => string): NotificationItem[];
/**
 * Full three-tier view: waiting sessions first (newest task first), then
 * unviewed review tasks (failed before succeeded, newest settle first).
 * `isUnviewed` decides the review tier (the board passes `taskUnviewed`);
 * absent/false = waiting-only (legacy behavior). `linkedIdsOf` supplies live
 * linked-session ids per task so a bound-but-never-run waiting session still
 * notifies (same related set as the live state).
 */
export declare function notificationsExOf(tasks: readonly TaskRecord[], pendingOf: (sessionId: string | undefined) => PendingInteractionKind | undefined, titleOf: (sessionId: string) => string, isUnviewed?: (task: TaskRecord) => boolean, linkedIdsOf?: (task: TaskRecord) => readonly string[]): NotificationItem[];
/** One folded task entry: the head row plus every row sharing its task.
 *  The bell and the drawer read the same folded list, so the badge always
 *  equals the visible row count ("collapsed counts one" — a folded group of
 *  three reads 1, never 3). Order inherits the unfolded order. */
export interface FoldedNotification {
    head: NotificationItem;
    /** Every row in this head's task (head first). */
    items: NotificationItem[];
    /** Rows folded into this head (items.length — 1 is unfolded and renders
     *  exactly as before). */
    count: number;
}
/**
 * Fold notification rows by task (same-task rows share one head — the first,
 * which the waiting-first ordering already ranked loudest). Pure view-layer
 * grouping: `notificationsExOf` keeps its signature so existing callers and
 * tests never change; the bell badge and the drawer list fold the same way.
 */
export declare function foldNotesByTask(notes: readonly NotificationItem[]): FoldedNotification[];
