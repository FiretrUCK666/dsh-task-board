/**
 * Card view-model: THE one prioritized summary every task card renders.
 * Pure so the column, the detail badge and tests read the same truth.
 *
 * Priority (matches the breathing-light table — waiting > running >
 * queued > failed-review > unviewed-review > idle):
 * waiting (pending interaction) outranks everything; running = any related
 * session genuinely working; queued =
 * saved comments waiting for the dispatcher; failed = latest plain run
 * failed in review; review = succeeded awaiting confirmation (unviewed only
 * for the glow, read review stays quiet); idle otherwise.
 */
import type { PendingInteractionKind } from '../../core/controller.ts';
import { type TaskRecord } from '../../core/tasks.ts';
/** The card's primary line (one emphasis). */
export type CardPrimary = {
    kind: 'waiting';
    waiting: PendingInteractionKind;
} | {
    kind: 'running';
} | {
    kind: 'queued';
    count: number;
} | {
    kind: 'failed';
} | {
    kind: 'review';
    unviewed: boolean;
} | {
    kind: 'idle';
};
/** One related-session dot (max 3 rendered, +N overflow). */
export interface CardSessionDot {
    sessionId: string;
    /** waiting/running = live; unread = a finished run this card has not had
     *  reviewed yet (same clock as the detail row's glow); idle otherwise. */
    state: 'waiting' | 'running' | 'unread' | 'idle';
}
/** Display title: the raw title, or the untitled placeholder when blank.
 *  THE one blank-title judgment — card, board rows, detail header and delete
 *  confirms all read it, so a blank card can never show different faces per
 *  surface. Pure. */
export declare function titleOrUntitled(title: string, untitled: string): string;
/**
 * 卡片「更新于」的时刻：这张卡**自己的工作推进**——创建，以及每一轮的开始与
 * 结束（跑起来的会话、完成的一轮）。
 *
 * 为什么不直接读 `task.updatedAt`：那是**同步戳**，不是「这张卡什么时候动过」。
 * 改一次列内顺序（一次顶格、一次手动拖动）会给**同栏每一张被让位的卡片**盖上
 * 新的 `updatedAt`——同步合并按它排序，漏盖就是两台设备顺序漂移，所以这个戳
 * 去掉不得。可一旦直接显示它，一次顶格就会让整栏几百张卡一起写「刚刚」，
 * 恰好把「哪个先完成」这个信号抹平。于是显示口径与同步口径在这里分家：
 * 戳照盖，屏上读的是这张卡自己的进展。
 */
export declare function cardUpdatedAtOf(task: TaskRecord): number;
/** Which light a card wears. ONE light at a time — see {@link cardLightOf}. */
export type CardLight = 'none' | 'halo' | 'ring';
/**
 * THE card light table, in code (the board's 光效规则表, one row per card):
 *
 *   'halo' — state-bound brightness: the card is working (waiting / running).
 *           Inset and soft: work in flight is not a request;
 *   'ring' — unread: a run finished and this content has not been looked at.
 *            Outer and stronger: it IS a request to look;
 *   'none' — read and settled, or idle.
 *
 * A card that is BOTH working and unread wears the halo — this function is the
 * single place that decides, so the precedence is stated rather than inherited
 * from stylesheet order (both lights set the same `animation` property through
 * ONE `data-light` switch, so there is no second rule to fight).
 */
export declare function cardLightOf(active: boolean, unviewed: boolean): CardLight;
/**
 * THE session-dot state — one derivation for every dot a card renders, so
 * the strip can never answer "which conversation is which" differently from
 * the detail's rows:
 *
 *   waiting  — the session is suspended on a question / plan / approval;
 *   running  — its own turn or a running subagent descendant works now;
 *   unread   — a finished run on THIS card has not been reviewed yet
 *              (the per-session clock `sessionUnviewedOf`, the exact clock
 *              the detail's session-row glow reads);
 *   idle     — settled and seen (or a session with no run and no read state).
 *
 * Live states outrank unread: a conversation that is both working and
 * unreviewed reads as working — one dot, one loudest truth. Pure: the board
 * supplies the two live faces, the precedence lives here once.
 */
export declare function cardSessionDotStateOf(task: TaskRecord, sessionId: string, ctx: {
    pendingInteractionOf: (sessionId: string) => PendingInteractionKind | undefined;
    activeOf: (sessionId: string) => boolean;
}): CardSessionDot['state'];
/** Everything TaskCard renders (no JSX here — testable). */
export interface CardViewModel {
    primary: CardPrimary;
    /** Secondary meta chips (chain progress, cron next-run, N 次执行, 新 N). */
    runCount: number;
    lastResult: 'succeeded' | 'failed' | 'cancelled' | undefined;
    queued: number;
    unviewedCount: number;
    /**
     * Whether the card breathes: a state-bound fact, independent of unread. True
     * for waiting / running AND for a card sitting in the 进行中
     * column (the same `task.status` the yellow border reads), so the border and
     * the breath are one fact — see {@link cardLightOf}.
     */
    active: boolean;
    /**
     * A task in review whose plain run has settled: the human gate owes an
     * answer. Deliberately NOT `unviewed` — reading a card retires the unread
     * glow (that message stays honest) but never resolves the decision, so this
     * keeps counting after the card has been looked at. Drives the static
     * 「待你决断」 chip and the header demand count.
     */
    awaitingDecision: boolean;
    /** Display truth splits from the gate: an eventless round never reads as
     *  running. */
    showingRunning: boolean;
    /** Run guard (open-round gate — queued comments never block). */
    running: boolean;
}
/**
 * Derive the card's view-model from the card's OWN facts. Every field is a
 * reading of the task record (open rounds, pending comments), so the chip,
 * the light and the next-action line can never disagree:
 * they are one derivation.
 *
 * There is deliberately NO live-state input. The card's "is this working" is
 * already answered by its own unfinished round (`executing`), and a second
 * answer — the native session `running` flag — disagreed with it in exactly the
 * states the user hit: an externally observed turn keeps a card in 进行中 while
 * no session reports running, so the chip said 进行中 and the light stayed off.
 * The per-session DOTS are likewise their own derivation
 * ({@link cardSessionDotStateOf}) — this view model never carries them.
 */
export declare function cardViewModelOf(task: TaskRecord, opts?: {
    pendingCount?: number;
    waiting?: PendingInteractionKind;
    unviewedCount?: number;
}): CardViewModel;
/**
 * One quiet "what's next" sentence for the card (scanning aid, never a
 * second status system — it names the same primary the chips already show,
 * plus the schedule horizon when armed). Returns undefined for idle cards
 * with nothing scheduled (no noise). The caller localizes the template;
 * this returns the structured fact so copy lives in one place.
 */
export declare function cardNextActionOf(view: CardViewModel, task: TaskRecord): {
    kind: 'waiting' | 'running' | 'queued' | 'failed' | 'review' | 'scheduled' | 'chain';
    count?: number;
} | undefined;
