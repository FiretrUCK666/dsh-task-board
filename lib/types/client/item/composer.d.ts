import { type ItemCapture } from '../../core/item-transitions.ts';
export interface ItemComposerProps {
    /** The writing clock, so a parse resolves `@today` against a fixed now. */
    readonly now: number;
    /** Hand the finished capture over. Returning `false` means it was refused. */
    readonly onSave: (input: ItemCapture) => boolean;
    /**
     * Put the caret in the box, from outside.
     *
     * This is what the `A` key calls, and it is a PROP rather than a method on a
     * ref for one reason: the composer owns its own input, and a parent reaching
     * into a child's DOM node is a parent that has to know how the child is built.
     * The gesture is 「write something now」, so that is what the parent asks for.
     */
    readonly focusRequest?: number;
}
/**
 * The capture box.
 *
 * State is the text and nothing else: every field the capture produces is
 * derived from it on each render, so there is no second copy of the truth to
 * fall out of step with the first.
 * @param props - the clock and the save hand-off.
 * @returns the box, its live chips and its hint.
 */
export declare function ItemComposer({ now, onSave, focusRequest }: ItemComposerProps): import("react").JSX.Element;
