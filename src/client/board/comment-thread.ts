/**
 * Comment-thread pure logic for the review page: which comment rounds belong
 * to one execution, their display state, and their position in the task's
 * pending comment queue. Framework-free and locale-free so the rules are
 * unit-testable in isolation (same pattern as review-transcript /
 * context-meter / menu-direction).
 *
 * Comments are per-execution in the UI: a round belongs to the plain run it
 * was submitted from (`parentExecutionId`, recorded by the controller since
 * the field exists; persisted rows without it fall back to the session they
 * share with the run — executions carry one session each in practice). The
 * comment *queue* that drives injection stays task-level (the unified
 * dispatcher injects a task's comments in submission order, one at a time),
 * so a round's queue position is computed over the whole task, not the
 * filtered page subset.
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

/** One comment round as the review page renders it. */
export interface CommentView {
  round: ExecutionRecord
  state: CommentViewState
}

/** The display state of one round, absent any UI concerns. */
export function commentRoundState(round: ExecutionRecord, cruiseOn: boolean): CommentViewState {
  if (round.endedAt !== undefined) return round.result ?? 'cancelled'
  if (round.injectedAt !== undefined) return 'running'
  return cruiseOn ? 'queued' : 'saved'
}

/**
 * The comment thread of one execution: every comment round submitted from
 * that run's page (its session is the one the review page continues), oldest
 * first. Rounds of other executions never appear here — each execution's
 * comments live on its own page. Legacy rounds without `parentExecutionId`
 * are attributed by the session they share with the run.
 */
export function commentsOf(task: TaskRecord, target: ExecutionRecord, cruiseOn: boolean): CommentView[] {
  return task.executions
    .filter((round): round is ExecutionRecord & { comment: string } => {
      if (round.comment === undefined) return false
      if (round.parentExecutionId !== undefined) return round.parentExecutionId === target.id
      return round.sessionId !== undefined
        && target.sessionId !== undefined
        && round.sessionId === target.sessionId
    })
    .map(round => ({ round, state: commentRoundState(round, cruiseOn) }))
}

/**
 * The 1-based queue position of a pending round among the task's pending
 * comment rounds (saved/queued/running, submission order) — the position a
 * "排队中 · 第 N 位" chip shows. The queue is task-level: the dispatcher
 * injects a task's comments in submission order regardless of which
 * execution they continue, so the position is computed over the whole task.
 * Returns 0 when the round is not in the pending set (it is settled, or not
 * a comment round at all).
 */
export function queuePositionOf(task: TaskRecord, roundId: string): number {
  const pending = task.executions
    .filter(round => round.comment !== undefined && round.endedAt === undefined)
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