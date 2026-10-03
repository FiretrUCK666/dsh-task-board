import type { ItemRowView } from '../../core/item-view.ts';
export interface ItemRowLineProps {
    readonly view: ItemRowView;
    /** Whether this row's detail is open in place (the band with no detail card). */
    readonly expanded: boolean;
    /** Whether this row is the one the detail card is showing. */
    readonly selected: boolean;
    /** Whether the detail lives in the row rather than in the card beside it. */
    readonly inPlace: boolean;
    /**
     * Whether THIS PAGE has a batch surface — which is what puts a pickbox in cell
     * one, on every row, all the time.
     *
     * It used to mean 「the reader is holding several rows」 and the box appeared
     * only then, which is the same condition stated as a MODE. A mode is something
     * the reader has to discover before the control exists: on this panel the only
     * way in was `X`, so the pickbox column was 44px of nothing on every row and the
     * only multi-select a mouse could reach was 「arm the batch in the palette and
     * then look for a box that is not there yet」. A page that CAN batch can say so
     * with a box that is simply there.
     */
    readonly picking: boolean;
    /** Whether THIS row is held. */
    readonly picked: boolean;
    /**
     * Hold or release this row. The flag is the SHIFT the reader pressed, and it is
     * a parameter rather than something this file reads off the event: 「hold a
     * range」 is a decision about the DOCUMENT, and the document is not this row's.
     */
    readonly onPick: (extend: boolean) => void;
    readonly panelId: string;
    readonly onToggle: () => void;
    readonly onSelect: () => void;
    readonly onAsk: () => void;
    readonly asking: boolean;
    /** Write a patch to THIS row — the hand-off the in-place title editor uses. */
    readonly onPatch: (patch: {
        readonly title: string;
    }) => void;
    /** This row's own receipt, drawn under the control that earned it. */
    readonly receipt?: string;
    readonly menuOpen: boolean;
    readonly onMenuToggle: () => void;
    readonly onMenuClose: () => void;
    readonly onMark: (status: 'open' | 'blocked' | 'done') => void;
    /** Open the checklist editor and put the caret in its field. */
    readonly onSteps: () => void;
    readonly onPromote: () => void;
    readonly onRemove: () => void;
    /** The in-place detail, rendered only when `inPlace` and open. */
    readonly detail?: React.ReactNode;
}
/**
 * One row: seven cells, in the order the head names them.
 * @param props - the projection, the panel's state and the hand-offs.
 * @returns the row, its menu and, when it belongs here, its in-place detail.
 */
export declare function ItemRowLine(props: ItemRowLineProps): import("react").JSX.Element;
