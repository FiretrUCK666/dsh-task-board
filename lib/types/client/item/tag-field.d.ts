/**
 * 标签那一栏的输入框：**宽度跟着它要装的东西走**。
 *
 * ── 为什么需要一个元件，而不是各写一个 `inline-size` ──────────────────────────
 *
 * 这个框有**两个**读者看得见的状态：空着时它显示占位文字（一句话的说明），打字时它显示那串字。
 * 一个写死的宽度不可能同时装下两者——写宽了，空的时候是死空（读者的话：「它这个空的地方也太
 * 长了，字却挤在左边」）；写窄了，说明被砍掉最后一个字（这一页教语法的唯一一处）。而「内容
 * 多宽」是排版才知道的事，CSS 里那个 `auto` 对 `<input>` 意味着浏览器默认的二十个字符——
 * 一个与内容无关的定值。
 *
 * 所以尺寸由**一把看不见的尺子**给出：与输入框同一个盒子、同一套字体、同一份内衬的一段文字，
 * 内容是「读者现在看见的那串字」。它撑开这一格，输入框（`inline-size: 100%`）于是正好装下它。
 * 这与 `.itemSearchRow` 那一处**同一支笔**，只是方向相反：那里禁止按内容定宽（搜索框要占满
 * 一整行），这里必须按内容定宽。两处都在 `item.module.css` 里写着为什么。
 *
 * 两个调用点（详情面板里「加一个」、新建纸里整行标签）**共用这一个元件**：它们是同一个问题
 * 的两处出现，各写一份的代价是改一处不报错。
 */
import type { KeyboardEvent } from 'react';
/** 那个框，以及它的尺子。 */
export declare function TagField(props: {
    /** 现在显示的字（空串时显示 `placeholder`）。 */
    readonly value: string;
    readonly placeholder: string;
    readonly ariaLabel: string;
    readonly onChange: (value: string) => void;
    readonly onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
    /**
     * `<input>` 的固有宽度由 `size` 决定，而它的默认值是**二十个字符**——正是那个与内容无关的
     * 定值（读者量到的 100px 死空就是它）。所以这一格默认给 `1`，让上面那把尺子说了算；
     * 需要一块最小命中面的调用点可以抬它。
     */
    readonly floorChars?: number;
}): import("react").JSX.Element;
