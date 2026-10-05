import type { ItemRowLineProps } from './row-line.tsx';
import type { ItemSort } from '../../core/item-sort.ts';
export interface ItemTableProps {
    readonly rows: readonly ItemRowLineProps[];
    /** What the table says when there are no rows at all. */
    readonly empty: string;
    /** What the table says when the filter is what emptied it. */
    readonly noMatch?: string;
    /**
     * THE CLOCK, and the ORDERING the reader chose.
     *
     * Both are handed in rather than read: a day heading says 「今天」 and that word
     * is only true against the same clock that decided 「超期 15 天」 on the row under
     * it, and whether a day heading may appear at all is a question about the
     * ordering, which this component cannot see. The ordering goes down as itself —
     * not as a boolean — because the table would then be trusting a caller's memory
     * of which orders qualify.
     */
    readonly now: number;
    readonly sort: ItemSort;
}
/**
 * The table.
 *
 * ONE HEAD, ONE TABLE, AND NO BRANCH ABOVE EITHER. The head used to be written
 * twice — once inside the empty branch and once inside the filled one — and the
 * two copies had already drifted: only the filled one declared `role="row"` and
 * `role="columnheader"`, so a table with rows in it was an accessible table and
 * the same table with none in it was a pile of `<div>`s. A reader who filtered
 * a list down to nothing lost the row semantics of the very header that was
 * still on screen, and no test said anything, because the two branches were two
 * literals and a literal cannot disagree with itself loudly enough to be caught.
 *
 * The fix is not 「remember to keep them equal」. It is that there is only one
 * head and one card, and the only question the component asks is WHICH OF THE
 * TWO BODIES to draw — a difference the header has no opinion about.
 * @param props - the rows, each already projected, and the two empty sentences.
 * @returns the card, its sticky head and its rows or its empty sentence.
 */
export declare function ItemTable(props: ItemTableProps): import("react").JSX.Element;
