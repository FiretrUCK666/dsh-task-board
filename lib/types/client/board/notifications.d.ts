/**
 * Notification center aggregation: every session across every task that is
 * currently waiting on the user (approval / plan-review / question) plus
 * unviewed review results (failed/succeeded awaiting the human gate) — one
 * row per waiting session / per review task, newest first. Read-only:
 * clicking a row opens the task detail (the detail owns sessions, answers
 * and navigation), so the center never duplicates a surface that already
 * exists.
 *
 * Three clocks, never mixed:
 * - the ROUND clock (`note.at`): the round's own activity (started→ended) —
 *   the ledger fact, stable across metadata writes;
 * - the ARRIVAL clock: when THIS browser first saw the row (the board's own
 *   eyes — a memory-state `key → firstSeen` map in TaskBoard). A run that
 *   waits late in a long turn must sort by its arrival, never by the round's
 *   start, or "just arrived" reads as ten minutes old. Absent an arrival
 *   reader (legacy callers/tests) the rows keep their ledger clock;
 * - the WATERLINE (`drawerOpenedAt` in TaskBoard): what the user last saw —
 *   arrivals after it light the bell's "just arrived" dot.
 *
 * Row grammar for waiting rows: signal (waitingKind) + content (excerpt) +
 * answer affordance (go-answer vs go-session). A row carrying a readable
 * question/plan body is CONTENT; a proven wait with no readable body is a
 * SHELL (kind + honest missing-body line + navigate) — never blank silence
 * (see `awaitingOf` in question-mirror.ts, the same backstop one layer down).
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
    /**
     * One-line content preview of the wait (waiting rows only): a plan's body
     * (detail, falling back to its question line) or a question batch's first
     * question. Plain text, never Markdown — the row is a scan line, not a
     * document. Absent = shell (proven wait, unreadable body) or review row.
     */
    excerpt?: string;
    /**
     * Whether the row can land on an in-board answer card (a readable
     * question/plan carrier whose host exposes answer/cancel). True = the row
     * offers 「去回答」; false/absent = 「去会话」 only (approvals can never be
     * answered in-board; a shell has no body to answer).
     */
    answerable?: boolean;
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
 * The waiting body the board can quote on a row: a plan-review batch quotes
 * its plan (detail, falling back to the question line); a question batch
 * quotes its first question. THE one excerpt grammar — every waiting row
 * (drawer, folded members) reads the same body the in-board answer card
 * answers, so the row can never promise content the card does not hold.
 */
export interface WaitingBody {
    /** The quoted body (plan detail / plan question / first question). */
    text: string;
    /** True when the body IS a plan under review (plan card grammar). */
    isPlan: boolean;
}
/** Row-excerpt budget: a notification row is a scan line, not a document. */
export declare const WAITING_EXCERPT_BUDGET = 60;
/** Trim a waiting body to the row budget (whitespace-collapsed, one line). */
export declare function waitingExcerptOf(text: string, budget?: number): string;
/** Pick the quotable body of one open question batch (pure, testable). */
export declare function waitingBodyOf(question: {
    questions: readonly {
        question: string;
        detail?: string;
        intent?: {
            kind: string;
        };
    }[];
    isPlanReview: boolean;
} | undefined): WaitingBody | undefined;
/** Waiting-row content supplied by the board's question faces (all optional —
 *  absent = today's signal-only rows; the legacy callers/tests never pass it). */
export interface WaitingContentFace {
    /** The open question/plan batch for one session (mirror or tracker). */
    questionOf?: (sessionId: string | undefined) => {
        questions: readonly {
            question: string;
            detail?: string;
            intent?: {
                kind: string;
            };
        }[];
        isPlanReview: boolean;
    } | undefined;
    /** Whether the board can settle a carrier in place right now. */
    answerInPlace?: boolean;
}
/**
 * Full three-tier view: waiting sessions first (newest task first), then
 * unviewed review tasks (failed before succeeded, newest settle first).
 * `isUnviewed` decides the review tier (the board passes `taskUnviewed`);
 * absent/false = waiting-only (legacy behavior). `linkedIdsOf` supplies live
 * linked-session ids per task so a bound-but-never-run waiting session still
 * notifies (same related set as the live state).
 *
 * Waiting rows sort by the ARRIVAL clock when `arrivedAt` is supplied (the
 * board's first-seen map), falling back to the round clock for legacy
 * callers. Review rows always sort by their settle clock.
 */
export declare function notificationsExOf(tasks: readonly TaskRecord[], pendingOf: (sessionId: string | undefined) => PendingInteractionKind | undefined, titleOf: (sessionId: string) => string, isUnviewed?: (task: TaskRecord) => boolean, linkedIdsOf?: (task: TaskRecord) => readonly string[], content?: WaitingContentFace, arrivedAt?: (note: Pick<NotificationItem, 'taskId' | 'sessionId' | 'kind'>) => number | undefined): NotificationItem[];
/**
 * What the board owes the user, stated as one fact for the whole surface.
 *
 * The bell's badge counts ROWS (folded by task), and a column header counts
 * CARDS — two numbers that measure different things and, on screen, never
 * reconcile. Neither of them answers the question the board exists to answer
 * (「等我做什么」), and a card that has been glanced at drops out of the bell
 * entirely. This derivation is that answer, and it is deliberately independent
 * of `viewedAt`:
 *
 *  - `waiting` is a live block: an agent suspended on approval / plan / question.
 *  - `review` is the human gate: a task sitting in review with a settled run.
 *    Once looked at it stops BREATHING (that is the unread signal, and it stays
 *    honest) but it is not resolved until a human passes or sends it back — so
 *    it keeps counting here. This is the split the board was missing: five
 *    cards can wait in review while the only visible demand is an 11px digit.
 *
 * Pure, so the header row and the tests read the same number.
 */
export interface BoardDemand {
    /** Total items awaiting a human: waiting sessions + review tasks. */
    total: number;
    /** Sessions currently suspended on a question / approval / plan. */
    waiting: number;
    /** Tasks in review whose latest plain run has settled. */
    review: number;
}
export declare function boardDemandOf(tasks: readonly TaskRecord[], pendingOf: (sessionId: string | undefined) => PendingInteractionKind | undefined, linkedIdsOf?: (task: TaskRecord) => readonly string[]): BoardDemand;
/**
 * The arrival clock's pure half (TaskBoard owns the memory map; this owns
 * the merge grammar): stamp every unseen waiting key at `now`, drop keys
 * that left the board, keep first-seen for the rest. The review tier never
 * enters this map — its settle clock is already an arrival-grade instant.
 * @returns the merged map (a fresh instance — the caller's state stays immutable).
 */
export declare function stampWaitingArrivals(seen: ReadonlyMap<string, number>, notes: readonly Pick<NotificationItem, 'taskId' | 'sessionId' | 'kind'>[], now: number): Map<string, number>;
/** Read one row's arrival instant (missing key = unknown, never 0). */
export declare function arrivalOf(seen: ReadonlyMap<string, number>, note: Pick<NotificationItem, 'taskId' | 'sessionId' | 'kind'>): number | undefined;
/** One folded task entry: the head row plus every row sharing its task. */
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
