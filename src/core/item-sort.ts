/**
 * Orderings: how a page decides which row comes first, and the ONE recent-rows
 * list the panel's detail pane offers.
 *
 * WHY SORTING IS A CORE MODULE AND NOT A COMPONENT. The checklist's order is
 * DERIVED, not stored — the new-field admission rule in `item.ts` kept an `order`
 * field out of the model for exactly this reason — so every surface that shows
 * rows has to recompute it. Two devices holding one document therefore show one
 * list only if both recompute the same one, and a comparator written inside a
 * component is a comparator nobody else runs. The 顺序 case makes this concrete:
 * it is the DOCUMENT's own order, read as a comparator rather than restated, and
 * a second copy of those keys would be free to disagree with the document about
 * which of two rows comes first — which is not a wrong picture, it is two
 * different documents.
 *
 * EVERY ORDERING IS A TOTAL ORDER, and the whole module is arranged around that
 * one promise. `Array.prototype.sort` treats a `NaN` comparison as EQUAL and
 * moves on, so a comparator that ever shrugs leaves that pair unordered and the
 * list falls back to arrival order — which differs per device and is invisible
 * in any screenshot taken on one of them. Two things guard it: every sort key is
 * a FINITE number (an "unset" value is a large finite end, never `Infinity`),
 * and the chain that combines them ends in the row's identity.
 */
import type { ItemRecord } from './item.ts'
import { itemPriorityRankOf, itemTitleOf } from './item.ts'
// The 顺序 ordering IS the document's own order, read as a comparator rather
// than restated: the reader's 顺序 and the order the document stores are one
// promise, and a second copy of five keys would be free to disagree with the
// first about which of two rows comes first. This is the ONE edge the whole
// derivation layer has to the document, and it is named here rather than spread.
import { compareItemOrder } from './items-doc.ts'

/**
 * How a page orders its rows. ONE order, shared by every page.
 *
 * A closed set, and it is closed for the same reason the page set is: an
 * ordering is a question a reader can ask, and a list that grows one per
 * preference is a list whose menu nobody reads. Every key is a pure derivation
 * of fields the row already carries — no key asks the document for anything, so
 * ordering a page never needs a round trip and two devices holding one document
 * can never order it differently.
 *
 * 出生时刻 WAS A SEVENTH MEMBER AND IS NOT ANY MORE, because for a reader it was
 * not a different question from 顺序 — both answer "which of these is mine and in
 * what order did they arrive", one read from the document's own comparator and
 * one read from `createdAt` — and two menu entries that produce near-identical
 * lists is one entry too many. Removing it is also a removal of the only
 * comparator that subtracted a raw document field, which is why its NaN case is
 * documented below.
 */
export type ItemSort = 'sequence' | 'starts' | 'due' | 'hard' | 'priority' | 'title'

/** The orderings, in the order the surface offers them — the first is the default. */
export const ITEM_SORTS: readonly ItemSort[] = ['sequence', 'starts', 'due', 'hard', 'priority', 'title']

/**
 * The ordering a reader meets before choosing one.
 *
 * 顺序 rather than a date column, and the reason is that the date columns
 * cannot be right for a list that is mostly not scheduled: a row with no date
 * has to sort somewhere, and a date-first default spends the reader's first
 * screen on rows they never dated while the dated ones — the ones with a
 * promise attached — sink. 顺序 is the document's own order, so the first thing
 * a reader sees is what the document already believes.
 */
export const DEFAULT_ITEM_SORT: ItemSort = 'sequence'

/**
 * The same sentinel for every date column that has one. Named once because the
 * law is one: a row without this field is not "at the beginning" and not
 * "unbounded", it is at the END, and only a FINITE end can be subtracted.
 *
 * `Infinity` is the tempting value and the one that breaks. Two rows without
 * dates both answer `Infinity`, and `Infinity - Infinity` is `NaN`; a comparator
 * that returns `NaN` makes `Array.prototype.sort` treat the pair as equal and
 * move on, so the two rows are never ordered against each other at all — which
 * quietly makes this NOT a total order, and a list that is not a total order
 * renders differently on two devices holding one document. The defect is
 * invisible on any screen showing a single device and impossible to spot in a
 * screenshot.
 */
const UNSET_DATE = Number.MAX_SAFE_INTEGER

/**
 * The instant a row is sorted by under the `due` order: the nearest date it owns.
 */
function dueSortKeyOf(item: ItemRecord): number {
  return item.hardDueAt ?? item.dueAt ?? UNSET_DATE
}

/**
 * 不早于 — the gate, soonest first, and a row with no gate at the END, by the
 * same law as {@link UNSET_DATE}.
 */
function startsSortKeyOf(item: ItemRecord): number {
  return item.startsAfter ?? UNSET_DATE
}

