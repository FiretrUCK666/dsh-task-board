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
import { type ItemEdit } from './model.ts';
export interface ItemDetailProps {
    /** The row on show, or `undefined` before anything is picked. */
    readonly item: ItemRecord | undefined;
    /** The board cards a row may hang off, already titled. */
    readonly cards: readonly {
        readonly id: string;
        readonly title: string;
    }[];
    /** The per-group counts, for the pane's "before you pick" state. */
    readonly counts: readonly {
        readonly label: string;
        readonly value: number;
    }[];
    /** The most recently touched rows, for the same state. */
    readonly recent: readonly {
        readonly ref: string;
        readonly title: string;
    }[];
    readonly onEdit: (edit: ItemEdit) => void;
    readonly onToggleStep: (stepId: string) => void;
    readonly onRemove: () => void;
    /** True while the reader has confirmed the delete. */
    readonly confirmingRemove: boolean;
    readonly onConfirmRemove: () => void;
    readonly onCancelRemove: () => void;
    readonly onPickRecent: (id: string) => void;
}
/**
 * The detail, or the pane's designed "nothing picked yet" state.
 * @param props - the row, the board's cards and the hand-offs.
 * @returns the five sections, or the empty state.
 */
export declare function ItemDetail(props: ItemDetailProps): import("react").JSX.Element;
