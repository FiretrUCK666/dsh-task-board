import { type ItemCapture } from '../../core/item-transitions.ts';
import { type ComposerParse } from './compose-parse.ts';
export interface ItemComposerProps {
    /** The writing clock, so a parse resolves `@today` against a fixed now. */
    readonly now: number;
    /**
     * Hand the finished capture over. Returning `false` means it was refused.
     *
     * 回车与「记下」都走它。它**必须有**：一个回车什么都不做的写入框，是把「快」这件事
     * 留给读者自己猜。
     */
    readonly onSave?: (input: ItemCapture) => boolean;
    /**
     * **这一行画不画自己那一枚保存按钮。**
     *
     * `'row'`（默认）：画。没有别的地方能存的时候，「记下」就是这一行的一部分——而且它是
     * 手机上唯一存得下的那一下（单行输入框里回车是换行）。
     *
     * `'surface'`：不画。这一行只是某个表面的第一行，而那个表面在自己的位置上有一个保存
     * 动词（新建纸的纸尾那一枚「存下这一条」）。**一张纸上两个保存控件，读者猜不出哪一个
     * 带着他刚在右边填的那些字段**——所以这是一次二选一，而不是两个并列的开关。
     */
    readonly saveOwnedBy?: 'row' | 'surface';
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
export declare function ItemComposer({ now, onSave, onChange, focusRequest, saveOwnedBy }: ItemComposerProps): import("react").JSX.Element;
/**
 * **三个记号各自叫什么** —— 一行图例，不是一段散文。
 *
 * 它是读者对着那行占位（`… #画廊 !1 @明天`）会问出的那个问题：「井号后面那个 tag 是什么」。
 * {@link ItemGrammarExample} 教的是**句子长什么样**（一个真的例子），这一行教的是**每个
 * 记号是什么意思**——两行回答两个问题，谁也替不了谁。
 *
 * 词从**已有的两张表**里读（`TOKEN_LABEL` 与 `DATE_FIELD_KEY`）：一个概念只有一套词，
 * 而这张图例不新造一个。
 * @returns 那一行图例。
 */
export declare function ItemGrammarLegend(): import("react").JSX.Element;
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
