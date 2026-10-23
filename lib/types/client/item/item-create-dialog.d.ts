/**
 * The new-row sheet: the fields, in the order a reader thinks of them.
 *
 * ── WHY IT LOOKS LIKE THIS ───────────────────────────────────────────────────
 *
 * 标题在最上面（一行字就够），下面是**三段可以写很长的话**：正文、步骤、上下文备注；
 * 右列是那张平的清单——优先级、状态、标签、三个日期、挂到哪张卡。
 *
 * ── WHY THERE IS EXACTLY ONE SCROLLER ────────────────────────────────────────
 *
 * The head and the footer stay put and the grid scrolls under them, so the button a
 * reader is about to press is never the thing that scrolled away. With `overflow:
 * hidden` on the sheet and no scroller inside, the last two fields were simply cut
 * off behind the footer on a phone — **a field you cannot reach is not a field.**
 */
import type { ReactNode } from 'react';
import type { ItemCapture } from '../../core/item-transitions.ts';
import { type AttachmentAdmitter } from '../board/composer-attachments.ts';
interface ItemCreateDialogProps {
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
    /**
     * **写作框那个数，与详情里那五个是一份。**
     *
     * 它是视图偏好，所以从面板下来、拖完原路回去；这张纸与展开区共用同一个控件。
     * **但尺寸跟着字段走，不跟着控件走**：这张纸的正文与展开区的正文是同一个字段
     * （同一个槽，两处同高），而正文与上下文备注是两个字段，各存各的——拖一个不会
     * 把另一个也拉起来。
     */
    /**
     * 收进官方附件库的那一次上传，与展开区那一栏**是同一个能力**（同一个钩子、同一条路由）。
     * 没有它（没接上看板、宿主没接上附件库）时，「＋」照样在，点它会明说收不了。
     */
    readonly admit?: AttachmentAdmitter;
    /**
     * 「新建卡片」那一档的运行配置——**由面板装配好递进来**（与批量条那一块同一个形状）：
     * 这一格组件不该知道看板控制器、预设存储长什么样，而那一块要读目录与预设库才有五行可写。
     *
     * **只在「新建卡片」那一档画它。** 另两档没有它的位置，理由各一句：不挂 = 没有卡、也没有
     * 东西要跑（读者真要跑的时候，那一行自己那份草稿就在行上）；挂已有卡 = 那张卡本来就有自己
     * 的一份，而这张纸的律是「卡里的内容不动」。
     *
     * **是个 thunk，不是一块现成的元素**：那一块的装配要读目录与预设库，而这张纸是常驻组件
     * ——写成 `expr && <X/>` 的话，读者还没开纸、还没选那一档，表达式就已经求值过一次了。
     */
    readonly cardConfigSlot?: () => ReactNode;
}
/**
 * The sheet.
 * @param props - whether it is open, the two hand-offs, the cards and the clock.
 * @returns the overlay, or nothing.
 */
export declare function ItemCreateDialog(props: ItemCreateDialogProps): import("react").JSX.Element | null;
export {};
