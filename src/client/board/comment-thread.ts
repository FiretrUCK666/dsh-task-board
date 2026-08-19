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
 * injection stays task-level (the unified dispatcher injects a task's
 * comments in submission order, one at a time), so a round's queue position
 * is computed over the whole task, not the filtered view subset.
 */
import type { ExecutionRecord, TaskRecord } from '../../core/tasks.ts'

/** The display state of one comment round, mirroring the unified dispatcher. */
export type CommentViewState =
  | 'saved'      // cruise off — the round stays saved, never injected.
  | 'queued'     // cruise on, waiting for the budget / the task's busy round.
  | 'running'    // injected; the session is running it.
  | 'succeeded'  // settled successfully (or a matched command round).
  | 'failed'     // settled with an error (or a command outcome kind:error).
  | 'cancelled'  // settled without an outcome.

/** One comment round as a session surface renders it. */
export interface CommentView {
  round: ExecutionRecord
  state: CommentViewState
}

/** The display state of one round, absent any UI concerns. */
export function commentRoundState(round: ExecutionRecord, cruiseOn: boolean): CommentViewState {
  // An externally-observed round runs out-of-band until it settles — never
  // "saved/queued" (it is not waiting for the dispatcher).
  if (round.external === true && round.endedAt === undefined) return 'running'
  if (round.endedAt !== undefined) return round.result ?? 'cancelled'
  if (round.injectedAt !== undefined) return 'running'
  return cruiseOn ? 'queued' : 'saved'
}

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
export function sessionCommentsOf(task: TaskRecord, sessionId: string, cruiseOn: boolean): CommentView[] {
  return task.executions
    .filter((round): round is ExecutionRecord & { comment: string } =>
      round.comment !== undefined
      && (round.sessionId === sessionId
        // Legacy safety: a round that never recorded its session but is
        // anchored to this session still belongs to its thread.
        || (round.sessionId === undefined && round.sessionAnchor === sessionId)))
    .map(round => ({ round, state: commentRoundState(round, cruiseOn) }))
}

/**
 * The 1-based queue position of a pending round among the task's pending
 * comment rounds (saved/queued/running, submission order) — the position a
 * "排队中 · 第 N 位" chip shows. The queue is task-level: the dispatcher
 * injects a task's comments in submission order regardless of which session
 * they target, so the position is computed over the whole task. Returns 0
 * when the round is not in the pending set (it is settled, or not a comment
 * round at all).
 */
export function queuePositionOf(task: TaskRecord, roundId: string): number {
  const pending = task.executions
    // External rounds are never queued (they run out-of-band) — exclude them.
    .filter(round => round.comment !== undefined && round.endedAt === undefined && round.external !== true)
    .sort((a, b) => a.startedAt - b.startedAt)
  const index = pending.findIndex(round => round.id === roundId)
  return index < 0 ? 0 : index + 1
}

/** The chip color of a comment display state. */
export function commentKindOf(state: CommentViewState): 'success' | 'error' | 'warn' | 'muted' {
  switch (state) {
    case 'succeeded': return 'success'
    case 'failed': return 'error'
    case 'running':
    case 'queued': return 'warn'
    default: return 'muted'
  }
}

/** The locale key of a comment state's chip label (callers pass `{ n }` for queued). */
export function commentStateKey(state: CommentViewState):
  | 'review.commentSucceeded'
  | 'review.commentFailed'
  | 'review.commentCancelled'
  | 'review.commentRunning'
  | 'review.commentQueued'
  | 'review.commentPending' {
  switch (state) {
    case 'succeeded': return 'review.commentSucceeded'
    case 'failed': return 'review.commentFailed'
    case 'cancelled': return 'review.commentCancelled'
    case 'running': return 'review.commentRunning'
    case 'queued': return 'review.commentQueued'
    case 'saved': return 'review.commentPending'
  }
}