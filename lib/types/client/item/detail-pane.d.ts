/**
 * The detail: the row's own expanded body, rendered in the row on BOTH bands.
 *
 * There is no separate side pane any more and no third level — the two levels
 * this panel has are the row and the row opened. The panel renders this
 * component inside the expanded row (wide and narrow alike; only the columns'
 * layout differs, and the field grid answers to its own container
 * `dsh-tb-item-detail` rather than to the panel, so one answer serves both).
 *
 * It is never a dialog. `boardBox()` resolves to the FIRST board box, so a
 * layer opened from this panel would anchor itself to the board — a different
 * surface — and a layer that floats over another surface is not this surface's
 * layer.
 */
import { type ReactNode } from 'react';
import type { ItemStep } from '../../core/item.ts';
import type { ItemRowView } from '../../core/item-view.ts';
import { type TaskStatus } from '../../core/tasks.ts';
import type { ItemPatch } from '../../core/item-transitions.ts';
import { type AttachmentAdmitter } from '../board/composer-attachments.ts';
export interface ItemDetailProps {
    /**
     * The row on show AS ITS PROJECTION.
     *
     * The projection and not the record, because the pane asks derived questions —
     * has this row's hard deadline passed — and a derived question answered from
     * the record is a SECOND derivation. It read `Date.now()` for the clock, which
     * is not the panel's clock: the panel owns a `now` that ticks while it is on
     * screen and is what every other date on this surface is drawn against, so the
     * one line in the pane that answered for itself could disagree with the row
     * above it, and it disagreed exactly at midnight — and could never disagree in
     * a test, because the bench's clock is fixed and a fresh `Date.now()` is not.
     *
     * The model already publishes the answer, on the same projection the row line
     * reads, so the pane and the row cannot answer differently. `item` is still
     * reachable as `view.item` for the fields the pane edits.
     *
     * **REQUIRED, NOT OPTIONAL.** A 「nothing picked yet」
     * branch behind `view === undefined` would be thirty lines, four dictionary keys, a
     * `recent` prop and the whole 「最近碰过的」 list, none of which any call site can
     * reach — the panel only builds this for the row it is already showing.
     * A required prop turns that dead branch into a compile error, which is
     * the only way a branch nobody exercises ever stops costing anything.
     */
    readonly view: ItemRowView;
    /**
     * THE PANEL'S CLOCK, so a date prints the year only when it is not this year —
     * against the same now that decided whether this row is late. Two clocks on one
     * row is a row that says 「还早」 and shows last year's date.
     */
    readonly now: number;
    /**
     * **把这一条交给 AI——这一屏唯一通向模型的那一按。**
     *
     * 它**必须和这一条底部那一排在一起**（与「变成看板卡片」「删除这条」同排）：
     * 行上 ⋮ 旁边再站一枚，一行上就有两枚「对这条做点什么」的控件，彼此还隔着一段距离。
     *
     * **两种行都在**：没挂卡的行会就地建一张再问，挂着卡的问它那条对话。所以这一排里既没有
     * 「执行」这一枚，也没有「跑不跑得起来」那个开关——送出去的是这一条自己的内容，不是卡上
     * 的执行 Prompt，一张 Prompt 为空的卡照样问得出去。
     */
    readonly onAsk: () => void;
    /** 那一次已经发出去、还没回来（按钮在这一刻禁用，免得连按两次）。 */
    readonly asking: boolean;
    /**
     * MAKE IT A BOARD CARD, NAMED HERE, and hang this row on it.
     *
     * The picker hands the NAME over and no more: whether the row was already on a
     * card and what the new card carries (title, description, prompt) is
     * `planItemPromotion`'s to answer, and the pane knowing it would be a second
     * verdict table. One string in, the panel does the two writes.
     *
     * It lives in the same row as 「挂到哪张卡」 because a row that hangs off nothing is
     * exactly the row that needs a card to be made — and sending the reader to the
     * board to create one and back is the most expensive way to answer 「它挂在哪」.
     */
    readonly onPromote: () => void;
    /**
     * 这张卡跑起来时用的那份运行配置（工作区 / Agent / 模型 / 思考程度 / 权限）。
     *
     * **它是看板那一块的同一个组件**（`RunConfigFields`），由面板装配好了递进来——于是这一
     * 组件仍然只知道「有一块东西要画在我这里」，不知道看板、控制器或预设存储长什么样。没有卡
     * 就没有这一块：没有卡就没有运行配置可配，那句话由「不挂」那一格说。
     */
    readonly runConfig?: ReactNode;
    /**
     * 这一行刚做完那件事的回执（「你记的」「变成看板卡片了」……）。
     *
     * **它必须与按钮同排**：回执挂在**行**的网格上、按钮挂在详情卡片里的话，两个容器各摆各的
     * ——宽的时候碰巧是一条线，一窄就各回各家（三张不同宽度的截图，同一处三种排版）。
     */
    readonly receipt?: string;
    readonly onNewCard: (title: string) => void;
    /** The board cards a row may hang off, already titled. */
    readonly cards: readonly {
        readonly id: string;
        readonly title: string;
    }[];
    /**
     * One field write. The patch's shape is the shared writer's, so a field the
     * model ruled derived or forbidden cannot be written from here even by
     * accident: the type is derived from the same verdict table the writer uses.
     */
    readonly onEdit: (edit: ItemPatch) => void;
    /**
     * Move the card this row hangs off to another column.
     *
     * 挂着卡的行，状态**不属于它自己**：它在哪一栏是那张卡的事实，所以这一格的写入口是
     * 看板的动作（`task.move`），不是清单的补丁。`undefined` 表示这一屏没有看板可写——
     * 那时按钮不画（一个按下去什么都不会发生的控件，比一个不在的控件糟）。
     */
    readonly onMoveCard?: (status: TaskStatus) => string | undefined;
    /**
     * Write the WHOLE checklist back, through the panel's one writer.
     *
     * A list rather than four verbs, and the reason is that the step list is
     * REPLACED by design — the model reads it the same way. So 「加一步」 and
     * 「挪上去」 are two answers this pane computes with the shared pure functions
     * and hands over whole; the panel writes once. Four verbs here would be four
     * writes, and four writes are four chances for two devices to interleave into a
     * list neither of them meant.
     */
    readonly onEditSteps: (steps: ItemStep[]) => void;
    /**
     * Bumped by the row menu's 「编辑步骤」, so the add field takes the caret.
     *
     * A COUNTER AND NOT A REF, for the reason the capture box's `focusRequest` is
     * one: the same press has to work twice, and a ref cannot tell the second press
     * from the first.
     */
    readonly stepsFocus?: number;
    readonly onToggleStep: (stepId: string) => void;
    /**
     * **读者的写作框多高。** 它是**视图偏好**而不是这一条的字段（同一台设备上五个
     * 写作框共用一个数），所以它从面板下来、拖完再原路回去——这一屏不知道它住在哪儿。
     */
    /**
     * 把读者选的一张图或一个文件收进官方附件库，换回一个 ref。
     *
     * **附件这一条通道只有这一个入口**（与卡片、评论、会话规则同一个
     * `useComposerAttachments`），而它需要的东西只有一处有：那一次上传要发一个请求。
     * 所以这一屏拿到的是**能力本身**，不是控制器——没有它（没有看板、宿主没接上附件库）
     * 时，芯片照样显示、点「＋」会明说收不了，而不是画一枚按下去没反应的按钮。
     */
    readonly admit?: AttachmentAdmitter;
    readonly onRemove: () => void;
}
/**
 * The detail, or the pane's designed "nothing picked yet" state.
 * @param props - the row, the board's cards and the hand-offs.
 * @returns the five sections, or the empty state.
 */
export declare function ItemDetail(props: ItemDetailProps): import("react").JSX.Element;
