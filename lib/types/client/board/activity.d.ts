/**
 * Board activity feed: the recent notable moments of every task in one
 * read-only list (creations, starts, settlements, queued/running/settled
 * comments, external observations, direct sends, refine turns — newest
 * first, capped). DERIVED from the snapshot on every render, never stored:
 * a journal would be new synced state (merge grammar, migration), while the
 * moments themselves already live in the ledger (createdAt, startedAt,
 * endedAt, comment bodies). Clicking a row opens the task detail — the feed
 * owns no surface of its own.
 *
 * Pure and framework-free so the derivation unit-tests in isolation. The
 * rich derivation lives in `core/board-events.ts`; this module is the thin
 * feed adapter (filter + cap) so notifications/activity/cards share one
 * truth.
 */
import { type BoardEventState } from '../../core/board-events.ts';
import type { TaskRecord } from '../../core/tasks.ts';
/** Cap: the feed is a glance, not an archive (older moments live on cards). */
export declare const ACTIVITY_LIMIT = 50;
/** One feed row: what happened, where, when. */
export interface ActivityItem {
    /** Stable row key (task + moment). */
    key: string;
    taskId: string;
    taskTitle: string;
    kind: 'created' | 'settled' | 'comment' | 'refined' | 'started' | 'queued' | 'running' | 'direct' | 'external';
    /** Settled outcome (only for settled moments). */
    result?: 'succeeded' | 'failed' | 'cancelled';
    /** Comment/refine/direct text excerpt source. */
    text?: string;
    at: number;
    /** Lifecycle of the moment (queued/running/settled). */
    state?: BoardEventState;
    /** Related native session (run/comment/external/direct). */
    sessionId?: string;
}
/** Feed filter (all local UI state — never synced). */
export interface ActivityFilter {
    kinds?: ReadonlyArray<ActivityItem['kind']>;
    onlyUnviewed?: boolean;
    query?: string;
}
/** Fold cluster: the same three groups the feed filter offers (all/run/
 *  comment/other), so a group never straddles a filter switch — filtering to
 *  `run` drops whole comment/other groups instead of hollowing them out. */
export type ActivityCluster = 'run' | 'comment' | 'other';
/** The cluster partition, ONE table: `clusterOf` derives from it and the
 *  Dialog's filter map reads it, so a new row kind changes exactly one place. */
export declare const CLUSTER_KINDS: Record<ActivityCluster, readonly ActivityItem['kind'][]>;
/** Map one row kind onto its fold cluster (derived from the single table). */
export declare function clusterOf(kind: ActivityItem['kind']): ActivityCluster;
/** One folded object-day group: same task, same calendar day, same cluster.
 *  Order inside and across groups inherits the feed order (newest first) —
 *  grouping never re-sorts, it only nests. */
export interface ActivityGroup {
    /** Stable group key (task + day + cluster, see {@link activityGroupKeyOf}). */
    key: string;
    taskId: string;
    taskTitle: string;
    day: string;
    cluster: ActivityCluster;
    items: ActivityItem[];
}
/** THE group-key constructor (`task|day|cluster`): grouping, expansion state
 *  and remainder keys all derive from this one function — never a retyped
 *  template — so folded identity can never disagree with itself. */
export declare function activityGroupKeyOf(taskId: string, day: string, cluster: ActivityCluster): string;
/** THE remainder-row key for a folded group: `groupKey + '|rest'` — one
 *  constructor beside the group key, so the two can never drift apart
 *  (notification folds reuse it with their task-scoped key). */
export declare function remainderKeyOf(groupKey: string): string;
/**
 * Fold feed rows into object-day groups (GetStream-style aggregation keyed on
 * object × day, with the filter cluster as the third leg). Single-item groups
 * render exactly like unfolded rows, so sparse feeds look byte-identical to
 * before — only genuinely busy object-days gain a header. Pure: no truncation
 * here (caps stay at the feed/window layer), no unread marking (feed rows
 * carry no unread signal by contract — unread breathes on the card only).
 */
export declare function groupActivityByObjectDay(items: readonly ActivityItem[], dayOf: (at: number) => string): ActivityGroup[];
/** Cap: an expanded group shows this many newest rows; the rest reads as one
 *  quiet remainder line (navigation stays on the group header's 进详情 — the
 *  remainder is information, never a second toggle). */
export declare const GROUP_ITEM_LIMIT = 10;
/**
 * Split a live newest-first feed into the frozen window and the queued
 * remainder: the view shows the oldest `base` rows (what was on screen when
 * the drawer opened or the pill was last tapped); newer arrivals queue behind
 * the pill instead of shoving the rows being read. A negative base means
 * "unfrozen" (first frame, filter mid-typing): the whole live list shows
 * with zero queued, so the freeze engaging a beat later changes nothing
 * visible. Shrinking feeds clamp to the whole list. Pure.
 */
export declare function freezeFeed<T>(live: readonly T[], base: number): {
    frozen: T[];
    fresh: number;
};
/**
 * Split a group's rows into the shown head and the folded remainder count.
 * Generic over the row shape (feed rows and notification rows share the cap
 * discipline, never a second copy): the header always counts the full group
 * (the count never lies about the cap). The limit normalizes defensively
 * (non-finite → the default cap, negatives → 0, fractions → floor): an open
 * generic must never lie about counts no matter who calls it next. Pure so
 * the cap unit-tests without rendering.
 */
export declare function splitGroupItems<T>(items: readonly T[], limit?: number): {
    shown: T[];
    rest: number;
};
/**
 * Collect every notable moment of every task, newest first. Running rounds
 * ARE moments (their start/observation/injection lights the feed); an empty
 * comment body stays (the row shows a placeholder) — the view decides
 * trimming, never the derivation.
 */
export declare function activityOf(tasks: readonly TaskRecord[], filter?: ActivityFilter, isUnviewed?: (task: TaskRecord, at: number) => boolean): ActivityItem[];
