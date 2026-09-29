/**
 * The filter bar: what picks the rows out. It belongs to the LIST page only.
 *
 * ONE PLACE, BESIDE THE THING IT CHANGES. Grouping, ordering, filtering and
 * batching are controls ABOUT the rows, so they sit with the rows. The header
 * keeps the four things that are about the page itself — what it is, how to
 * search it, which page, and where a thought goes in — and nothing else. A
 * toolbar at the top of a 1600px stage separates the controls from the list by
 * most of a screen, which is the distance at which a reader stops connecting
 * them.
 *
 * THE INBOX AND THE AGENDA DO NOT GET THIS BAR, and that is a decision rather
 * than a gap. A note that was written thirty seconds ago is read once, top to
 * bottom, and everything that would help you ORGANISE it is one step too early
 * for that. The agenda's own sections are already its grouping, so a filter row
 * above them would be a second grouping that disagrees with the first.
 *
 * THE ORDERING CONTROL HAS TWO SHAPES AND BOTH ARE RENDERED. Seven options do
 * not fit a 390px line, and a segmented control that cannot wrap or scroll
 * simply loses the options past its right edge — the reader is shown four of
 * seven and told nothing. So the phone band gets a `<select>`, which holds all
 * seven and needs no room, and the wide band gets the pills. WHICH ONE SHOWS is
 * decided by a container query and not by JavaScript: the component cannot know
 * its own box's width, and a JS switch beside a CSS container query is two
 * sources of truth for one decision, where a disagreement does not look wrong —
 * it looks like a control that cannot decide how wide it is.
 */
import { type ItemQuery, type ItemSort } from '../../core/item-view.ts';
export interface ItemFilterBarProps {
    /** The parsed search box. The ONLY state the facets read. */
    readonly query: ItemQuery;
    /** The raw text, handed back with one token added or removed. */
    readonly onSearch: (next: string) => void;
    readonly sort: ItemSort;
    readonly onSort: (next: ItemSort) => void;
    /** Every row's tag list, so the tag facet can offer what this document holds. */
    readonly tags: readonly (readonly string[])[];
    /** Whether a filter is in force, which is what the clear affordance is for. */
    readonly filtering: boolean;
    readonly onClear: () => void;
}
export declare function ItemFilterBar(props: ItemFilterBarProps): import("react").JSX.Element;
