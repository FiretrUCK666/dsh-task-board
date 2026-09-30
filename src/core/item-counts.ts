/**
 * The numbers the workbench chrome reads: the page rail, the four group heads,
 * and the one cross-cut that is not a group.
 *
 * WHY THE COUNTS ARE COUNTED HERE AND NOWHERE ELSE. A number that disagrees with
 * the list under it is the single most expensive defect this product can ship,
 * and it is expensive precisely because it is not wrong-looking: both numbers are
 * correct, they just answer different questions. So every function here is a
 * count OF WHOLE ROWS using a predicate that is also the one the list itself is
 * built from — the rail counts with {@link isAgendaItem} and the agenda fills by
 * it, the four groups bucket by {@link derivedStatusOf} and the projection reads
 * it. No count in this file is a second opinion about anything.
 *
 * ── WHY THE OVERVIEW HAS TWO NUMBERS AND NOT FIVE ───────────────────────────
 *
 * It used to carry four tiles: 未完成 / 逾期 / 今天 / 本周, plus a total. Three of
 * those four were **dead numbers** — computed on every render by every device,
 * and read by nobody: the four status counts a reader sees are the four GROUP
 * HEADS ({@link itemGroupCountsOf}), which are the same rows counted by a
 * different, correct predicate, and the 「今天」/「本周」 counts have no tile at all.
 *
 * Worse, the strip is not even an addition. It is a CROSS-CUT: 未完成 and 逾期 are
 * two views of the same rows (逾期 is a subset of 未完成 by construction), so the
 * five tiles could never sum to the total printed underneath them — and that is
 * the kind of wrong nobody can discover from a screenshot, because each tile is
 * individually true. A denominator under a set of tiles that does not decompose
 * them is not a total, it is a number that happens to be nearby.
 *
 * So what survives is the part with no other home: the two late buckets, counted
 * by {@link scheduleBucketOf} rather than by a second set of date tests, which is
 * what makes 「逾期」 mean here exactly what it means on the agenda.
 */
import type { ItemRecord, ItemStatusView } from './item.ts'
import { derivedStatusOf, isAgendaItem, isInboxItem, isLiveItem } from './item-membership.ts'
import { scheduleBucketOf } from './item-schedule.ts'

/**
 * The panel's three pages, in reading order.
 *
 * A page is a QUESTION ("what have I not dealt with yet", "what is on me
 * today", "what have I set down"), not a layout. Layouts are a property of a
 * page, and a surface that grows one page per layout ends up with a navigation
 * strip nobody reads — so the set is closed here, in data, and nothing in the
 * interface may add a fourth.
 *
 * IT LIVES BESIDE {@link itemPageCountsOf} rather than beside the pages
 * themselves, because that function is what makes the set closed in the only way
 * that can be enforced: {@link ItemPageCounts} is a `Record` over these ids, so
 * a fourth page that nobody gives a count for is a build failure rather than a
 * rail cell that reads 0.
 */
export const ITEM_PAGES = ['inbox', 'list', 'schedule'] as const
export type ItemPageId = typeof ITEM_PAGES[number]

/**
 * The three numbers on the page rail, in page order.
 *
 * A `Record` keyed by {@link ItemPageId} rather than an array, so a page cannot
 * be added to the rail without a count and a page cannot be counted twice — the
 * same closed-Record idiom the sort menu and the group heads use, and for the
 * same reason: a key that does not exist is a compile error, and a key nobody
 * reads is a question that will be answered differently by the next surface.
 */
export type ItemPageCounts = Readonly<Record<ItemPageId, number>>

