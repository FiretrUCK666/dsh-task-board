import type { ItemRowView } from '../../core/item-view.ts';
import type { ItemPatch } from '../../core/item-transitions.ts';
export interface ItemDetailProps {
    /**
     * The row on show AS ITS PROJECTION, or `undefined` before anything is picked.
     *
     * The projection and not the record, because the pane asks derived questions —
     * has this row's hard deadline passed — and a derived question answered from
     * the record is a SECOND derivation. It read `Date.now()` for the clock, which
     * is not the panel's clock: the panel owns a `now` that ticks while it is on
     * screen and is what every other date on this surface is drawn against, so the
     * one line in the pane that answered for itself could disagree with the row
     * above it, and it disagreed exactly at midnight — and could never disagree in
     * a test, because the bench's clock is fixed and a fresh `Date.now()` is not.
     *
     * The model already publishes the answer, on the same projection the row line
     * reads, so the pane and the row cannot answer differently. `item` is still
     * reachable as `view.item` for the fields the pane edits.
     */
    readonly view: ItemRowView | undefined;
    /** The board cards a row may hang off, already titled. */
    readonly cards: readonly {
        readonly id: string;
        readonly title: string;
    }[];
    /** The most recently touched rows, for the "before you pick" state. `id` travels WITH the
     *  row: the short number is a name to read, never an address, and picking a
     *  row by its label is how a list ends up selecting the wrong one. */
    readonly recent: readonly {
        readonly id: string;
        readonly ref: string;
        readonly title: string;
    }[];
    /**
     * One field write. The patch's shape is the shared writer's, so a field the
     * model ruled derived or forbidden cannot be written from here even by
     * accident: the type is derived from the same verdict table the writer uses.
     */
    readonly onEdit: (edit: ItemPatch) => void;
    readonly onToggleStep: (stepId: string) => void;
    readonly onRemove: () => void;
    readonly onPickRecent: (id: string) => void;
}
/**
 * The detail, or the pane's designed "nothing picked yet" state.
 * @param props - the row, the board's cards and the hand-offs.
 * @returns the five sections, or the empty state.
 */
export declare function ItemDetail(props: ItemDetailProps): import("react").JSX.Element;