/**
 * 不晚于 — the one date that does not move, soonest first, and a row with none
 * at the END, for the same reason {@link startsSortKeyOf} puts it there.
 */
function hardSortKeyOf(item: ItemRecord): number {
  return item.hardDueAt ?? UNSET_DATE
}

/**
 * The four tiers as ONE number, read from the model — never re-ranked here.
 *
 * This used to be `ITEM_PRIORITIES.indexOf(item.priority)`, and that was wrong in
 * the most user-visible way a sort can be: the enum is declared lowest-first
 * because that is how the tiers are named in a dropdown, so the index put 紧急
 * LAST while 顺序 — which reads the model's rank — put it FIRST. Switching the
 * sort on one page therefore moved the reader's most urgent row from the top to
 * the bottom, and the comment above that function claimed the two scales were
 * one. They were two rulers pointing opposite ways.
 *
 * {@link itemPriorityRankOf} is the one ruler, and it lives in the model because
 * that is what owns what a priority IS; the document's order and this ordering
 * are its two readers. A second ranking written here would be free to drift
 * again, and a drift in a RANKING is invisible until a reader notices their list
 * reshuffling.
 */
function prioritySortKeyOf(item: ItemRecord): number {
  return itemPriorityRankOf(item.priority)
}

/**
 * Compare two titles WITHOUT the reader's locale.
 *
 * `localeCompare` is the obvious tool and the wrong one here: its answer depends
 * on the device's language, so two devices sorting the same rows could put
 * 「Zebra」 and 「Ärger」 in either order, and the checklist would differ between
 * a phone and a laptop for no reason a reader could see. Code-unit order is
 * boring and identical everywhere, and the case-folded first pass is what keeps
 * `apple` and `Apple` next to each other instead of splitting the alphabet in
 * two — a Latin-1 case fold, not a locale's, so it stays device-independent.
 */
