/**
 * The overview: FIVE tiles, on ONE line, always.
 *
 * THIS IS THE PAGE'S VISUAL CENTRE, and it is the only thing on this surface
 * allowed to hold the reader's first glance. Everything else is stepped down
 * from it — the header is one 16px title in the corner, the rail and the filter
 * bar are third-ink rows of pills, the fact line is 12px, the ref is 11px — so
 * that the eye lands on the numbers first and the words second. A page where
 * everything is the same size has no centre, and a centre is what turns a list
 * of rows into a workbench: the reader learns how the work stands before they
 * read a single title.
 *
 * WHY FIVE, AND WHY FOUR OF THEM ARE THE GROUPS. The four group tiles read
 * `itemGroupCountsOf`, which is ALWAYS four tiers and does not read the
 * finished switch: a breakdown whose denominator answered to a control the
 * reader could not see was a summary that changed on its own. The fifth tile is
 * the overdue count, which is a CROSS-CUT rather than a bucket — a row can be
 * overdue and in any of the other four — so it overlaps them by design, and an
 * earlier note here claimed the five add up to the list total. That is false the
 * moment two of them overlap, and it is the kind of false that survives review
 * because it sounds like arithmetic. THEY ARE NOT A PARTITION and nothing here
 * may pretend otherwise.
 *
 * WHICH IS WHY THE DENOMINATOR IS THE UNFINISHED COUNT AND NOT THE LIST. A bar
 * measures what the reader still OWES, so its denominator is what they still owe
 * — `itemInsightOf`'s `total`, the live rows. Measured against the whole
 * document, a 30% bar would be largely made of finished rows nobody has any
 * further action on, and the bar would be flattering the backlog. The line under
 * the strip SAYS the denominator out loud, because a bar whose denominator is
 * invisible is a bar with no unit — and that silence is a defect this page has
 * already committed once, when the first version of this strip was four lines of
 * bare numbers in the detail pane saying nothing about what they counted.
 *
 * WHY ONE LINE, ON A 390px SCREEN, WITHOUT SHRINKING ANYTHING. Five tiles at
 * 342px of usable width is 68px each, and the longest label (「已完成」) is about
 * 33px at 11px — so it fits, as long as the tracks are FIXED rather than
 * content-sized. Wrapping is the failure to avoid, not because five rows of one
 * tile is ugly but because a wrapped row reads as 「three and two」: two sets, two
 * questions, and the reader has to decide which set they care about before they
 * have read either. The yield when a track is too tight is a shorter track and a
 * clipped LABEL — never a smaller font, never a hidden tile, never a second line.
 */
import { type ItemQuery, type ItemStatusView } from '../../core/item-view.ts';
import type { ItemRecord } from '../../core/item.ts';
export interface ItemInsightStripProps {
    readonly items: readonly ItemRecord[];
    /** The four group counts, always four tiers, never read from the switch. */
    readonly counts: Readonly<Record<ItemStatusView, number>>;
    readonly now: number;
    /** The parsed search box, so a tile lights up for a filter typed by hand. */
    readonly query: ItemQuery;
    /** Write a filter. The same editor the facet chips use. */
    readonly onSearch: (next: string) => void;
    /** Turn the finished group on, so a filter for it has anything to match. */
    readonly onShowDone: (on: boolean) => void;
    readonly showDone: boolean;
}
export declare function ItemInsightStrip(props: ItemInsightStripProps): import("react").JSX.Element;
