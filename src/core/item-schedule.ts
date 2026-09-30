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
import type { ItemRecord } from './item.ts'
import { DAY_MS, datePostureOf, startOfDay } from './item-dates.ts'
import { isAgendaItem } from './item-membership.ts'
import { sortItemsOf, type ItemSort } from './item-sort.ts'
import { itemMatches, type ItemMatchContext, type ItemQuery } from './item-query.ts'

/**
 * The agenda's buckets, in the order they read.
 *
 * The set is FIXED and complete. Adding a bucket to the model adds a column to
 * every reader's agenda for a case nobody has, and a page that grows columns
 * under demand is a page nobody scans.
 */
export const SCHEDULE_BUCKETS = ['hardOverdue', 'behind', 'today', 'tomorrow', 'week', 'later', 'undated', 'gated'] as const
export type ScheduleBucketId = typeof SCHEDULE_BUCKETS[number]

/** One bucket of the agenda. */
export interface ScheduleBucket {
  readonly id: ScheduleBucketId
  readonly items: readonly ItemRecord[]
  /**
   * The day this bucket is about, when it is about one: a date the reader can
   * point at, not a label to re-derive. `undefined` for the buckets that are
   * not about a day.
   */
  readonly day: number | undefined
}

/**
 * The day a row is ACTUALLY about: the hard deadline when there is one.
 *
 * A row carrying both dates is scheduled against the hard one, because that is
 * the date the reader cannot move on their own. Bucketing it by the soft date
 * instead would park work in a later bucket than the day it has to be done by,
 * which is the one error an agenda cannot make.
 */
function scheduledDayOf(item: ItemRecord): number | undefined {
  const at = item.hardDueAt ?? item.dueAt
  return at === undefined ? undefined : startOfDay(at)
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
export function scheduleBucketOf(item: ItemRecord, now: number): ScheduleBucketId {
  // A contradictory row is NOT filtered out of the agenda. Dropping it would
  // hide the one row whose dates need fixing; it falls through to the day its
  // hardest date names, and its own meta line says the three disagree. A row
  // that is wrong is still the reader's row, and a schedule that silently
  // swallowed it is exactly the kind of quiet the project refuses everywhere.
  const posture = datePostureOf(item, now)
  if (posture.kind === 'gated') return 'gated'
  if (posture.kind === 'hardOverdue') return 'hardOverdue'
  if (posture.kind === 'behind') return 'behind'
  const day = scheduledDayOf(item)
  if (day === undefined) return 'undated'
  // Rounded, not floored: a day boundary is 23 or 25 hours long across a
  // daylight-saving change, so truncating puts one bucket's rows a day early
  // twice a year and a test on that day fails for a reason nobody can see.
  const offset = Math.round((day - startOfDay(now)) / DAY_MS)
  if (offset <= 0) return 'today'
  if (offset === 1) return 'tomorrow'
  if (offset <= 7) return 'week'
  return 'later'
}

/**
 * Fill the agenda: every bucket, in reading order, rows ordered within.
 * @param items - every row in the document.
 * @param query - the parsed filter.
 * @param ctx - the clock, the threshold and the board's live state.
 * @param sort - the ordering within a bucket.
 * @returns one entry per bucket, empty buckets included.
 */
export function scheduleBucketsOf(
  items: readonly ItemRecord[],
  query: ItemQuery,
  ctx: ItemMatchContext & { readonly running: ReadonlyMap<string, boolean> },
  sort: ItemSort,
): ScheduleBucket[] {
  const filled = new Map<ScheduleBucketId, ItemRecord[]>(SCHEDULE_BUCKETS.map(id => [id, []]))
  for (const item of items) {
    // Membership is {@link isAgendaItem} and nothing else: finished work is
    // history, and an unfiled capture is the inbox's, not a date-shaped hole in
    // the agenda. The buckets below are then a pure function of the row.
    if (!isAgendaItem(item)) continue
    if (!itemMatches(item, query, ctx)) continue
    filled.get(scheduleBucketOf(item, ctx.now))?.push(item)
  }
  const today = startOfDay(ctx.now)
  return SCHEDULE_BUCKETS.map(id => {
    const rows = sortItemsOf(filled.get(id) ?? [], sort)
    // The day a bucket stands for is derived from its id rather than from the
    // rows in it, so an EMPTY bucket still knows which day it is — an empty
    // "tomorrow" is a fact about the calendar, and a bucket that only learned
    // its day from its contents would have no label at all on a quiet week.
    const day = id === 'today' ? today
      : id === 'tomorrow' ? today + DAY_MS
        : id === 'week' ? today + 7 * DAY_MS
          : undefined
    return { id, items: rows, day }
  })
}
