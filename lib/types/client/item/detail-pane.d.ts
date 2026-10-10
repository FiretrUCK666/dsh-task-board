import type { ItemStep } from '../../core/item.ts';
import type { ItemRowView } from '../../core/item-view.ts';
import { type TaskStatus } from '../../core/tasks.ts';
import type { ItemPatch } from '../../core/item-transitions.ts';
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
     * **REQUIRED, NOT OPTIONAL.** This pane used to carry a 「nothing picked yet」
     * branch behind `view === undefined` — thirty lines, four dictionary keys, a
     * `recent` prop and the whole 「最近碰过的」 list, none of which any call site could
     * reach, because the panel only builds this for the row it is already showing.
     * Making the prop required turns that dead branch into a compile error, which is
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
     * ASK THE CARD THIS ROW HANGS OFF.
     *
     * It used to be a button on the row beside the ⋮, so a row carried two controls
     * for 「do something to this」 at two different distances from each other. It is one
     * of the three things in this row's footer now, and it is LISTED even when there
     * is no card — an entry that comes and goes with a fact the interface never
     * states is worse than one that is always there and says 「not yet」.
     */
    readonly onAsk: () => void;
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
    /** Run the card this row hangs off — the same `runTask` the catalog's `task.run`
     *  binds, handed in rather than reached for, so this component never learns how a
     *  run is started and there is no second spelling of the decision here. */
    readonly onStart: () => void;
    /**
     * 这张卡现在跑不跑得起来（`taskExecutable`：执行 Prompt 非空）。
     *
     * `undefined` = 这一行没有卡（那是另一句话，由「不挂」那一格说）；`false` = 有卡而它跑不
     * 起来——那时按钮禁用，**理由写在旁边**。
     */
    readonly runnable?: boolean;
    /**
     * 这一行刚做完那件事的回执（「你记的」「变成看板卡片了」……）。
     *
     * **它必须与按钮同排**：回执原来挂在**行**的网格上、按钮挂在详情卡片里，两个容器各摆各的
     * ——宽的时候碰巧是一条线，一窄就各回各家（读者给过三张不同宽度的截图，同一处三种排版）。
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
    readonly onMoveCard?: (status: TaskStatus) => void;
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
    readonly onRemove: () => void;
}
/**
 * The detail, or the pane's designed "nothing picked yet" state.
 * @param props - the row, the board's cards and the hand-offs.
 * @returns the five sections, or the empty state.
 */
export declare function ItemDetail(props: ItemDetailProps): import("react").JSX.Element;
