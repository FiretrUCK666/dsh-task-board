/**
 * 「跳到某一条」 — decided, not performed.
 *
 * ── WHY THIS IS A CORE FUNCTION AND NOT A PANEL CALLBACK ────────────────────
 *
 * `item.navigate` was the catalog's one `NOT_YET-BUILT` entry, and its own
 * reason said what was missing: 「切页与聚焦都是面板自己的局部 state…要接上就是
 * 给清单面板加一个具名的 `goTo(page?, ref?)`」. That advice was half right, and
 * following it literally would have left the judgment in the panel — where the
 * coverage gate cannot see it, the model cannot reach it, and the answer to
 * 「#12 在哪一页」 exists in a React component instead of next to the predicates
 * that decide which page a row belongs to.
 *
 * So the panel gets the mechanism and core keeps the judgment: **which page
 * holds this row is a fact about the document**, already answered by
 * {@link isInboxItem} and {@link isAgendaItem}, and this function is where those
 * two are read together so the answer is written down once. A surface that wants
 * to jump somewhere asks this and then moves.
 *
 * ── WHY THE PAGE SET IS NOT AN ARGUMENT ─────────────────────────────────────
 *
 * The three pages are a product constant ({@link ITEM_PAGES}), not a choice this
 * function offers. Naming a fourth page here would create a fourth place to keep
 * it consistent — which is the defect this file exists to remove.
 */
import type { ItemRecord } from './item.ts';
import { ITEM_PAGES, type ItemPageId } from './item-counts.ts';
export type ItemNavigationRefusal = 'nothingAsked' | 'noSuchItem';
export type ItemNavigation = {
    readonly kind: 'refused';
    readonly why: ItemNavigationRefusal;
} | {
    readonly kind: 'go';
    readonly page: ItemPageId;
    /** The row to focus, or `undefined` when only the page was asked for. */
    readonly ref: number | undefined;
};
/**
 * Which of the three pages holds this row.
 *
 * 收件 · 清单 · 日程 are nested, not parallel, so the answer has an order: a bare
 * capture goes to 收件 (it has no structure at all), a scheduled live row goes to
 * 日程, and everything else — including every finished row — stays in 清单,
 * because that page counts what EXISTS rather than what is outstanding. Reading
 * it the other way round is how a finished row ends up on a page that does not
 * list finished rows.
 */
export declare function itemPageOf(item: ItemRecord): ItemPageId;
/**
 * Where a 「jump to this」 should land.
 *
 * @param input.page - the page asked for, if the caller named one.
 * @param input.of - the short number asked for, if any.
 * @param input.items - the document, for the case where only the row was named.
 * @returns the page and the row to focus, or the refusal. A refusal is always a
 *   shape, never a silent no-op: a jump that quietly does nothing reads as a
 *   broken button.
 */
export declare function planItemNavigation(input: {
    readonly page?: ItemPageId;
    readonly of?: number;
    readonly items: readonly ItemRecord[];
}): ItemNavigation;
/** Re-exported so a surface can offer the three pages without a second import. */
export { ITEM_PAGES };
export type { ItemPageId };
