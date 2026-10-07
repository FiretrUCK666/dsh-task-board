import type { ItemCapture } from '../../core/item-transitions.ts';
export interface ItemCreateDialogProps {
    readonly open: boolean;
    readonly onClose: () => void;
    /**
     * THE WRITING CLOCK, so `@明天` in the grammar resolves against a fixed now.
     *
     * It is a PROP and not a call to `Date.now()` inside the parser, because that clock
     * decides what a date the reader typed MEANT. A test that cannot set it cannot pin
     * `@明天`, and a host that cannot set it cannot replay one.
     */
    readonly now: number;
    /** Cards the row may hang on, by id. */
    readonly cards: readonly {
        readonly id: string;
        readonly title: string;
    }[];
    /**
     * ONE TRACK, TWO WRITES. The finished capture, and the second arg is 「挂到一张新卡」:
     * the strip asked for a name and the reader gave one. It is handed to the SAVE,
     * not acted on here — the card and the row are born in the same promotion
     * (one plan, two writes, one receipt), so a sheet that was dismissed halfway
     * never leaves a half-named empty card on the board. `false` means it was
     * refused; the words the reader typed are still in the fields, because a
     * dialog that throws away half-written work on dismissal is a dialog nobody
     * experiments in.
     */
    readonly onCreate: (input: ItemCapture, newCard?: string) => boolean;
}
/**
 * The sheet.
 * @param props - whether it is open, the two hand-offs, the cards and the clock.
 * @returns the overlay, or nothing.
 */
export declare function ItemCreateDialog(props: ItemCreateDialogProps): import("react").JSX.Element | null;
