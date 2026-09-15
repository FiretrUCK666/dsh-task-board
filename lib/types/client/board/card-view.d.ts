/**
 * Card view-model: THE one prioritized summary every task card renders.
 * Pure so the column, the detail badge and tests read the same truth.
 *
 * Priority (matches the breathing-light table — waiting > running >
 * refining > queued > failed-review > unviewed-review > idle):
 * waiting (pending interaction) outranks everything; running = any related
 * session genuinely working; refining = preparation (never 进行中); queued =
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
    kind: 'refining';
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
    state: 'waiting' | 'running' | 'idle';
}
/** Display title: the raw title, or the untitled placeholder when blank.
 *  THE one blank-title judgment — card, board rows, detail header and delete
 *  confirms all read it, so a blank card can never show different faces per
 *  surface. Pure. */
export declare function titleOrUntitled(title: string, untitled: string): string;
/** Which light a card wears. ONE light at a time — see {@link cardLightOf}. */
export type CardLight = 'none' | 'halo' | 'ring';
/**
 * THE card light table, in code (the board's 光效规则表, one row per card):
 *
 *   'halo' — state-bound brightness: the card is working (waiting / running /
 *            refining). Inset and soft: work in flight is not a request;
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
/** Everything TaskCard renders (no JSX here — testable). */
export interface CardViewModel {
    primary: CardPrimary;
    /** Secondary meta chips (chain progress, cron next-run, N 次执行, 新 N). */
    runCount: number;
    lastResult: 'succeeded' | 'failed' | 'cancelled' | undefined;
    queued: number;
    unviewedCount: number;
    /** Whether the card breathes (state-bound, independent of unread). */
    active: boolean;
    /**
     * A task in review whose plain run has settled: the human gate owes an
     * answer. Deliberately NOT `unviewed` — reading a card retires the unread
     * glow (that message stays honest) but never resolves the decision, so this
     * keeps counting after the card has been looked at. Drives the static
     * 「待你决断」 chip and the header demand count.
     */
    awaitingDecision: boolean;
    /** Display truth splits from the gate: refining never reads as running. */
    showingRunning: boolean;
    /** Run guard (open-round gate — queued comments never block). */
    running: boolean;
    dots: CardSessionDot[];
    overflowDots: number;
}
/**
 * Derive the card's view-model from the card's OWN facts. Every field is a
 * reading of the task record (open rounds, pending comments, the refine
 * session), so the chip, the light and the next-action line can never disagree:
 * they are one derivation.
 *
 * There is deliberately NO live-state input. The card's "is this working" is
 * already answered by its own unfinished round (`executing`), and a second
 * answer — the native session `running` flag — disagreed with it in exactly the
 * states the user hit: an externally observed turn keeps a card in 进行中 while
 * no session reports running, so the chip said 进行中 and the light stayed off.
 * `sessionStateOf` only refines the per-session DOTS (waiting > running > idle);
 * absent = no dots.
 */
export declare function cardViewModelOf(task: TaskRecord, opts?: {
    pendingCount?: number;
    waiting?: PendingInteractionKind;
    unviewedCount?: number;
    sessionStateOf?: (sessionId: string) => 'waiting' | 'running' | 'idle';
    sessionIds?: readonly string[];
}): CardViewModel;
/**
 * One quiet "what's next" sentence for the card (scanning aid, never a
 * second status system — it names the same primary the chips already show,
 * plus the schedule horizon when armed). Returns undefined for idle cards
 * with nothing scheduled (no noise). The caller localizes the template;
 * this returns the structured fact so copy lives in one place.
 */
export declare function cardNextActionOf(view: CardViewModel, task: TaskRecord): {
    kind: 'waiting' | 'running' | 'refining' | 'queued' | 'failed' | 'review' | 'scheduled' | 'chain';
    count?: number;
} | undefined;