/**
 * How many rows each page holds.
 *
 * EVERY COUNT IS A JUDGMENT ALREADY MADE ELSEWHERE, and this function adds no
 * new one. The inbox is {@link isInboxItem} — the very predicate the agenda's
 * membership and the triage strip's "no date" line share, so a row cannot be
 * filed on the rail and unfiled in the strip. The agenda is {@link isAgendaItem},
 * which is what the agenda itself fills by, so the number on the rail is the
 * number of rows the page actually holds rather than a second opinion about it.
 *
 * AND THE LIST PAGE COUNTS EVERYTHING, INCLUDING FINISHED WORK. That is not an
 * oversight, it is the product's central promise: completion is a switch inside
 * the list, never a fourth page, and a rail that quietly stopped counting the
 * rows a reader finished would be a second, invisible 「已完成」 page. So the
 * total the header shows is this number, and a filter says 「显示 X 条，共 M 条」
 * rather than replacing it.
 *
 * THERE IS NO CLOCK AND NO CONTEXT IN THE SIGNATURE, and that is the design
 * rather than an omission. The rail is a map of the DOCUMENT, and a number that
 * moved with the time of day — or with the search box, or with a board that is
 * not attached — would be a map that redraws itself under the person following
 * it. Which of the three dates a row has is the agenda's business; how many rows
 * the agenda holds is not.
 *
 * @param items - every row in the document, tombstones already settled.
 * @returns one number per page, in page order.
 */
export function itemPageCountsOf(items: readonly ItemRecord[]): ItemPageCounts {
  let inbox = 0
  let schedule = 0
  for (const item of items) {
    if (isInboxItem(item)) inbox += 1
    if (isAgendaItem(item)) schedule += 1
  }
  return { inbox, list: items.length, schedule }
}

/**
 * The four group counts, ALWAYS all four.
 *
 * The shape is a `Record` over the four derived statuses, which is the model's
 * way of saying that a surface may not invent a fifth group and may not drop
 * one: a header that renders only the groups it has rows for is a header that
 * hides the map of the list, and a detail pane's empty state that counts
 * differently from the header above it is the same defect in a second place.
 *
 * 进行中 is DERIVED, so this count is only as good as the `running` map it is
 * handed — which is the board's live state, read by the same derivation the row
 * itself reads. A caller that has no board in front of it (a query answer, a
 * dry run) passes an EMPTY map, which makes 进行中 zero rather than guessing:
 * a row that is quietly running must not be counted as 待办 and must never be
 * counted as 进行中 on a host that cannot see the session.
 *
 * @param items - every row in the document.
 * @param running - card id → whether that card is running, right now.
 * @returns one count per group, in `ITEM_STATUS_ORDER`.
 */
export function itemGroupCountsOf(
  items: readonly ItemRecord[],
  running: ReadonlyMap<string, boolean>,
): Readonly<Record<ItemStatusView, number>> {
  const counts: Record<ItemStatusView, number> = { inProgress: 0, open: 0, blocked: 0, done: 0 }
  for (const item of items) {
    counts[derivedStatusOf(item, running)] += 1
  }
  return counts
}

/**
 * The two numbers the overview prints, and the ONLY two.
 *
 * `total` is what the reader still owes, finished work included in nothing. A
 * reader's overdue count is a share of what is left to do, and a list with
 * nothing left has nothing to share — which is why `total` is stated rather than
 * inferred.
 *
 * `overdue` is the two late agenda buckets, and nothing else: a gated row is
 * waiting on a date the reader set, so it counts for neither and saying otherwise
 * would nag about work that cannot be done today.
 *
 * IT IS DELIBERATELY NOT A LIST OF TILES. See the module header: the tiles this
 * replaced were a cross-cut of the group counts above, so they could not add up
 * to the total printed under them, and no screenshot can show that.
 *
 * @param items - every row in the document.
 * @param now - the reading clock.
 * @returns what is left, and how much of it is late.
 */
export function itemInsightOf(items: readonly ItemRecord[], now: number): ItemInsight {
  const live = items.filter(isLiveItem)
  let overdue = 0
  for (const item of live) {
    const bucket = scheduleBucketOf(item, now)
    if (bucket === 'hardOverdue' || bucket === 'behind') overdue += 1
  }
  return { total: live.length, overdue }
}

/** What the overview says: two counts, and nothing that would not add up. */
export interface ItemInsight {
  /**
   * What 逾期 is a share OF: the rows that are still live, finished work
   * included in nothing. Stated rather than inferred, because a list with
   * nothing left has no share to give.
   */
  readonly total: number
  /** How much of it is late — the two late buckets, read from the agenda. */
  readonly overdue: number
}
