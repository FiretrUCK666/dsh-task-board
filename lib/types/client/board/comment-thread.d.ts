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
 * The lane is the session, not the card: comments waiting for a DIFFERENT
 * conversation are not ahead of this one, and would otherwise read as
 * 「第 3 位」 while their own session is idle and about to take them. Returns
 * 0 when the round is not in the pending set (settled, injected, or not a
 * comment round at all).
 */
export declare function queuePositionOf(task: TaskRecord, roundId: string): number;
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
