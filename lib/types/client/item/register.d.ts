import type { ChecklistReplica } from '../../core/host-sync.ts';
import type { BoardController } from '../../core/controller.ts';
/**
 * The list's stage identity — ONE value for both official registrations, the
 * `main` key and the panel-list entry id, exactly as the board keeps its own
 * in one place so "they agree" is structural rather than a coincidence two call
 * sites have to remember.
 */
export declare const LIST_GROUP: {
    readonly id: "dsh-task-board-items";
};
/** The cordis client context, narrowed to the two calls this contribution makes. */
interface Context {
    get(name: string): unknown;
    effect(run: () => void | (() => void), label?: string): () => void;
}
/** What the panel needs to read, and nothing more. */
export interface ItemListFace {
    readonly replica: ChecklistReplica | undefined;
    readonly controller: BoardController | undefined;
    /**
     * **跨面板的那一扇门：把看板舞台打开在那张卡上。**
     *
     * 清单不自己去找看板、也不自己按 `selectPanel`——它**问一句**「打开这张卡」，做这件事的
     * 是装配层（`client/index.ts`：`controller.openTask(id)` 定下选中的卡，再由布局把看板
     * 舞台抬到前面）。理由与所有接缝一样：清单面板不该知道看板住在哪个座位、更不该知道 shell
     * 的布局服务长什么样；这两件事都是**别人**的事。
     *
     * 缺席（`undefined`）时那张卡芯片**保持是一枚读数**，不画成一枚按不动的按钮——一个按下去
     * 什么都不会发生的控件比一句没有更糟（见 `item.menu` 那条同一个道理）。
     */
    readonly openCard?: (cardId: string) => void;
    /**
     * 看板那一侧递过来的一次「只看挂着这张卡的条目」（带 token，所以同一次请求不会被消费两次）。
     * 和 `openCard` 同一个方向：清单只**读**这件事，谁去抬舞台、谁去记请求都是别人的事。
     */
    readonly focusRequest?: {
        readonly token: number;
        readonly cardId: string;
    };
}
/**
 * Contribute the list: its main-stage panel and the panel-list row that
 * selects it.
 *
 * Registration waits for the host's surface answer, because the answer decides
 * whether to register at all. A failed read registers anyway — see
 * `surfaces.ts` for why the failure direction is the whole design.
 *
 * @param ctx - the client context.
 * @param returnToConversation - the one way out, shared with the board's row.
 * @returns a disposer removing everything this contributed.
 */
export declare function registerItemList(ctx: Context, returnToConversation: () => void): () => void;
export {};
