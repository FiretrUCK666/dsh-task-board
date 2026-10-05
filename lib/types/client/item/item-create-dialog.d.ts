import type { ItemCapture } from '../../core/item-transitions.ts';
export interface ItemCreateDialogProps {
    readonly open: boolean;
    readonly onClose: () => void;
    /** Hand the finished capture over. `false` means it was refused; keep the words. */
    readonly onCreate: (input: ItemCapture) => boolean;
    /**
       * The writing clock, so `@today` in the grammar resolves against a fixed now.
       *
       * It is a PROP and not a call to `Date.now()` inside the parser because that
       * clock decides what a date the reader typed MEANT. A test that cannot set it
       * cannot pin `@明天`, and a host that cannot set it cannot replay one.
       */
    readonly now: number;
    /** Cards the reader can hang the row on, by id. */
    readonly cards: readonly {
        readonly id: string;
        readonly title: string;
    }[];
}
/**
 * The dialog.
 *
 * The caret lands in the TITLE field, because that is the one field every row
 * needs and the only one whose absence makes the rest pointless. `Esc` closes it
 * from anywhere inside, and the words already typed stay typed — a dialog that
 * throws away half-written work on dismissal is a dialog nobody experiments in.
 * @param props - whether it is open, and the hand-off.
 * @returns the overlay, or nothing.
 */
export declare function ItemCreateDialog(props: ItemCreateDialogProps): import("react").JSX.Element | null;
