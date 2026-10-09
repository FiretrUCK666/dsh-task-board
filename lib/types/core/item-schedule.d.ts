/**
 * The agenda: eight named buckets that answer "what is on me".
 *
 * WHY IT IS A LIST AND NOT A GRID. An agenda of personal work is a list. A grid
 * needs a time of day to give a row a position on an axis, and this model has
 * none — inventing "09:00" for a bare date and then rendering it is a lie the
 * reader has to learn to ignore. So the buckets exist so the list answers one
 * question, and the two that answer a different question — nothing scheduled,
 * and not yet startable — are NAMED CONTAINERS rather than absences, for the same
 * reason an empty group keeps its header: a reader who cannot see where a row
 * went will assume it was lost.
 *
 * THE DAY BOUNDARY IS {@link startOfDay}, shared with the capture box and with
 * every other day in the product. It used to be written out here as well, which
 * is how a local-midnight rule ends up with two copies that are right until one
 * of them is edited.
 */
import type { ItemRecord } from './item.ts';
import { type ItemSort } from './item-sort.ts';
import { type ItemMatchContext, type ItemQuery } from './item-query.ts';
import type { TaskStatus } from './tasks.ts';
/**
 * The agenda's buckets, in the order they read.
 *
 * The set is FIXED and complete. Adding a bucket to the model adds a column to
 * every reader's agenda for a case nobody has, and a page that grows columns
 * under demand is a page nobody scans.
 */
export declare const SCHEDULE_BUCKETS: readonly ["hardOverdue", "behind", "today", "tomorrow", "week", "later", "undated", "gated"];
export type ScheduleBucketId = typeof SCHEDULE_BUCKETS[number];
/** One bucket of the agenda. */
export interface ScheduleBucket {
    readonly id: ScheduleBucketId;
    readonly items: readonly ItemRecord[];
    /**
     * The day this bucket is about, when it is about one: a date the reader can
     * point at, not a label to re-derive. `undefined` for the buckets that are
     * not about a day.
     */
    readonly day: number | undefined;
}
/**
 * Which agenda bucket a row belongs to.
 *
 * A gated row never reaches a day bucket: it is not late, it is not due, it is
 * not startable, and showing it beside today's work is a lie about what can be
 * done today. A row whose own dates contradict each other is placed by the date
 * it does have, so it stays on the agenda to be fixed rather than vanishing
 * from it.
 * @param item - the row.
 * @param now - the reading clock.
 * @returns the bucket id.
 */
export declare function scheduleBucketOf(item: ItemRecord, now: number): ScheduleBucketId;
/**
 * Fill the agenda: every bucket, in reading order, rows ordered within.
 * @param items - every row in the document.
 * @param query - the parsed filter.
 * @param ctx - the clock, the threshold and the board's live state.
 * @param sort - the ordering within a bucket.
 * @returns one entry per bucket, empty buckets included.
 */
export declare function scheduleBucketsOf(items: readonly ItemRecord[], query: ItemQuery, ctx: ItemMatchContext & {
    readonly cards: ReadonlyMap<string, TaskStatus>;
}, sort: ItemSort, desc?: boolean): ScheduleBucket[];
