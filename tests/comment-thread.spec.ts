/** The comment-thread pure logic: one session-scoped thread model, display
 *  state, and the task-level queue position behind the session chips. */
import { describe, expect, it } from 'vitest'
import { createTask, settleExecution, startExecution, type ExecutionRecord, type TaskRecord } from '../src/core/tasks.ts'
import { commentKindOf, commentRoundState, commentStateKey, queuePositionOf, sessionCommentsOf } from '../src/client/board/comment-thread.ts'

const NOW = 1_700_000_000_000

function sampleTask() {
  return createTask({ title: 't', description: '', prompt: '' }, NOW, 'task-1')
}

/** A task with two settled plain runs: e1 on s-1, e2 on s-2. */
function withTwoRuns(): TaskRecord {
  let { task } = startExecution(sampleTask(), NOW, 'e1')
  task = settleExecution(task, 'e1', 'succeeded', NOW + 1, undefined)
  // A real execution gains its session from the started event; mirror that.
  task = { ...task, executions: task.executions.map((run, index) => index === 0 ? { ...run, sessionId: 's-1' } : run) }
  task = { ...task, executions: [...task.executions, { id: 'e2', sessionId: 's-2', startedAt: NOW + 2, endedAt: NOW + 3, result: 'succeeded' as const, error: undefined }] }
  return task
}

function commentRound(overrides: Partial<ExecutionRecord> & { id: string }): ExecutionRecord {
  const { id, ...rest } = overrides
  return {
    id,
    sessionId: 's-1',
    startedAt: NOW + 10,
    endedAt: undefined,
    result: undefined,
    error: undefined,
    comment: '你好',
    parentExecutionId: 'e1',
    ...rest,
  }
}

/** The e1 run record (session s-1). */
function e1(task: TaskRecord): ExecutionRecord {
  const run = task.executions.find(candidate => candidate.id === 'e1')
  if (run === undefined) throw new Error('e1 missing')
  return run
}

describe('sessionCommentsOf (session-scoped thread)', () => {
  it('merges execution-anchored and session-anchored rounds of the same session', () => {
    const task = {
      ...withTwoRuns(),
      executions: [
        ...withTwoRuns().executions,
        commentRound({ id: 'fromReview', parentExecutionId: 'e1', sessionId: 's-1', startedAt: NOW + 10 }),
        commentRound({ id: 'fromPanel', parentExecutionId: undefined, sessionId: 's-1', sessionAnchor: 's-1', startedAt: NOW + 11 }),
      ],
    }
    expect(sessionCommentsOf(task, 's-1', true).map(view => view.round.id)).toEqual(['fromReview', 'fromPanel'])
  })

  it('never mixes sessions into one thread', () => {
    const task = {
      ...withTwoRuns(),
      executions: [
        ...withTwoRuns().executions,
        commentRound({ id: 'a', parentExecutionId: 'e1', sessionId: 's-1', startedAt: NOW + 10 }),
        commentRound({ id: 'b', parentExecutionId: 'e2', sessionId: 's-2', startedAt: NOW + 11 }),
      ],
    }
    expect(sessionCommentsOf(task, 's-1', true).map(view => view.round.id)).toEqual(['a'])
    expect(sessionCommentsOf(task, 's-2', true).map(view => view.round.id)).toEqual(['b'])
  })

  it('attributes legacy rounds (no anchor) by their recorded session', () => {
    const task = {
      ...withTwoRuns(),
      executions: [
        ...withTwoRuns().executions,
        commentRound({ id: 'legacy', parentExecutionId: undefined, sessionId: 's-1', startedAt: NOW + 10 }),
      ],
    }
    expect(sessionCommentsOf(task, 's-1', true).map(view => view.round.id)).toEqual(['legacy'])
  })

  it('keeps a legacy round with no sessionId attributed by sessionAnchor', () => {
    const task = {
      ...withTwoRuns(),
      executions: [
        ...withTwoRuns().executions,
        commentRound({ id: 'anchorOnly', parentExecutionId: undefined, sessionId: undefined, sessionAnchor: 's-1', startedAt: NOW + 10 }),
      ],
    }
    expect(sessionCommentsOf(task, 's-1', true).map(view => view.round.id)).toEqual(['anchorOnly'])
  })

  it('both surfaces read the SAME thread for a shared session (review page + linked panel)', () => {
    const task = {
      ...withTwoRuns(),
      executions: [
        ...withTwoRuns().executions,
        commentRound({ id: 'fromReview', parentExecutionId: 'e1', sessionId: 's-1', startedAt: NOW + 10 }),
        commentRound({ id: 'fromPanel', parentExecutionId: undefined, sessionId: 's-1', sessionAnchor: 's-1', startedAt: NOW + 11 }),
      ],
    }
    // The review page and the linked panel both call sessionCommentsOf(s-1):
    // identical member set — the "comments don't sync" split is gone.
    const sessionId = e1(task).sessionId
    if (sessionId === undefined) throw new Error('e1 has no session')
    const reviewView = sessionCommentsOf(task, sessionId, true)
    const panelView = sessionCommentsOf(task, 's-1', true)
    expect(reviewView.map(view => view.round.id)).toEqual(panelView.map(view => view.round.id))
  })

  it('never includes plain runs', () => {
    expect(sessionCommentsOf(withTwoRuns(), 's-1', true)).toEqual([])
    expect(sessionCommentsOf(withTwoRuns(), 's-2', true)).toEqual([])
  })

  it('derives display state through the shared comment state rule', () => {
    const task = {
      ...withTwoRuns(),
      executions: [
        ...withTwoRuns().executions,
        commentRound({ id: 'saved', sessionId: 's-1', startedAt: NOW + 11 }),
        commentRound({ id: 'queued', sessionId: 's-1', injectedAt: NOW + 12, startedAt: NOW + 11 }),
      ],
    }
    // Cruise off → saved; cruise on → queued; an injected round is running
    // regardless of the cruise.
    expect(sessionCommentsOf(task, 's-1', false).map(view => view.state)).toEqual(['saved', 'running'])
    expect(sessionCommentsOf(task, 's-1', true).map(view => view.state)).toEqual(['queued', 'running'])
  })
})

