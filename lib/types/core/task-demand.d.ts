/**
 * 「这张卡欠人什么」— THE one derivation of the human gate, shared by every
 * surface that asks "is there something here that needs a person?" (the card's
 * 待你决断 chip, the header demand row, the notification drawer's review rows
 * and the review page's own state).
 *
 * WHY THIS MODULE EXISTS
 *
 * A card can be worked on through five lanes — a plain run, a saved comment
 * injected into a session, an externally-observed native turn, a direct steer,
 * a session-rule instruction — and ALL FIVE land it in 待审核 (`settleColumnOf`
 * reads `hasCompletedWork`, which has always been lane-complete). But the
 * display layer used to ask the question through `plainRunsOf`, whose filter is
 * `comment === undefined` and therefore sees exactly ONE of them. So a card
 * whose work came from a comment / native turn / steer / rule sat visibly in
 * the review column while showing no 待你决断, no failure word, and counting
 * zero in the header — with the bell still demanding a decision for it.
 *
 * Three rules this module states once, for everyone:
 *
 *  1. LANES ARE NOT A FILTER. "What did this card finish" is asked over every
 *     round on the task. The plain-run set survives for exactly one thing it is
 *     actually for: numbering the 执行 sequence (`plainRunsOf`), which is a
 *     statement about the UI's run counter, not about the work.
 *  2. THE GATE IS A CONJUNCTION, NOT A COLUMN. A card owes a decision when it
 *     is in review AND something finished AND the user has not looked at that
 *     something yet. 通过/打回 clear it by moving the card; looking clears it
 *     by the read clock (`sessionUnviewedOf` — the same clock as the 新 chip
 *     and the row glow). Two clocks, one fact, one derivation.
 *  3. THE RELATED SESSION SET IS ONE SET. "Which conversations is this card
 *     responsible for" is `relatedSessionIdsOf` (binds + rounds + live linked
 *     members, minus removed) — never "the sessions that happen to own a round
 *     on this card". A dragged-in session asking a question is a live block
 *     whether or not this card has run it yet.
 *
 * Framework-free and pure, so the board, the drawer, the detail and the tests
 * read one answer.
 */
import type { PendingInteractionKind } from './controller.ts';
import type { TaskRecord } from './tasks.ts';
/**
 * One finished piece of work on a card: a settled round that SUCCEEDED or
 * FAILED, over every lane. Cancelled rounds are deliberately absent — a cancel
 * is an abort, not something a person has to rule on (the same reading
 * `settleColumnOf` already gives the column).
 */
export interface CompletedWork {
    roundId: string;
    /** The conversation that did it; absent only for legacy session-less rows. */
    sessionId: string | undefined;
    result: 'succeeded' | 'failed';
    endedAt: number;
}
/** The newest finished work on a card, any lane. undefined = nothing decided. */
export declare function latestCompletedOf(task: TaskRecord): CompletedWork | undefined;
/**
 * THE gate. Three readings, no fourth:
 *
 *   'none'   — the card is not in the review column, or nothing has finished
 *              on it that a person would have to rule on (a chain parked in
 *              进行中, a card dragged into review by hand, a cancelled-only
 *              card — "where is it" is not "what do I owe").
 *   'unseen' — finished, in review, and the user has not looked at THAT
 *              conversation yet. Every surface that owes an action reads this
 *              one state, so the card's chip, the header's number and the
 *              drawer's row can no longer disagree about whether a card is
 *              waiting.
 *   'seen'   — finished and looked at. The gate survives in the COLUMN (only
 *              通过/打回 moves the card) but stops asking: reading is not
 *              deciding, and neither of the two is the other's job.
 */
export type GateState = 'none' | 'unseen' | 'seen';
/** The gate, carrying the work it is about so a surface can name the outcome. */
export interface HumanGate {
    state: GateState;
    /** The work the gate is about (absent exactly when `state` is 'none'). */
    work?: CompletedWork;
    /** The session the gate names, when the work has one. */
    sessionId?: string;
}
/**
 * One conversation's gate — the same three readings, scoped to that session's
 * own rounds. THE per-session answer the drawer's review rows read, so a row
 * exists for exactly the sessions the card's own chip is shouting about.
 */
export declare function sessionGateOf(task: TaskRecord, sessionId: string): HumanGate;
/**
 * The card's gate: the loudest session gate wins (an unlooked-at conversation
 * outranks one already read, so a card is 'unseen' whenever ANY of its
 * conversations still owes a look), otherwise the newest finished work's own
 * gate. One reading, so `card.awaitingDecision`, the header's 待审核 count and
 * the drawer's rows are the same statement by construction.
 */
export declare function gateOf(task: TaskRecord): HumanGate;
/** One conversation suspended on a person (approval / plan review / question). */
export interface WaitingSession {
    sessionId: string;
    waitingKind: PendingInteractionKind;
    /**
     * The numbered run this conversation belongs to, when it carried one. Absent
     * for a bound conversation that has never run on this card — the caller names
     * the session in that case instead of inventing a run number.
     */
    executionId?: string;
}
/**
 * THE 「等你处理」 derivation: every conversation of this card that is
 * suspended on the user right now, read over `relatedSessionIdsOf` (the same
 * set the card's glow, its session dots, the bell and the column's live leg
 * all read) rather than over the card's own round list.
 *
 * The round list is a subset — a session dragged in from the workspace, or
 * pulled in by a 会话建卡, is responsible for this card from the moment it is
 * bound, with or without a board round behind it. That difference is exactly
 * why the bell used to ring for a question the card itself never mentioned.
 */
export declare function waitingSessionsOf(task: TaskRecord, pendingOf: (sessionId: string | undefined) => PendingInteractionKind | undefined, linkedIdsOf?: (task: TaskRecord) => readonly string[]): WaitingSession[];
/** What the board owes the user, as one number for the whole surface. */
export interface BoardDemand {
    /** Total items awaiting a human: waiting conversations + cards in the gate. */
    total: number;
    /** Conversations suspended on a question / approval / plan. */
    waiting: number;
    /** Cards whose finished work nobody has looked at yet. */
    review: number;
}
/**
 * The header's one-line answer to 「等我做什么」. Its review half reads
 * `gateOf`, so it counts exactly the cards whose own chip says 待你决断 and
 * exactly the conversations the bell will list — the number on screen, the
 * chip on the card and the row in the drawer are the same set by construction,
 * and looking at a card moves all three together.
 */
export declare function boardDemandOf(tasks: readonly TaskRecord[], pendingOf: (sessionId: string | undefined) => PendingInteractionKind | undefined, linkedIdsOf?: (task: TaskRecord) => readonly string[]): BoardDemand;
