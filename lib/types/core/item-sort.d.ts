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
import type { ItemRecord } from './item.ts';
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
export type ItemSort = 'sequence' | 'starts' | 'due' | 'hard' | 'priority' | 'title';
/** The orderings, in the order the surface offers them — the first is the default. */
export declare const ITEM_SORTS: readonly ItemSort[];
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
export declare const DEFAULT_ITEM_SORT: ItemSort;
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
 * @returns the ordered copy.
 */
export declare function sortItemsOf(rows: readonly ItemRecord[], sort: ItemSort): ItemRecord[];
