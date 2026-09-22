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
/** Feed cluster: the same three kinds the feed filter offers (all/run/
 *  comment/other), so a filter switch keeps or drops whole kinds — it never
 *  hollows out a row's meaning mid-kind. */
export type ActivityCluster = 'run' | 'comment' | 'other';
/** The cluster partition, ONE table: `clusterOf` derives from it and the
 *  Dialog's filter map reads it, so a new row kind changes exactly one place. */
export declare const CLUSTER_KINDS: Record<ActivityCluster, readonly ActivityItem['kind'][]>;
/** Map one row kind onto its fold cluster (derived from the single table). */
export declare function clusterOf(kind: ActivityItem['kind']): ActivityCluster;
/** Cap: an expanded task fold shows this many newest rows; the rest reads as
 *  one quiet remainder line (navigation stays on the fold header — the
 *  remainder is information, never a second toggle). */
export declare const FOLD_ITEM_LIMIT = 10;
/** THE fold-key constructor (`task|day`): the fold's expansion state, its
 *  member-list id and its remainder row all derive from this one function —
 *  never a retyped template. */
export declare function activityFoldKeyOf(taskId: string, day: string): string;
/** THE remainder-row key for one fold: `foldKey + '|rest'`. */
export declare function foldRestKeyOf(foldKey: string): string;
/** One task fold inside a day: same task, same calendar day. */
export interface ActivityTaskFold {
    /** Stable fold key (`task|day`, see {@link activityFoldKeyOf}). */
    key: string;
    taskId: string;
    taskTitle: string;
    /** The fold's rows, feed order preserved (newest first). */
    items: ActivityItem[];
}
/**
 * Fold one day's rows by TASK — the drawer's day header already owns the day
 * leg, so this adds only the object leg ("which cards moved today", one
 * chevron each). Feed order in, feed order out; grouping never re-sorts, it
 * only nests. Cluster is deliberately NOT a leg: a filter keeps or drops
 * whole kinds per row, so a filtered fold can never go hollow. The render
 * layer shows single-row folds as bare rows (sparse days look unchanged).
 */
export declare function foldFeedByTaskDay(items: readonly ActivityItem[], dayOf: (at: number) => string): ActivityTaskFold[];
/** One session's rows inside an expanded fold (undefined = session-less
 *  moments such as task creation — they render under no header). */
export interface ActivitySessionSection {
    sessionId?: string;
    items: ActivityItem[];
}
/**
 * Bucket a fold's rows BY SESSION: sessions appear in the order of their
 * newest row (first appearance in the newest-first feed), rows keep their
 * order inside each bucket. Session-less moments form their own leading-or-
 * wherever bucket per the same first-appearance rule — no special case.
 */
export declare function sectionFoldBySession(items: readonly ActivityItem[]): ActivitySessionSection[];
/**
 * Split a fold's rows into the shown head and the folded remainder count:
 * the first N newest show, the rest count. The limit normalizes defensively
 * (non-finite → the cap, negatives → 0, fractions → floor): an open generic
 * must never lie about counts. Pure so the cap unit-tests without rendering.
 */
export declare function splitFoldItems<T>(items: readonly T[], limit?: number): {
    shown: T[];
    rest: number;
};
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
 * Collect every notable moment of every task, newest first. Running rounds
 * ARE moments (their start/observation/injection lights the feed); an empty
 * comment body stays (the row shows a placeholder) — the view decides
 * trimming, never the derivation.
 */
export declare function activityOf(tasks: readonly TaskRecord[], filter?: ActivityFilter, isUnviewed?: (task: TaskRecord, at: number) => boolean): ActivityItem[];
