/**
 * The workbench's ONE holder: the live faces every page reads.
 *
 * WHY THERE IS EXACTLY ONE. The three pages are three separate seats in the
 * shell, so "the board" and "the checklist" are not two React trees that could
 * each own a copy — they are one pair of documents read by whichever page is
 * mounted. A second holder is not a duplicate: it is a second TRUTH. The
 * previous round shipped exactly that bug (a second `ItemListStage` bound the
 * live replica while the panel read the module singleton, and the panel sat on
 * "preparing" forever with every test green). So this file exports one instance
 * and the assembly layer binds it; nobody constructs another.
 *
 * WHY THE COUNTS ARE A READ AND NOT A SUBSCRIPTION. `ChecklistReplica` allows a
 * SINGLE remote listener and the list panel already owns it — subscribing from
 * here would silently replace the panel's own listener and freeze the list.
 * Reading is also the honest model: a count is a function of two documents at
 * the instant it is painted, and every surface that paints it already re-renders
 * on a change to the document it owns. The one thing that is date-driven rather
 * than event-driven (`overdue`) changes at midnight, not while the reader
 * watches.
 */
import type { BoardController } from '../../core/controller.ts';
import type { ChecklistReplica } from '../../core/host-sync.ts';
import type { WorkbenchCounts, WorkbenchSummary } from '../../core/workbench-summary.ts';
import type { WorkbenchPage } from './chrome.ts';
/** Where a page switch and the way out actually happen (the assembly layer's job). */
export interface WorkbenchNavigation {
    readonly navigate: (page: WorkbenchPage) => void;
    readonly exit: () => void;
}
/** A request from one page asking another to open on something specific. */
export interface FocusRequest {
    readonly token: number;
    readonly cardId: string;
}
/**
 * Where to go, and what to show on arrival.
 *
 * A tagged union so a new destination cannot be added without deciding what
 * arriving there means — the failure it prevents is a page that opens on
 * everything while the caller believed it had asked for one thing.
 */
export type LandTarget = {
    readonly page: 'items';
    readonly cardId: string;
} | {
    readonly page: 'board';
    readonly cardId: string;
} | {
    readonly page: 'home';
};
/**
 * The holder. Owns its own lifetime rather than borrowing a mount's: a
 * main-stage panel unmounts every time the reader looks at the conversation, so
 * a lifetime tied to its mount would tear down the replica subscription on
 * every panel switch.
 */
export declare class WorkbenchStage {
    private itemReplica;
    private board;
    private open;
    /**
     * 看板那一侧递过来的一次「只看挂着这张卡的条目」请求。
     *
     * 计数器 + 载荷，不是布尔：布尔会漏掉「在同一个状态下的第二次按」（挂载时读到
     * `true`，之后再看还是 `true`，第二次按就没了声音）。
     */
    private focus;
    private focusToken;
    /**
     * Where a page switch and the way out happen.
     *
     * The panels do NOT know how to change seats: the layout service, the three
     * slot keys and the exit funnel are the assembly layer's business, and a panel
     * that read them would be a panel that breaks when a key moves. It gets a pair
     * of functions instead, absent until the layer binds them — and an absent pair
     * means the bar still renders and the press only reports.
     */
    private navigation;
    private readonly lifetime;
    /**
     * Publish the live faces; the signal already exists and is unchanged.
     * @param replica - the checklist replica, or undefined when the list is off.
     * @param controller - the board controller, or undefined while it settles.
     * @param openCard - the cross-page door to the board, when wired.
     */
    bind(replica: ChecklistReplica | undefined, controller: BoardController | undefined, openCard?: (cardId: string) => void): void;
    /** The plugin's own lifetime, for every timer and subscription inside. */
    signal(): AbortSignal;
    replica(): ChecklistReplica | undefined;
    controller(): BoardController | undefined;
    /** The cross-panel door, when the wiring layer gave one. */
    openCardOf(): ((cardId: string) => void) | undefined;
    /**
     * Publish the two navigation verbs.
     * @param navigation - where a page switch and the way out go.
     */
    bindNavigation(navigation: WorkbenchNavigation): void;
    /**
     * Ask to show another page.
     * @param page - the destination.
     */
    navigate(page: WorkbenchPage): void;
    /** Leave the workbench (back to the shell's conversation). */
    exit(): void;
    /** 装配层（或看板那一侧）请清单只显示挂着这张卡的条目。 */
    focusRowsOf(cardId: string): void;
    /** 面板读它：带 token，所以同一个请求不会被消费两次，也不会漏掉第二次。 */
    focusRequest(): FocusRequest | undefined;
    /**
     * Go to a page AND say what to look at when you arrive.
     *
     * WHY THIS IS ONE VERB AND NOT TWO CALLS. 「去清单」 and 「清单只看挂着这张卡的条目」
     * are one thought: a reader who presses a count is asking a question, and a page that
     * arrives unfiltered answers a different one. Splitting it into `focusRowsOf` then
     * `navigate` would let a caller do the first and forget the second — and the result
     * looks perfectly healthy, just wrong.
     *
     * The intent is a tagged union rather than a loose object so a new destination cannot
     * be added without deciding what arriving there means.
     * @param target - where to go, and what to show.
     */
    land(target: LandTarget): void;
    /**
     * The four numbers the bar and the overview report.
     *
     * Recomputed on every read — a count is not a cached fact, and the cost is one
     * pass over two arrays the reader is already holding.
     * @param now - epoch ms; injectable so a reading is reproducible in tests.
     * @returns the counts, all zero when neither document is available.
     */
    countsOf(now?: number): WorkbenchCounts;
    /**
     * The overview's whole view model, from the same two documents.
     * @param now - epoch ms.
     * @returns the summary.
     */
    summaryOf(now?: number): WorkbenchSummary;
    /** The board's cards, or none when the board has not settled. */
    private tasks;
    /** The checklist's rows, or none when the list is switched off / not settled. */
    private items;
    /**
     * 「等我做什么」 — asked of the board's own controller, exactly the way the board
     * header asks it. One question, one implementation: a second way to count a
     * waiting conversation is how two surfaces come to disagree.
     */
    private demandOf;
    /** Drop every face and end the lifetime; readers then say what they cannot see. */
    unbind(): void;
}
/** THE single stage, exported so the client entry binds THIS one. */
export declare const workbenchStage: WorkbenchStage;
