/**
 * Comment-thread pure logic for the session surfaces: which comment rounds
 * belong to one native session's thread, their display state, and their
 * position in the task's pending comment queue. Framework-free and
 * locale-free so the rules are unit-testable in isolation (same pattern as
 * review-transcript / context-meter / menu-direction).
 *
 * One thread model per SESSION: a round belongs to the thread of the native
 * session it is injected into (`sessionId`), regardless of which anchor
 * created it (an execution-anchored comment from a review page or a
 * session-anchored comment from a linked panel). Both surfaces — the
 * execution review page and the linked-session panel — read the SAME
 * sessionCommentsOf, so a comment typed on one surface is instantly visible
 * on the other for the same session. The comment *queue* that drives
 * injection is per SESSION (the lane is the conversation): a round waits for
 * the rounds saved earlier in ITS OWN session, never for another
 * conversation's work, so a round's queue position is computed within its
 * lane — not over the whole task.
 */
import type { ExecutionRecord, TaskRecord } from '../../core/tasks.ts';
/** The display state of one comment round, mirroring the unified dispatcher. */
export type CommentViewState = 'saved' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
/** One comment round as a session surface renders it. */
export interface CommentView {
    round: ExecutionRecord;
    state: CommentViewState;
}
/** The display state of one round, absent any UI concerns. */
export declare function commentRoundState(round: ExecutionRecord, cruiseOn: boolean): CommentViewState;
/**
 * The comment thread of one native session — every comment round injected
 * into (or queued for) that `sessionId`, oldest first. THE single source for
 * both surfaces:
 * - the execution review page shows the thread of its execution's session;
 * - the linked-session panel shows the thread of its own session.
 * Both anchors (execution `parentExecutionId` and linked `sessionAnchor`)
 * are ignored for membership — they only ever point at this same session, so
 * comments typed on either surface are visible on both. Rounds that carry no
 * sessionId yet (none today: newCommentRound always sets it) fall back to
 * session-anchored attribution for legacy safety.
 */
export declare function sessionCommentsOf(task: TaskRecord, sessionId: string, cruiseOn: boolean): CommentView[];
/**
 * The 1-based queue position of a pending round within ITS OWN SESSION'S
 * lane (saved comments for that session, submission order) — what a
 * 「排队中 · 第 N 位」 chip shows.
 *
 * **One row at a time — never in a loop.** This function re-scans the whole card on
 * every call, so asking it once per comment row costs `n²`. A list asks
 * `queuePositionsOf` once instead; this entry stays for the callers that genuinely
 * have one row (a test, a single chip) and it shares the lane/pending judgement with
 * that one so the two can never disagree about a row.
 *
 * @param task - the card holding the round.
 * @param roundId - the round to locate.
 * @returns its 1-based position in its lane, or 0 when it is not pending.
 */
export declare function queuePositionOf(task: TaskRecord, roundId: string): number;
/**
 * **Every** pending round's queue position, computed in ONE pass.
 *
 * ── 为什么必须有这一个，而不是让调用方多调几次上面那个 ────────────────────────
 *
 * 上面那个函数回答「这一条排第几」，而它每次都要把整张卡的执行列表过滤一遍、排序一遍、
 * 再扫一遍。评论列表是一行一条，于是一屏 n 行就是 n 次全表扫描——成本随条数**平方**
 * 增长。实测（`scripts/probes/bench-comment-queue.mjs`，同一份数据、同一个函数）：
 * 50 条 0.14ms、200 条 1.5ms、400 条 5.5ms、800 条 21.3ms。一屏评论里只要挂过几十上百
 * 条，光算这一列位次就吃掉半帧；而它每 3 秒随轮询又算一次，正好落在读者上下滑动的那
 * 一下上。
 *
 * 位次是**整条 lane 的属性**，不是某一行的属性：所以正确的形状是「一条 lane 算一次，
 * 逐行只查」，而不是「每行自己算一遍」。一次算的价钱与条数成**线性**（同一个 bench：
 * 800 条 0.06ms）。
 *
 * @param task - 那张卡（评论回合挂在它的执行列表里）。
 * @returns `roundId → 1-based 位次`；不在排队集合里的 id 不在表里（等价于 0）。
 */
export declare function queuePositionsOf(task: TaskRecord): Map<string, number>;
/** The chip color of a comment display state. */
export declare function commentKindOf(state: CommentViewState): 'success' | 'error' | 'warn' | 'muted';
/** The newest round of a session's thread as a display summary: its body
 *  text ('' when nothing renderable) plus the state word the surface falls
 *  back to — the 「最新」 slot never shows an empty caption again. */
export interface LatestCommentView {
    /** The newest round's body text ('' = no renderable text). */
    text: string;
    /** The locale key of the state chip the fallback renders. */
    stateKey: ReturnType<typeof commentStateKey>;
    /** The round's submission instant. */
    at: number | undefined;
}
/** The latest round of one session's comment thread (the 「最新」 source). */
export declare function latestCommentView(task: TaskRecord, sessionId: string, cruiseOn: boolean): LatestCommentView | undefined;
/** The locale key of a comment state's chip label (callers pass `{ n }` for queued). */
export declare function commentStateKey(state: CommentViewState): 'review.commentSucceeded' | 'review.commentFailed' | 'review.commentCancelled' | 'review.commentRunning' | 'review.commentQueued' | 'review.commentPending';
