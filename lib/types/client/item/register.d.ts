import type { ChecklistReplica } from '../../core/host-sync.ts';
import type { BoardController } from '../../core/controller.ts';
/** The cordis client context, narrowed to the two calls this contribution makes. */
interface Context {
    get(name: string): unknown;
    effect(run: () => void | (() => void), label?: string): () => void;
}
/** What the panel needs to read, and nothing more. */
export interface ItemListFace {
    readonly replica: ChecklistReplica | undefined;
    readonly controller: BoardController | undefined;
}
/**
 * The holder the background settle publishes into, and the panel reads from.
 *
 * One holder, not two: the drawer's own mount IS the lifetime, so the signal it
 * hands the panel aborts when the drawer goes away — which is what makes every
 * timer and subscription inside provably short-lived (lifecycle discipline: a
 * resource outliving its owner is the bug the signal exists to catch).
 */
export declare class ItemListStage {
    private itemReplica;
    private board;
    private lifetime;
    /** Publish the two live faces; the signal already exists and is unchanged. */
    bind(replica: ChecklistReplica | undefined, controller: BoardController | undefined): void;
    /** Mirror an external lifetime onto the one the panel holds. */
    bindSignal(signal: AbortSignal): void;
    signal(): AbortSignal;
    replica(): ChecklistReplica | undefined;
    controller(): BoardController | undefined;
    /** Drop every face; the panel then has nothing to read and says so. */
    unbind(): void;
}
/** The single stage every outlet reads through. */
export declare const stage: ItemListStage;
/**
 * Contribute the drawer and the pill.
 * @param ctx - the client context.
 * @param itemStage - the holder the background settle publishes into; every
 *   outlet reads the panel's faces through it, so there is one holder and not
 *   one per surface.
 * @returns a disposer removing everything this contributed.
 */
export declare function registerItemList(ctx: Context, itemStage?: ItemListStage): () => void;
export {};
