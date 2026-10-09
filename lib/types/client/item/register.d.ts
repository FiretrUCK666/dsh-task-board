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
}
/**
 * The holder the background settle publishes into, and the panel reads from.
 *
 * ONE holder, and the module-level instance below is the only one: the earlier
 * code also had a second `new ItemListStage()` in the client entry, which bound
 * the live replica while this file's panel read the module singleton — so the
 * panel sat on "preparing" forever while every test stayed green. **A binding
 * side and a reading side that name the same thing are only the same thing if
 * they are the same object**, and that is a fact a type can check and a habit
 * cannot.
 *
 * The holder owns its own lifetime signal rather than borrowing a mount's: a
 * main-stage panel unmounts every time the reader looks at the conversation, so
 * a lifetime tied to its mount would tear down the replica subscription on
 * every panel switch. It aborts when the plugin does, and only then.
 */
export declare class ItemListStage {
    private itemReplica;
    private board;
    private open;
    private readonly lifetime;
    /**
     * Publish the live faces; the signal already exists and is unchanged.
     *
     * `openCard` 是**可选**的第三个面：装配层（`client/index.ts`）知道看板住在哪个座位、
     * 也知道 shell 的布局服务，而这一层只把它转交给面板（见 `ItemListFace.openCard`）。
     * 缺席时面板画一枚**读数**而不是一枚按不动的按钮。
     */
    bind(replica: ChecklistReplica | undefined, controller: BoardController | undefined, openCard?: (cardId: string) => void): void;
    /** The plugin's own lifetime, for every timer and subscription inside. */
    signal(): AbortSignal;
    replica(): ChecklistReplica | undefined;
    controller(): BoardController | undefined;
    /** The cross-panel door, when the wiring layer gave one (see {@link bind}). */
    openCardOf(): ((cardId: string) => void) | undefined;
    /** Drop every face and end the lifetime; the panel then has nothing to read and says so. */
    unbind(): void;
}
/** THE single stage, exported so the client entry binds THIS one. */
export declare const itemListStage: ItemListStage;
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
