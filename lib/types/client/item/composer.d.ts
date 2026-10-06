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
/**
 * ONE LINE OF THE GRAMMAR, SPELLED OUT — what an empty document shows instead of
 * a paragraph about itself.
 *
 * THE PROBLEM IT ANSWERS. An empty surface can say two things: what is missing,
 * or how to put something there. A sentence can only do the first, and the first
 * is the one nobody needs — 「还没有事项」 is a fact the reader already has, and a
 * screen that repeats it in a paragraph is a wall of text that teaches nothing.
 * Worse, the sentence it replaced had to DESCRIBE the grammar in prose
 * (「给它一个优先级、一个日期、一个标签或一张卡」), which is the longest possible
 * way to say what one line can SHOW.
 *
 * SO IT SHOWS IT. `#画廊` `!1` `@明天` and a few words, drawn with the same chips
 * the real line uses — the priority token is literally `.itemPrioChip`, the shape
 * the reader will meet on a row's title, in the property list, and on the rail.
 * Nothing here is new vocabulary; it is the vocabulary, arranged once, so that
 * learning the shape and reading the example are the same act.
 *
 * IT IS TEXT, NOT A FIELD. The chips are `<b>` inside a `<p>`: they cannot be
 * focused, clicked or typed into, so the example cannot impersonate a control
 * that swallows a press. An example that looks like an input and is not one is
 * the most expensive kind of decoration — the reader tries it once and learns
 * that things on this page do not work.
 * @returns the example line.
 */
export declare function ItemGrammarExample(): import("react").JSX.Element;
