/**
 * The detail: the same component, in two places.
 *
 * Level 1 of the two this panel has, and there is no level 3 — a third level
 * inside a column is where a reader loses their place entirely. The wide band
 * puts it in a side pane beside the list; the narrow band puts it in the row.
 * SAME component, SAME five sections, SAME spacing; only the box differs, and
 * neither placement writes its own width. The field grid answers to its own
 * container (`dsh-tb-item-detail`) rather than to the panel, because at 1080px
 * the side pane is 296px wide and at 2380px it is 816px — one answer taken from
 * the surface would be wrong in both.
 *
 * It is never a dialog. `boardBox()` resolves to the FIRST board box, so a
 * layer opened from this panel would anchor itself to the board — a different
 * surface — and a layer that floats over another surface is not this surface's
 * layer.
 */
import type { ItemRecord } from '../../core/item.ts';
import type { ItemPatch } from '../../core/item-transitions.ts';
export interface ItemDetailProps {
    /** The row on show, or `undefined` before anything is picked. */
    readonly item: ItemRecord | undefined;
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
