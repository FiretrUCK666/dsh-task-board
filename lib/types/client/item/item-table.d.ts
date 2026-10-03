/**
 * The table: a head that names its columns and a body that fills them.
 *
 * WHY THE HEAD IS A SEPARATE FILE AND NOT A THIRD ARGUMENT. The head row and the
 * body row declare the SAME seven tracks, and they declare them in two different
 * rules in the stylesheet. Nothing checks that they still agree — the only thing
 * that can is a reader looking at a column whose label has drifted off the data
 * under it. So the seven names live HERE, as one list, and both rows are drawn
 * from it: a column cannot be added to the body without a name, and a name cannot
 * exist without a column.
 *
 * WHY THE HEAD IS STICKY. The reader scrolls a list of forty rows and needs to
 * know what 「落后 3 天」 was counting in; a head that scrolls away is a head that
 * answers the question once. It sticks to the top of the list's own scroller, so
 * it travels with the rows and with nothing else.
 *
 * WHY THERE IS NO PICKBOX COLUMN HEADER. 「勾选」 over a column of tick boxes is a
 * label about a control, not about the data. The cell is still there — the tracks
 * must be seven on both rows or everything after the first slides — and an empty
 * cell draws nothing.
 */
import type { ItemRowLineProps } from './row-line.tsx';
/** Which cell each column's content lands in — read by the row, not restated. */
export declare const COLUMN_IDS: string[];
export interface ItemTableProps {
    readonly rows: readonly ItemRowLineProps[];
    /** What the table says when there are no rows at all. */
    readonly empty: string;
    /** What the table says when the filter is what emptied it. */
    readonly noMatch?: string;
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
