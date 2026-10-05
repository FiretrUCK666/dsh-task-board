import type { ItemCapture } from '../../core/item-transitions.ts';
export interface ItemCreateDialogProps {
    readonly open: boolean;
    readonly onClose: () => void;
    /** The finished capture. `false` means it was refused; the words the reader typed
     *  are still in the fields, because a dialog that throws away half-written work on
     *  dismissal is a dialog nobody experiments in. */
    readonly onCreate: (input: ItemCapture) => boolean;
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
    /** The command palette, which is where 「新建一张卡」 goes: a card needs a
     *  workspace, a session and maybe a run configuration, and **those three decisions
     *  are not a checklist row's to make.** */
    readonly onNewCard: () => void;
}
/**
 * The sheet.
 * @param props - whether it is open, the two hand-offs, the cards and the clock.
 * @returns the overlay, or nothing.
 */
export declare function ItemCreateDialog(props: ItemCreateDialogProps): import("react").JSX.Element | null;
