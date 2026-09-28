/**
 * One row of the list, at rest.
 *
 * Level 0 of the two this panel has. It answers three questions and no more:
 * what is it called, what state is it in, and what is the one fact that matters
 * most today. Everything else is one click away in the detail, and the detail
 * opens IN PLACE — a dialog opened from here would anchor to the board's first
 * box, which is a different surface entirely, and a layer that floats over
 * another surface is not this surface's layer.
 *
 * TWO READING POSITIONS, ONE GRID. The title sits in one row of a named grid
 * and the facts in the row below it, with the state mark and the number in
 * areas that span both. That is the whole reason the title and the group count
 * can no longer print on top of each other: the alignment is computed by the
 * grid instead of by two offsets that each had to be right on their own.
 *
 * EVERY FACT IS VISIBLE AT REST. Status, number, title, the date verdict and
 * the step count are all on the line with no hover and no second click. Touch
 * has no hover, so a fact that only exists on one is a fact the phone does not
 * have.
 */
import type { ItemRowView } from '../../core/item-view.ts';
import type { ItemDensity } from './model.ts';
export interface ItemRowLineProps {
    readonly view: ItemRowView;
    readonly density: ItemDensity;
    /** Whether this row's detail is open in place. */
    readonly expanded: boolean;
    /** Whether this row is the one the detail pane is showing. */
    readonly selected: boolean;
    /** Whether the detail lives in the row (narrow) or in the pane (wide). */
    readonly inPlace: boolean;
    readonly panelId: string;
    readonly onToggle: () => void;
    readonly onSelect: () => void;
    readonly onAsk: () => void;
    readonly asking: boolean;
    /** The menu's open state and its dismissal, so one click closes it. */
    readonly menuOpen: boolean;
    readonly onMenuToggle: () => void;
    readonly onMenuClose: () => void;
    readonly onMark: (status: 'open' | 'blocked' | 'done') => void;
    readonly onPromote: () => void;
    readonly onRemove: () => void;
    /** The in-place detail, rendered only when `inPlace` and open. */
    readonly detail?: React.ReactNode;
}
/**
 * One row.
 * @param props - the projection, the panel's state and the hand-offs.
 * @returns the row, its menu and, when it belongs here, its in-place detail.
 */
export declare function ItemRowLine(props: ItemRowLineProps): import("react").JSX.Element;