describe('commentRoundState', () => {
  it('settles into the recorded result (cancelled when none)', () => {
    expect(commentRoundState(commentRound({ id: 'c1', endedAt: NOW + 5, result: 'succeeded' }), false)).toBe('succeeded')
    expect(commentRoundState(commentRound({ id: 'c2', endedAt: NOW + 5, result: 'failed' }), false)).toBe('failed')
    expect(commentRoundState(commentRound({ id: 'c3', endedAt: NOW + 5, result: undefined }), false)).toBe('cancelled')
  })

  it('is running once injected, queued/saved before that', () => {
    expect(commentRoundState(commentRound({ id: 'c1', injectedAt: NOW + 5 }), true)).toBe('running')
    expect(commentRoundState(commentRound({ id: 'c2' }), true)).toBe('queued')
    expect(commentRoundState(commentRound({ id: 'c3' }), false)).toBe('saved')
  })
})

describe('queuePositionOf', () => {
  /** Task with pending comments on two executions: c1 (e1, first) and c2, c3 (e2). */
  function withPending(): TaskRecord {
    return {
      ...withTwoRuns(),
      executions: [
        ...withTwoRuns().executions,
        commentRound({ id: 'c1', parentExecutionId: 'e1', startedAt: NOW + 10 }),
        commentRound({ id: 'c2', parentExecutionId: 'e2', startedAt: NOW + 11 }),
        commentRound({ id: 'c3', parentExecutionId: 'e2', startedAt: NOW + 12 }),
      ],
    }
  }

  it('numbers positions across the whole task, not per execution', () => {
    const task = withPending()
    expect(queuePositionOf(task, 'c1')).toBe(1)
    expect(queuePositionOf(task, 'c2')).toBe(2)
    expect(queuePositionOf(task, 'c3')).toBe(3)
  })

  it('counts an injected (running) round as occupying the queue head', () => {
    const task = {
      ...withPending(),
      executions: withPending().executions.map(round =>
        round.id === 'c1' ? { ...round, injectedAt: NOW + 13 } : round),
    }
    // c1 is running (injected, unsettled): c2 and c3 follow it.
    expect(queuePositionOf(task, 'c2')).toBe(2)
    expect(queuePositionOf(task, 'c3')).toBe(3)
  })

  it('returns 0 for settled rounds and plain runs', () => {
    const task = {
      ...withPending(),
      executions: [
        ...withPending().executions,
        commentRound({ id: 'c9', parentExecutionId: 'e2', startedAt: NOW + 13, endedAt: NOW + 14, result: 'succeeded' }),
      ],
    }
    expect(queuePositionOf(task, 'c9')).toBe(0)
    expect(queuePositionOf(task, 'e1')).toBe(0)
    expect(queuePositionOf(task, 'missing')).toBe(0)
  })
})

describe('commentKindOf', () => {
  it('maps every state to a chip color', () => {
    expect(commentKindOf('succeeded')).toBe('success')
    expect(commentKindOf('failed')).toBe('error')
    expect(commentKindOf('cancelled')).toBe('muted')
    expect(commentKindOf('running')).toBe('warn')
    expect(commentKindOf('queued')).toBe('warn')
    expect(commentKindOf('saved')).toBe('muted')
  })
})

describe('commentStateKey', () => {
  it('maps every state to its locale key', () => {
    expect(commentStateKey('succeeded')).toBe('review.commentSucceeded')
    expect(commentStateKey('failed')).toBe('review.commentFailed')
    expect(commentStateKey('cancelled')).toBe('review.commentCancelled')
    expect(commentStateKey('running')).toBe('review.commentRunning')
    expect(commentStateKey('queued')).toBe('review.commentQueued')
    expect(commentStateKey('saved')).toBe('review.commentPending')
  })
})