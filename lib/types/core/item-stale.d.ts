/**
 * Neglect: how long a row has sat untouched, and — more importantly — which rows
 * must NOT be reported as neglected.
 *
 * WHY THE EXEMPTIONS ARE THE POINT, and why this is its own file. A staleness
 * signal is the cheapest thing in a checklist to build and the easiest thing in
 * the product to get wrong, because the naive version — "days since the last
 * change" — counts the row that CANNOT have been touched at all: one whose
 * `startsAfter` has not arrived. It points at rows the reader gated on purpose,
 * and the first time that happens the reader switches the whole thing off — which
 * loses the genuinely neglected work along with it. So the question this module
 * asks is "how long has this been waiting to be touched AND been touchable", and
 * a row failing the second half simply has no answer.
 *
 * （旧的第二条豁免是「读者标了受阻」；那一档已经不存在了——见 `item.ts` 里状态的
 * 来历。留下的这一条是**日期**给的，而日期是这一页上唯一能替读者说「还不能动」的
 * 东西。）
 *
 * The ceiling is the same promise from the other side. A staleness signal with no
 * ceiling turns into a guilt generator: past a certain age a row is not neglected
 * work, it is history, and reporting it says something about the reader's life
 * rather than about their list.
 */
import type { ItemRecord } from './item.ts';
/** Days without a change before an open row counts as neglected. */
export declare const DEFAULT_STALE_DAYS = 14;
/**
 * How long this row has sat untouched, or `undefined` when it is exempt.
 *
 * The exemptions are the whole point, not a nicety bolted on — see the module
 * header. The ceiling is its other half, for the same reason.
 * @param item - the row.
 * @param now - the reading clock.
 * @returns whole days since the last change, or `undefined` when exempt or too old.
 */
export declare function staleDaysOf(item: ItemRecord, now: number): number | undefined;
/**
 * The rows a reader has stopped moving, oldest first.
 *
 * Exported for the triage strip alone, which is the one surface that lists them
 * rather than asking about a single row — and it is the same predicate
 * {@link staleDaysOf} gives, so the count on the line and the list it opens
 * cannot be two different answers.
 * @param items - every row in the document.
 * @param now - the reading clock.
 * @param thresholdDays - how many untouched days count; below the default is the reader's choice.
 * @returns the neglected rows ordered by how long they have sat, **nearest the
 *   threshold first** — the row that only just crossed it leads, the longest-
 *   neglected is last. The count is what consumers read; the order is the
 *   reading order for a list, so it climbs from "just became stale" to "has sat
 *   the longest".
 */
export declare function staleItemsOf(items: readonly ItemRecord[], now: number, thresholdDays?: number): ItemRecord[];
