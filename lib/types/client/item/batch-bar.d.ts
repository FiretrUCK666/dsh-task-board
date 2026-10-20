/**
 * The batch bar: what the reader does to several rows at once.
 *
 * WHY IT IS A BAR AND NOT SIX BUTTONS ON EVERY ROW. A row that carries a
 * control it usually does not need is a row that pays for it on every screen
 * and every read, and six such controls is a toolbar drawn six times. One bar,
 * drawn only while something is held, puts the decision once — and the decision
 * is a decision ABOUT the holding, not about any one row.
 *
 * **EVERY ACTION HERE IS THE WRITE THE SINGLE-ROW MENU MAKES**, handed the same
 * patch through the same `core/item-transitions` function, so 「批量标为受阻」
 * and 「这一条标为受阻」 cannot drift apart and so the model, which does the same
 * thing one row at a time, is describing what actually happens. The product's own
 * line covers this: the interface is many rows, the model is one row and a
 * receipt, and they are the same act.
 *
 * **THE ASK IS NARROWER THAN THE BATCH, AND SAYS SO.** Only a row hanging off a
 * board card has a session to hand the question to, so a batch containing rows
 * without one does not silently skip them: the bar says which part can be asked.
 * A batch that quietly did less than it appeared to is worse than one that says
 * so.
 *
 * **NOTHING HERE IS A NEW WRITE.** Status, priority and the due date are fields
 * the row menu already edits; the bar is the same edit applied to a list of
 * identities. There is no batch-only field and no batch-only rule, which is what
 * keeps the action catalogue the only description of what can be done.
 */
import type { ReactNode } from 'react';
import type { ItemPriority, ItemStatus } from '../../core/item.ts';
interface ItemBatchBarProps {
    readonly count: number;
    /**
     * THE VALUE ALL HELD ROWS SHARE, when they share one — the Segmented's own
     * mark. Undefined = a mixed holding, and the strip stays blank rather than
     * claiming a tier nobody chose for all of them.
     */
    readonly commonStatus: ItemStatus | undefined;
    readonly commonPriority: ItemPriority | undefined;
    /** Whether every row the reader can see is held — what the select-all box draws. */
    readonly allPicked: boolean;
    /** Hold every visible row, or release them all. `visible`, not 「everything」:
     *  the panel computes it, so a box that ticked past the filter is impossible. */
    readonly onPickAll: (on: boolean) => void;
    /** Apply one patch to every held row. */
    readonly onMark: (status: ItemStatus) => void;
    readonly onPriority: (priority: ItemPriority) => void;
    readonly onDueToday: () => void;
    /** How many of the held rows can be handed to a session, and a way to do it. */
    readonly askable: number;
    readonly onAsk: () => void;
    /**
     * How many of the held rows hang off a board card.
     *
     * Non-zero disables the status segments and prints the reason: such a row's status
     * is its card's column, so writing the row's own field would change nothing the
     * reader can see — a control whose press silently does nothing.
     */
    readonly carded: number;
    /** Put the held rows back where they were, one gesture. */
    readonly onRemove: () => void;
    /**
     * 这一批「交给 AI」要用的那份运行配置（与详情那一块同一个组件，由面板装配好递进来）。
     *
     * **是个 thunk，不是一块现成的元素**：这一条只在真的画出来的时候才需要它——把装配写在
     * 调用点的 JSX 里，每次渲染都会求值（包括没多选、条子根本不在屏上的时候），而那一次求值
     * 会去读预设存储。
     */
    readonly configSlot?: () => ReactNode;
}
export declare function ItemBatchBar(props: ItemBatchBarProps): import("react").JSX.Element;
export {};
