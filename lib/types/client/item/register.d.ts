/**
 * Registration for the task list in DSH's own right Sidebar.
 *
 * WHY THE RIGHT SIDEBAR AND NOT THE BOARD PANEL. The board lives in the centre
 * stage, behind a click. This list exists for the moment you are NOT looking
 * at the board — you are mid-conversation with the model and an idea shows up.
 * The right sidebar is present in every session, so one button puts the list
 * where the thinking is already happening.
 *
 * WHY NONE OF THE TWO SERVICES IS IN `inject`. `sidebarRightTabs` and
 * `sidebarRight` are optional. A declared-but-missing service makes the whole
 * client half wait forever, and the board is mounted by that same half — so
 * waiting for the sidebar would take the board down with it. Both are read
 * with `ctx.get()` inside the effect, and when either is absent this module
 * registers nothing at all. Absence then means "the panel does not exist",
 * never "a half-rendered panel" and never "the board stopped working".
 *
 * The replica face is published through a mutable holder for the same reason
 * the board stage uses one: the slot is contributed at apply time, long before
 * the background settle has built the sync client.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ChecklistReplica } from '../../core/host-sync.ts';
import type { BoardController } from '../../core/controller.ts';
/**
 * The face the panel reads. `replica` is `undefined` until the background
 * settle has built the sync client, which is why the panel renders a loading
 * state rather than assuming a live list.
 *
 * The board controller travels with it because "is the card this item hangs
 * off running" is ONE question with ONE answer in this plugin, and that answer
 * is `controller.liveStateOf`. The panel asking its own copy of that question
 * is exactly how the board and the list would start disagreeing.
 */
export interface ItemListFace {
    readonly replica: ChecklistReplica | undefined;
    readonly controller: BoardController | undefined;
}
/**
 * The holder behind the registration.
 *
 * Exactly one source of truth travels through it: the replica, the board, or
 * their absence. Nothing is cached, so a rebuilt sync client is picked up on
 * the next render without any rebinding.
 */
export declare class ItemListStage {
    private replica;
    private controller;
    /** Publish the live sync replica and the board it belongs to. */
    bind(replica: ChecklistReplica, controller: BoardController): void;
    /** Stop publishing them (the plugin is being disposed). */
    unbind(): void;
    /** Build the face the registration injects, read fresh on every render. */
    inject(): ItemListFace;
}
/**
 * Contribute the task list: its page type, its body, and the button that opens
 * it. Every step is skipped when the sidebar is not composed, and that is the
 * whole degradation story.
 * @param ctx - the client context.
 * @param stage - the holder the background settle publishes the replica into.
 * @returns a disposer removing everything this contributed.
 */
export declare function registerItemList(ctx: Context, stage: ItemListStage): () => void;
