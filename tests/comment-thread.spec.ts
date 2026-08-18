/**
 * Comment-thread pure logic: per-execution attribution, display state, and
 * the task-level queue position behind the review page's chips.
 */
import { describe, expect, it } from 'vitest'
import { createTask, settleExecution, startExecution, type ExecutionRecord, type TaskRecord } from '../src/core/tasks.ts'
import { commentKindOf, commentRoundState, commentStateKey, commentsOf, queuePositionOf, sessionThreadOf } from '../src/client/board/comment-thread.ts'

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

/** The e2 run record (session s-2). */
function e2(task: TaskRecord): ExecutionRecord {
  const run = task.executions.find(candidate => candidate.id === 'e2')
  if (run === undefined) throw new Error('e2 missing')
  return run
}

describe('commentsOf attribution', () => {
  it('shows only rounds whose parentExecutionId is the target execution', () => {
    const task = {
      ...withTwoRuns(),
      executions: [
        ...withTwoRuns().executions,
        commentRound({ id: 'c1', parentExecutionId: 'e1', startedAt: NOW + 10 }),
        commentRound({ id: 'c2', parentExecutionId: 'e2', startedAt: NOW + 11 }),
      ],
    }
    const onE1 = commentsOf(task, e1(task), true)
    expect(onE1.map(view => view.round.id)).toEqual(['c1'])
    const onE2 = commentsOf(task, e2(task), true)
    expect(onE2.map(view => view.round.id)).toEqual(['c2'])
  })

  it('attributes legacy rounds (no parentExecutionId) by shared session', () => {
    const task = {
      ...withTwoRuns(),
      executions: [
        ...withTwoRuns().executions,
        commentRound({ id: 'legacy1', parentExecutionId: undefined, sessionId: 's-1', startedAt: NOW + 10 }),
        commentRound({ id: 'legacy2', parentExecutionId: undefined, sessionId: 's-2', startedAt: NOW + 11 }),
      ],
    }
    expect(commentsOf(task, e1(task), true).map(view => view.round.id)).toEqual(['legacy1'])
    expect(commentsOf(task, e2(task), true).map(view => view.round.id)).toEqual(['legacy2'])
  })

  it('never mixes plain runs into the thread', () => {
    const task = withTwoRuns()
    expect(commentsOf(task, e1(task), true)).toEqual([])
    expect(commentsOf(task, e2(task), true)).toEqual([])
  })

  it('drops rounds with no session when the target has none either', () => {
    const task = {
      ...withTwoRuns(),
      executions: [...withTwoRuns().executions, commentRound({ id: 'c1', sessionId: undefined, parentExecutionId: undefined })],
    }
    expect(commentsOf(task, e1(task), true).map(view => view.round.id)).toEqual([])
  })

  it('keeps rounds with a parent id even when sessions differ (re-used session)', () => {
    const task = {
      ...withTwoRuns(),
      executions: [...withTwoRuns().executions, commentRound({ id: 'c1', parentExecutionId: 'e1', sessionId: 's-9', startedAt: NOW + 10 })],
    }
    // The explicit parent wins over the session; a legacy round on s-9 would
    // not match e1.
    expect(commentsOf(task, e1(task), true).map(view => view.round.id)).toEqual(['c1'])
  })

  it('never shows session-anchored rounds on an execution page', () => {
    const task = {
      ...withTwoRuns(),
      executions: [
        ...withTwoRuns().executions,
        // A session-anchored round whose session coincides with e1's.
        commentRound({ id: 'driven', parentExecutionId: undefined, sessionId: 's-1', sessionAnchor: 's-1', startedAt: NOW + 10 }),
        commentRound({ id: 'real', parentExecutionId: 'e1', startedAt: NOW + 11 }),
      ],
    }
    // Only the execution-anchored round appears; the anchored one belongs to
    // the linked session's own thread.
    expect(commentsOf(task, e1(task), true).map(view => view.round.id)).toEqual(['real'])
  })
})

describe('sessionThreadOf', () => {
  it('shows only the rounds anchored to the given linked session', () => {
    const task = {
      ...withTwoRuns(),
      executions: [
        ...withTwoRuns().executions,
        commentRound({ id: 'c1', parentExecutionId: 'e1', startedAt: NOW + 10 }),
        commentRound({ id: 'driven', parentExecutionId: undefined, sessionId: 'linked-7', sessionAnchor: 'linked-7', startedAt: NOW + 11 }),
        commentRound({ id: 'driven2', parentExecutionId: undefined, sessionId: 'linked-7', sessionAnchor: 'linked-7', startedAt: NOW + 12 }),
        commentRound({ id: 'other', parentExecutionId: undefined, sessionId: 'linked-9', sessionAnchor: 'linked-9', startedAt: NOW + 13 }),
      ],
    }
    expect(sessionThreadOf(task, 'linked-7', true).map(view => view.round.id)).toEqual(['driven', 'driven2'])
    expect(sessionThreadOf(task, 'linked-9', true).map(view => view.round.id)).toEqual(['other'])
    // A session with no anchored rounds shows an empty thread.
    expect(sessionThreadOf(task, 's-1', true)).toEqual([])
  })

  it('derives display state through the shared comment state rule', () => {
    const task = {
      ...withTwoRuns(),
      executions: [
        ...withTwoRuns().executions,
        commentRound({ id: 'saved', parentExecutionId: undefined, sessionId: 'linked-7', sessionAnchor: 'linked-7', startedAt: NOW + 11 }),
        commentRound({ id: 'queued', parentExecutionId: undefined, sessionId: 'linked-7', sessionAnchor: 'linked-7', startedAt: NOW + 12, injectedAt: NOW + 13 }),
      ],
    }
    // Cruise off → saved; cruise on → queued; an injected round is running
    // regardless of the cruise.
    expect(sessionThreadOf(task, 'linked-7', false).map(view => view.state)).toEqual(['saved', 'running'])
    expect(sessionThreadOf(task, 'linked-7', true).map(view => view.state)).toEqual(['queued', 'running'])
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