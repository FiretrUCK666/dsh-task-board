import type { ItemRowView } from '../../core/item-view.ts';
export interface ItemRowLineProps {
    readonly view: ItemRowView;
    /** Whether this row's detail is open in place. */
    readonly expanded: boolean;
    /** Whether this row is the one the detail pane is showing. */
    readonly selected: boolean;
    /** Whether the detail lives in the row (narrow) or in the pane (wide). */
    readonly inPlace: boolean;
    /**
     * Whether the reader is holding several rows, which puts a pickbox in this
     * row's first track INSTEAD OF the state mark.
     *
     * Instead of, not as well as: the two are the same slot, so a row is either
     * being selected or being read and never both, and the list's left edge moves
     * once for the whole list rather than once per row. A pickbox that was
     * resident would make every row on every page pay 28px for a control most
     * readers never use.
     */
    readonly picking: boolean;
    /** Whether THIS row is held. */
    readonly picked: boolean;
    readonly onPick: () => void;
    readonly panelId: string;
    readonly onToggle: () => void;
    readonly onSelect: () => void;
    readonly onAsk: () => void;
    readonly asking: boolean;
    /**
     * This row's own receipt, drawn under the control that earned it.
     *
     * A receipt that is about one row is printed beside that row. A receipt printed
     * at the top of the card is read after the eye has moved on, and a reader who
     * pressed 「问 AI」 on a row two screens down is looking at THAT row, not at the
     * top of the list — so a sentence there is a sentence they have to go and find.
     */
    readonly receipt?: string;
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
