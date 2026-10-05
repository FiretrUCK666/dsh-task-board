import { type ItemCapture } from '../../core/item-transitions.ts';
import { type ComposerParse } from './compose-parse.ts';
export interface ItemComposerProps {
    /** The writing clock, so a parse resolves `@today` against a fixed now. */
    readonly now: number;
    /**
     * Hand the finished capture over. Returning `false` means it was refused.
     *
     * OPTIONAL, and it is optional because **the sheet owns the save**: the grammar
     * is the first line of ＋新建一条, and that panel has its own button and its own
     * fields. With no `onSave` this draws no 「记下」 at all — a second save button
     * beside the sheet's own is two ways to write one row, and the reader cannot
     * tell which of them also carries the fields they just filled in.
     */
    readonly onSave?: (input: ItemCapture) => boolean;
    /**
     * What the box currently understands, handed up on every change.
     *
     * THIS IS HOW THE SHEET STAYS TRUE TO ITS CHIPS. The sentence above the field
     * grid is one sentence, and the grid below is that same sentence read field by
     * field — so the grid is SEEDED from this parse rather than typed twice. A
     * reader who writes 「改详情侧栏的地板 !1 @明天 #画廊」 sees the chips, then sees
     * those same three values sitting in the fields underneath, and can still
     * overrule any one of them by hand.
     */
    readonly onChange?: (parsed: ComposerParse) => void;
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
export declare function ItemComposer({ now, onSave, onChange, focusRequest }: ItemComposerProps): import("react").JSX.Element;
