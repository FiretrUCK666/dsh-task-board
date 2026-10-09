/**
 * The days a list is cut into.
 *
 * FOUR BUCKETS, and the names are relative on purpose. 「今天 / 昨天 / 前天 /
 * 更早」 is what a reader is actually holding when they look at a list they wrote
 * in the last few hours; an absolute 「10月 5日」 asks the reader to do a subtraction
 * that 「今天」 does for them. The absolute date is still one click away — it is in
 * the rail's calendar, and it is what every row's own date reading prints.
 *
 * Why four and not a calendar's worth: a bucket nobody ever opens is air, and the
 * list is the one place on this panel that must never spend air on nothing. Past
 * 前天 the reader is no longer asking 「which day」 — they are asking 「the rest of
 * it」, and 「更早」 answers that without asking them to count backwards.
 */
import type { ItemRecord } from '../../core/item.ts'
import type { ItemSort } from '../../core/item-sort.ts'
import { localDayKey } from './model.ts'

export type ItemDayBucket = 'today' | 'yesterday' | 'beforeYesterday' | 'earlier'

export const ITEM_DAY_BUCKETS: readonly ItemDayBucket[] = ['today', 'yesterday', 'beforeYesterday', 'earlier']

/**
 * WHICH ORDERINGS MAY BE CUT INTO DAYS, and every ordering has an answer.
 *
 * Only 「顺序」 is about WHEN THE ROW WAS WRITTEN, so only 「顺序」 may carry a
 * heading about when it was written. The other five are about the row's own dates
 * or its fields — a list sorted by 希望在, cut into 「今天 / 昨天」, would print 「今天」
 * above rows the reader deliberately sorted by deadline, and the heading would be
 * naming something they just chose not to look at.
 *
 * A `Set` would let a seventh ordering join by being left out; a `Record` over
 * `ItemSort` cannot, so a new ordering has to say yes or no here. This is the same
 * trick as `ITEM_FLAG_TESTS`, for the same reason: **a hand-written 「did I remember
 * all of them」 is the defect, not the fix.**
 */
export const SORT_GROUPS_BY_DAY: Readonly<Record<ItemSort, boolean>> = {
  sequence: true,
  starts: false,
  due: false,
  hard: false,
  priority: false,
  title: false,
}

/** Which bucket a moment belongs to, against one clock. */
export function dayBucketOf(at: number, now: number): ItemDayBucket {
  const day = 86_400_000
  const today = localDayKey(now)
  const yesterday = localDayKey(now - day)
  const beforeYesterday = localDayKey(now - 2 * day)
  const key = localDayKey(at)
  if (key === today) return 'today'
  if (key === yesterday) return 'yesterday'
  if (key === beforeYesterday) return 'beforeYesterday'
  return 'earlier'
}

/** One day of rows, in the order the caller handed them over. */
export interface ItemDayGroup {
  readonly bucket: ItemDayBucket
  readonly rows: readonly ItemRecord[]
  /** `rows.length`, because there is no number in this module to go stale. */
  readonly n: number
}

/**
 * CUT A LIST INTO DAYS, or hand it back whole.
 *
 * THE WHOLE LIST COMES BACK AS ONE GROUP when the chosen order is not 「顺序」,
 * because the cut would then be naming something the reader did not ask for.
 * {@link SORT_GROUPS_BY_DAY} decides that, and it is a table rather than a caller's
 * opinion: the caller hands over the ordering it was given and this module reads
 * the answer, so no surface can pass a boolean it guessed.
 *
 * Empty buckets are DROPPED, and that is the other half of the same promise: a
 * bucket with no rows has no heading, so a list written entirely today does not
 * carry three empty ones above the one that matters.
 *
 * @param items - the rows, already sorted in the reader's chosen order.
 * @param now - the panel's clock.
 * @param sort - the ordering the reader chose.
 * @returns the days, in bucket order, or one group when the order is not by time.
 */
export function itemDayGroupsOf(
  items: readonly ItemRecord[],
  now: number,
  sort: ItemSort,
): readonly ItemDayGroup[] {
  if (items.length === 0) return []
  if (!SORT_GROUPS_BY_DAY[sort]) return [{ bucket: 'earlier', rows: items, n: items.length }]
  const byBucket = new Map<ItemDayBucket, ItemRecord[]>()
  for (const item of items) {
    const bucket = dayBucketOf(item.updatedAt, now)
    const list = byBucket.get(bucket)
    if (list === undefined) byBucket.set(bucket, [item])
    else list.push(item)
  }
  const groups: ItemDayGroup[] = []
  for (const bucket of ITEM_DAY_BUCKETS) {
    const rows = byBucket.get(bucket)
    if (rows !== undefined) groups.push({ bucket, rows, n: rows.length })
  }
  return groups
}