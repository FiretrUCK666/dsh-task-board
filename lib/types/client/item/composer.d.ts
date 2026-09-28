import type { CapturedItem } from './model.ts';
export interface ItemComposerProps {
    /** The writing clock, so a parse resolves `@today` against a fixed now. */
    readonly now: number;
    /** Hand the finished capture over. Returning nothing means it was refused. */
    readonly onSave: (input: CapturedItem) => boolean;
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
export declare function ItemComposer({ now, onSave }: ItemComposerProps): import("react").JSX.Element;