function compareTitles(a: string, b: string): number {
  const left = a.toLowerCase()
  const right = b.toLowerCase()
  if (left < right) return -1
  if (left > right) return 1
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

/**
 * ONE ROW PER ORDERING, keyed by the union — so the table cannot fall behind the
 * set. This replaced an `if` chain, and the chain had a defect that only the
 * table removes: its last line was a shared exit that served 「title」 (which has
 * no numeric key) AND any ordering somebody added without a key, and the comment
 * above that line explained only `title`. So the missing branch would arrive
 * wearing a comment that said it was deliberate — a defect coming back in
 * borrowed clothes. Here there is no such exit: `title` is a row like any other,
 * and a new member of {@link ItemSort} that nobody wrote a key for is a BUILD
 * FAILURE (`Property 'brandNew' is missing in type …`) rather than a quiet
 * fallback.
 *
 * It is the same move, and for the same reason, as deriving the patch type from
 * the model's ruling table: a hand-kept list of "the things you may do here"
 * stops agreeing with the real one the first time somebody adds a member, and the
 * failure is invisible because nothing about the old list looks wrong.
 *
 * EVERY ROW RETURNS A FINITE NUMBER, which is the contract the sentinel
 * documents: a comparator that ever returns `NaN` stops comparing that pair,
 * which makes the order partial, which makes two devices holding one document
 * show two lists. `0` is the row's way of saying "these two rows tie on me" —
 * never a shrug.
 */
const KEY_GAPS: Readonly<Record<ItemSort, (a: ItemRecord, b: ItemRecord) => number>> = {
  sequence: (a, b) => compareItemOrder(a, b),
  starts: (a, b) => startsSortKeyOf(a) - startsSortKeyOf(b),
  due: (a, b) => dueSortKeyOf(a) - dueSortKeyOf(b),
  hard: (a, b) => hardSortKeyOf(a) - hardSortKeyOf(b),
  priority: (a, b) => prioritySortKeyOf(a) - prioritySortKeyOf(b),
  // 标题 is the one row that is not arithmetic, and it is here rather than
  // special-cased by the caller so that this table is the whole answer to "what
  // does each ordering read". Code units, never the reader's locale.
  title: (a, b) => compareTitles(itemTitleOf(a), itemTitleOf(b)),
}

/**
 * Which cohort a row is in for the purpose of WHERE IT SITS: `0` for a row the
 * document has numbered, `1` for one it has not.
 *
 * THIS IS THE FIRST KEY OF EVERY ORDERING, BEFORE ANY OTHER, and that position is
 * the whole law. The tempting fix is to let the sentinel do its work where the
 * document's own comparator ends — last, after the dates — but then a row the
 * reader has just typed still jumps above their existing work whenever its own
 * key happens to favour it, which is exactly the reshuffle the default ordering
 * exists to prevent. A number the DOCUMENT has not handed out yet means the
 * row's place in the reader's own sequence is not decided yet, and an undecided
 * row waits at the end until it is.
 *
 * AND IT IS NOT A SORTING PREFERENCE, WHICH IS WHY 标题 IS NOT AN EXCEPTION TO IT.
 * An ordering changes 「按什么维度读」, not 「这份列表由谁组成」: the rows under the
 * title ordering are the same rows, and the batch the reader has just written is
 * in it either way. Make this one an exception and switching orderings would move
 * that batch from 「all at the end」 to 「sorted in among the others」, which reads
 * as "my notes were reorganized" — one inexplicable event instead of one
 * learnable rule. An exception has to be kept alive by a comment, comments expire,
 * and an expired exception is the next silent fork.
 *
 * THE PRICE, STATED RATHER THAN DISCOVERED. Under 标题 a note called 「AAA」 waits
 * below one called 「ZZZ」 for the length of one round trip, which looks wrong for
 * about a second and is then right for good. The window is short on a connected
 * host and is the whole offline case, and it is the offline case where a list that
 * reshuffles under every keystroke costs the reader the most. A list that moves
 * once when a note joins it is cheaper than a list that moves every time. And the
 * price is not peculiar to 标题 — it is the same price in every ordering, which is
 * the other reason to pay it once instead of seven times.
 *
 * It is also the same law `items-doc.ts` applies to its own last key, at a
 * narrower scope: there it settles a tie between two rows the document HAS
 * numbered, here it keeps an unnumbered row out of the way of every numbered one.
 * One principle, two scopes — not one rule written twice.
 */
function numberCohortOf(item: ItemRecord): number {
  return item.ref > 0 ? 0 : 1
}

/**
 * The short number a row is ordered by, with the unnumbered pushed to the end.
 *
 * Kept as a function because after {@link numberCohortOf} has separated the two
 * cohorts it is what orders the numbered ones among themselves, and it is still
 * the last word for two rows the document has not numbered yet.
 */
function refSortKeyOf(item: ItemRecord): number {
  return item.ref > 0 ? item.ref : UNSET_DATE
}

/**
 * Order rows under one rule.
 *
 * A total order, and the same one everywhere — which is the promise every
 * ordering has to keep, and the reason the comparison is built as one chain
 * rather than as several independent comparators. The chain, in order, and EVERY
 * link is load-bearing:
 *
 *  - **the number cohort decides first** ({@link numberCohortOf}): a row the
 *    document has not numbered yet waits at the end, in every ordering, so a
 *    note the reader just typed never displaces their own work;
 *  - then this ordering's own key, read from {@link KEY_GAPS} — one row per
 *    ordering, so an ordering nobody wrote a key for is a build failure rather
 *    than a quiet fallback;
 *  - then the short number, which the document hands out exactly once and never
 *    reuses, so it is the one key that can end any chain of numbered rows;
 *  - then the freshest change, and finally the identity, which is unique. Those
 *    last two are what make the chain total on a REPLICA as well as on the host:
 *    two rows the document has not numbered yet tie the number too, and something
 *    still has to break that.
 *
 * @param rows - the rows to order.
 * @param sort - which rule.
 * @param desc - 「倒过来」：整条顺序翻过来，而不是逐条键各自反向。
 * @returns the ordered copy.
 */
export function sortItemsOf(rows: readonly ItemRecord[], sort: ItemSort, desc = false): ItemRecord[] {
  // Hoisted out of the comparator, and the fallback is NOT what keeps the table
  // honest — the table's TYPE is, and that is what turns a forgotten key into a
  // build failure. This covers the one input the type cannot: a string that
  // arrived from outside it, which in this plugin means a device-local
  // preference written by an older build. 顺序 is the truthful answer to "an
  // ordering I do not know" (it is the default, and the document's own order),
  // where throwing would take the whole panel down over a row height.
  const gapOf = KEY_GAPS[sort] ?? KEY_GAPS.sequence
  const out = [...rows]
  out.sort((a, b) => {
    const cohort = numberCohortOf(a) - numberCohortOf(b)
    if (cohort !== 0) return cohort
    const gap = gapOf(a, b)
    if (gap !== 0) return gap
    if (refSortKeyOf(a) !== refSortKeyOf(b)) return refSortKeyOf(a) - refSortKeyOf(b)
    if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  /* **「倒过来」是整条顺序翻过来，不是每一条键各自反向。**
   *
   * 两件事在屏上不同，而读者按下那个词时想的是前者：逐键反向只把**判据**翻过来，同一档里的
   * 行还按原样排（于是「优先级 · 倒过来」看起来像「只是把三档调了个头」）；而「倒过来」是
   * 把读到的这一列**从下往上**读——它字面上就是这件事，也是唯一一种不需要读者再学一套规则的
   * 读法。（这也让方向只有一处实现：比较器一个字都不用改，改它就得把每一档的语义再想一遍，
   * 而那正是六个排序里最容易悄悄写错的地方。） */
  return desc ? out.reverse() : out
}

