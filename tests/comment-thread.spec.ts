/** The comment-thread pure logic: one session-scoped thread model, display
 *  state, and the task-level queue position behind the session chips. */
import { describe, expect, it } from 'vitest'
import { createTask, newDirectRound, newExternalRound, pendingCommentCount, settleExecution, startExecution, type ExecutionRecord, type TaskRecord } from '../src/core/tasks.ts'
import { commentKindOf, commentRoundState, commentStateKey, latestCommentView, queuePositionOf, sessionCommentsOf } from '../src/client/board/comment-thread.ts'

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

  it('includes direct-send rounds (already delivered, settled-succeeded)', () => {
    const task = {
      ...withTwoRuns(),
      executions: [
        ...withTwoRuns().executions,
        newDirectRound({ id: 'd1', now: NOW + 10, text: '直发一句', sessionId: 's-1' }),
      ],
    }
    const views = sessionCommentsOf(task, 's-1', true)
    expect(views.map(view => view.round.id)).toEqual(['d1'])
    expect(views[0].round.direct).toBe(true)
    // Settled at birth: no queue position, no pending count impact.
    expect(views[0].state).toBe('succeeded')
    expect(queuePositionOf(task, 'd1')).toBe(0)
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

  it('numbers positions within one session lane (all three target s-1 here)', () => {
    const task = withPending()
    expect(queuePositionOf(task, 'c1')).toBe(1)
    expect(queuePositionOf(task, 'c2')).toBe(2)
    expect(queuePositionOf(task, 'c3')).toBe(3)
  })

  it('a comment on ANOTHER session is not ahead of this lane (第 1 位，不是第 3 位)', () => {
    // The chip must describe the queue this comment is actually standing in.
    // Counting the whole card made a comment that could start immediately
    // announce itself as 「第 3 位」 behind two rounds of unrelated
    // conversations — the exact confusion the user hit.
    const task = {
      ...withPending(),
      executions: [
        ...withPending().executions,
        commentRound({ id: 'x1', sessionId: 's-2', parentExecutionId: 'e2', startedAt: NOW + 13 }),
        commentRound({ id: 'x2', sessionId: 's-2', parentExecutionId: 'e2', startedAt: NOW + 14 }),
      ],
    }
    expect(queuePositionOf(task, 'x1')).toBe(1)
    expect(queuePositionOf(task, 'x2')).toBe(2)
    // …and the s-1 lane keeps counting only its own rounds.
    expect(queuePositionOf(task, 'c1')).toBe(1)
  })

  it('an injected (running) head round is not a position in the queue', () => {
    const task = {
      ...withPending(),
      executions: withPending().executions.map(round =>
        round.id === 'c1' ? { ...round, injectedAt: NOW + 13 } : round),
    }
    // c1 is RUNNING (its own chip says 进行中), so the waiting rounds are
    // 第 1 位 and 第 2 位 — numbering the running one would show 「第 2 位」
    // with no visible 第 1 位 standing in front of it.
    expect(queuePositionOf(task, 'c1')).toBe(0)
    expect(queuePositionOf(task, 'c2')).toBe(1)
    expect(queuePositionOf(task, 'c3')).toBe(2)
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

describe('external rounds (原生会话活动)', () => {
  it('an open external round reads as running — never saved/queued (it is not waiting for the dispatcher)', () => {
    const round = newExternalRound({ id: 'x1', now: NOW + 5, sessionId: 's-1' })
    expect(commentRoundState(round, false)).toBe('running')
    expect(commentRoundState(round, true)).toBe('running')
    const settled = { ...round, endedAt: NOW + 10, result: 'succeeded' as const }
    expect(commentRoundState(settled, false)).toBe('succeeded')
  })

  it('belongs to the session thread but never occupies a queue position', () => {
    const task = {
      ...withTwoRuns(),
      executions: [
        ...withTwoRuns().executions,
        newExternalRound({ id: 'x1', now: NOW + 10, sessionId: 's-1' }),
      ],
    }
    expect(sessionCommentsOf(task, 's-1', true).map(view => view.round.id)).toContain('x1')
    expect(queuePositionOf(task, 'x1')).toBe(0)
    expect(pendingCommentCount(task)).toBe(0)
  })

  it('carries the captured native message as its body (never an empty row)', () => {
    const round = newExternalRound({ id: 'x2', now: NOW + 11, sessionId: 's-1', text: '切到 plan mode。' })
    expect(round.comment).toBe('切到 plan mode。')
    expect(round.external).toBe(true)
  })
})

describe('latestCommentView', () => {
  it('returns the newest round of the session thread with its body text', () => {
    const task = {
      ...withTwoRuns(),
      executions: [
        ...withTwoRuns().executions,
        newExternalRound({ id: 'x1', now: NOW + 10, sessionId: 's-1', text: '你好' }),
      ],
    }
    const latest = latestCommentView(task, 's-1', true)
    expect(latest?.text).toBe('你好')
    expect(latest?.stateKey).toBe('review.commentRunning')
  })

  it('falls back to the state word when the body is empty (legacy records)', () => {
    const task = {
      ...withTwoRuns(),
      executions: [
        ...withTwoRuns().executions,
        newExternalRound({ id: 'x1', now: NOW + 10, sessionId: 's-1' }),
        { ...newExternalRound({ id: 'x2', now: NOW + 20, sessionId: 's-1' }), endedAt: NOW + 30, result: 'succeeded' as const },
      ],
    }
    const latest = latestCommentView(task, 's-1', true)
    expect(latest?.text).toBe('')
    expect(latest?.stateKey).toBe('review.commentSucceeded')
    expect(latest?.at).toBe(NOW + 20)
  })

  it('is undefined when the session has no thread', () => {
    expect(latestCommentView(withTwoRuns(), 'none', true)).toBeUndefined()
  })
})