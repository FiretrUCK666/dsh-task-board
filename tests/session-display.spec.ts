import { describe, expect, it } from 'vitest'
import type { TaskRecord, ExecutionRecord } from '../src/core/tasks.ts'
import {
  executionUnviewed,
  executionViewedBaseline,
  sessionDisplay,
  sessionTimes,
  taskPendingCount,
  taskUnviewed,
  taskUnviewedCount,
} from '../src/core/session-display.ts'

/** Helper to create a minimal task with executions. */
function taskWith(executions: ExecutionRecord[]): TaskRecord {
  return {
    id: 'task-1',
    title: 'Test',
    description: '',
    prompt: '',
    status: 'running',
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    executions,
  }
}

/** Helper to create an execution round. */
function round(
  id: string,
  opts: Partial<ExecutionRecord> & { startedAt: number }
): ExecutionRecord {
  return {
    id,
    sessionId: undefined,
    endedAt: undefined,
    result: undefined,
    error: undefined,
    ...opts,
  }
}

describe('sessionDisplay', () => {
  describe('state priority', () => {
    it('returns running when a round is open', () => {
      const exec = round('exec-1', { startedAt: 100, sessionId: 's1' })
      const comment = round('c1', {
        startedAt: 200,
        sessionId: 's1',
        injectedAt: 200,
        parentExecutionId: 'exec-1',
      })
      const task = taskWith([exec, comment])
      const result = sessionDisplay(task, exec, undefined)
      expect(result.state).toBe('running')
      expect(result.lastActivity).toBe(200)
    })

    it('returns running for an open plain run without injectedAt', () => {
      // Plain runs never carry `injectedAt` — an open one (started, unsettled)
      // must read as running, not as a ghost "cancelled".
      const exec = round('exec-1', { startedAt: 100, sessionId: 's1' })
      const task = taskWith([exec])
      const result = sessionDisplay(task, exec, undefined)
      expect(result.state).toBe('running')
      expect(result.lastActivity).toBe(100)
    })

    it('returns waiting for an open plain run with a pending interaction', () => {
      const exec = round('exec-1', { startedAt: 100, sessionId: 's1' })
      const task = taskWith([exec])
      const result = sessionDisplay(task, exec, 'approval')
      expect(result.state).toBe('waiting')
      expect(result.waitingKind).toBe('approval')
    })

    it('a saved/queued comment alone does not open the session', () => {
      // A comment round that has not been injected (cruise off / queued) has
      // not started — the session stays idle and settles to its latest.
      const exec = round('exec-1', {
        startedAt: 100,
        sessionId: 's1',
        endedAt: 150,
        result: 'succeeded',
      })
      const queued = round('c1', {
        startedAt: 200,
        sessionId: 's1',
        parentExecutionId: 'exec-1',
        comment: '等巡航注入',
      })
      const task = taskWith([exec, queued])
      const result = sessionDisplay(task, exec, undefined)
      expect(result.state).toBe('succeeded')
    })

    it('returns waiting when open round has pending interaction', () => {
      const exec = round('exec-1', { startedAt: 100, sessionId: 's1' })
      const comment = round('c1', {
        startedAt: 200,
        sessionId: 's1',
        injectedAt: 200,
        parentExecutionId: 'exec-1',
      })
      const task = taskWith([exec, comment])
      const result = sessionDisplay(task, exec, 'approval')
      expect(result.state).toBe('waiting')
      expect(result.waitingKind).toBe('approval')
      expect(result.lastActivity).toBe(200)
    })

    it('returns succeeded when all rounds settled successfully', () => {
      const exec = round('exec-1', {
        startedAt: 100,
        sessionId: 's1',
        endedAt: 150,
        result: 'succeeded',
      })
      const comment = round('c1', {
        startedAt: 200,
        sessionId: 's1',
        injectedAt: 200,
        endedAt: 250,
        result: 'succeeded',
        parentExecutionId: 'exec-1',
      })
      const task = taskWith([exec, comment])
      const result = sessionDisplay(task, exec, undefined)
      expect(result.state).toBe('succeeded')
      expect(result.lastActivity).toBe(250)
    })

    it('returns failed when latest settled round failed', () => {
      const exec = round('exec-1', {
        startedAt: 100,
        sessionId: 's1',
        endedAt: 150,
        result: 'succeeded',
      })
      const comment = round('c1', {
        startedAt: 200,
        sessionId: 's1',
        injectedAt: 200,
        endedAt: 250,
        result: 'failed',
        parentExecutionId: 'exec-1',
      })
      const task = taskWith([exec, comment])
      const result = sessionDisplay(task, exec, undefined)
      expect(result.state).toBe('failed')
      expect(result.lastActivity).toBe(250)
    })

    it('uses latest settled round when multiple rounds settled', () => {
      const exec = round('exec-1', {
        startedAt: 100,
        sessionId: 's1',
        endedAt: 150,
        result: 'succeeded',
      })
      const c1 = round('c1', {
        startedAt: 200,
        sessionId: 's1',
        injectedAt: 200,
        endedAt: 250,
        result: 'failed',
        parentExecutionId: 'exec-1',
      })
      const c2 = round('c2', {
        startedAt: 300,
        sessionId: 's1',
        injectedAt: 300,
        endedAt: 350,
        result: 'succeeded',
        parentExecutionId: 'exec-1',
      })
      const task = taskWith([exec, c1, c2])
      const result = sessionDisplay(task, exec, undefined)
      expect(result.state).toBe('succeeded')
      expect(result.lastActivity).toBe(350)
    })
  })

  describe('session attribution', () => {
    it('includes rounds with same sessionId', () => {
      const exec = round('exec-1', { startedAt: 100, sessionId: 's1' })
      const comment = round('c1', {
        startedAt: 200,
        sessionId: 's1',
        injectedAt: 200,
      })
      const task = taskWith([exec, comment])
      const result = sessionDisplay(task, exec, undefined)
      expect(result.state).toBe('running')
    })

    it('includes rounds with parentExecutionId', () => {
      const exec = round('exec-1', { startedAt: 100, sessionId: 's1' })
      const comment = round('c1', {
        startedAt: 200,
        sessionId: 's2', // different session
        injectedAt: 200,
        parentExecutionId: 'exec-1',
      })
      const task = taskWith([exec, comment])
      const result = sessionDisplay(task, exec, undefined)
      expect(result.state).toBe('running')
    })

    it('ignores rounds from other sessions', () => {
      const exec = round('exec-1', { startedAt: 100, sessionId: 's1' })
      const otherExec = round('exec-2', {
        startedAt: 200,
        sessionId: 's2',
        endedAt: 250,
        result: 'succeeded',
      })
      const task = taskWith([exec, otherExec])
      const result = sessionDisplay(task, exec, undefined)
      // exec-1 is open (plain run, started but unsettled) — its own session
      // is live regardless of what other sessions did.
      expect(result.state).toBe('running')
    })

    it('ignores session-anchored rounds even when the session id coincides', () => {
      // A drive-mode comment anchored to a linked session whose id happens to
      // equal the execution's session must stay on the linked thread, never
      // light up the execution's session group as live.
      const exec = round('exec-1', { startedAt: 100, sessionId: 's1', endedAt: 150, result: 'succeeded', viewedAt: 150 })
      const driven = round('c1', {
        startedAt: 200,
        sessionId: 's1',
        sessionAnchor: 's1',
        comment: '驱动',
      })
      const task = taskWith([exec, driven])
      const result = sessionDisplay(task, exec, undefined)
      // The anchored round is excluded: the execution settled, so its session
      // is not live — a queued drive-mode comment never makes it look busy.
      expect(result.state).toBe('succeeded')
      expect(executionUnviewed(task, exec)).toBe(false)
    })
  })

  describe('edge cases', () => {
    it('returns cancelled for execution with no rounds', () => {
      const exec = round('exec-1', { startedAt: 100 })
      const task = taskWith([])
      const result = sessionDisplay(task, exec, undefined)
      expect(result.state).toBe('cancelled')
      expect(result.lastActivity).toBeUndefined()
    })

    it('returns cancelled for settled round with cancelled result', () => {
      const exec = round('exec-1', {
        startedAt: 100,
        sessionId: 's1',
        endedAt: 150,
        result: 'cancelled',
      })
      const task = taskWith([exec])
      const result = sessionDisplay(task, exec, undefined)
      expect(result.state).toBe('cancelled')
    })
  })
})

describe('sessionTimes', () => {
  it('returns startedAt from earliest round', () => {
    const exec = round('exec-1', { startedAt: 100, sessionId: 's1' })
    const comment = round('c1', {
      startedAt: 200,
      sessionId: 's1',
      injectedAt: 200,
      parentExecutionId: 'exec-1',
    })
    const task = taskWith([exec, comment])
    const result = sessionTimes(task, exec)
    expect(result.startedAt).toBe(100)
  })

  it('returns endedAt as max of settled rounds when all settled', () => {
    const exec = round('exec-1', {
      startedAt: 100,
      sessionId: 's1',
      endedAt: 150,
      result: 'succeeded',
    })
    const comment = round('c1', {
      startedAt: 200,
      sessionId: 's1',
      injectedAt: 200,
      endedAt: 250,
      result: 'succeeded',
      parentExecutionId: 'exec-1',
    })
    const task = taskWith([exec, comment])
    const result = sessionTimes(task, exec)
    expect(result.endedAt).toBe(250)
    expect(result.duration).toBe(150)
  })

  it('returns undefined endedAt when any round is open', () => {
    const exec = round('exec-1', {
      startedAt: 100,
      sessionId: 's1',
      endedAt: 150,
      result: 'succeeded',
    })
    const comment = round('c1', {
      startedAt: 200,
      sessionId: 's1',
      injectedAt: 200,
      parentExecutionId: 'exec-1',
    })
    const task = taskWith([exec, comment])
    const result = sessionTimes(task, exec)
    expect(result.endedAt).toBeUndefined()
    expect(result.duration).toBeUndefined()
  })

  it('returns execution startedAt when no rounds exist', () => {
    const exec = round('exec-1', { startedAt: 100 })
    const task = taskWith([])
    const result = sessionTimes(task, exec)
    expect(result.startedAt).toBe(100)
    expect(result.endedAt).toBeUndefined()
    expect(result.duration).toBeUndefined()
  })

  it('handles multiple settled rounds', () => {
    const exec = round('exec-1', {
      startedAt: 100,
      sessionId: 's1',
      endedAt: 150,
      result: 'succeeded',
    })
    const c1 = round('c1', {
      startedAt: 200,
      sessionId: 's1',
      injectedAt: 200,
      endedAt: 250,
      result: 'succeeded',
      parentExecutionId: 'exec-1',
    })
    const c2 = round('c2', {
      startedAt: 300,
      sessionId: 's1',
      injectedAt: 300,
      endedAt: 380,
      result: 'failed',
      parentExecutionId: 'exec-1',
    })
    const task = taskWith([exec, c1, c2])
    const result = sessionTimes(task, exec)
    expect(result.startedAt).toBe(100)
    expect(result.endedAt).toBe(380)
    expect(result.duration).toBe(280)
  })
})

describe('taskPendingCount', () => {
  it('returns 0 when no sessions are waiting', () => {
    const exec = round('exec-1', {
      startedAt: 100,
      sessionId: 's1',
      endedAt: 150,
      result: 'succeeded',
    })
    const task = taskWith([exec])
    const pendingOf = () => undefined
    const result = taskPendingCount(task, pendingOf)
    expect(result.count).toBe(0)
    expect(result.items).toEqual([])
  })

  it('counts waiting execution sessions', () => {
    const exec = round('exec-1', { startedAt: 100, sessionId: 's1' })
    const task = taskWith([exec])
    const pendingOf = (sid: string | undefined) =>
      sid === 's1' ? 'approval' : undefined
    const result = taskPendingCount(task, pendingOf)
    expect(result.count).toBe(1)
    expect(result.items).toEqual([
      { executionId: 'exec-1', waitingKind: 'approval' },
    ])
  })

  it('counts multiple waiting sessions', () => {
    const exec1 = round('exec-1', { startedAt: 100, sessionId: 's1' })
    const exec2 = round('exec-2', { startedAt: 200, sessionId: 's2' })
    const task = taskWith([exec1, exec2])
    const pendingOf = (sid: string | undefined) =>
      sid === 's1' ? 'approval' : sid === 's2' ? 'question' : undefined
    const result = taskPendingCount(task, pendingOf)
    expect(result.count).toBe(2)
    expect(result.items).toEqual([
      { executionId: 'exec-1', waitingKind: 'approval' },
      { executionId: 'exec-2', waitingKind: 'question' },
    ])
  })

  it('counts refine session waiting', () => {
    const task: TaskRecord = {
      ...taskWith([]),
      refineSessionId: 'refine-s1',
    }
    const pendingOf = (sid: string | undefined) =>
      sid === 'refine-s1' ? 'plan-review' : undefined
    const result = taskPendingCount(task, pendingOf)
    expect(result.count).toBe(1)
    expect(result.items).toEqual([{ waitingKind: 'plan-review' }])
  })

  it('counts both execution and refine waiting', () => {
    const exec = round('exec-1', { startedAt: 100, sessionId: 's1' })
    const task: TaskRecord = {
      ...taskWith([exec]),
      refineSessionId: 'refine-s1',
    }
    const pendingOf = (sid: string | undefined) =>
      sid === 's1' ? 'approval' : sid === 'refine-s1' ? 'question' : undefined
    const result = taskPendingCount(task, pendingOf)
    expect(result.count).toBe(2)
    expect(result.items).toEqual([
      { executionId: 'exec-1', waitingKind: 'approval' },
      { waitingKind: 'question' },
    ])
  })

  it('ignores executions without sessionId', () => {
    const exec = round('exec-1', { startedAt: 100 }) // no sessionId
    const task = taskWith([exec])
    const pendingOf = (_sessionId: string | undefined) => 'approval' as const
    const result = taskPendingCount(task, pendingOf)
    expect(result.count).toBe(0)
  })
})

describe('unviewed reminders', () => {
  it('baseline defaults to the run start when viewedAt was never recorded', () => {
    const exec = round('exec-1', {
      startedAt: 100,
      sessionId: 's1',
      endedAt: 150,
      result: 'succeeded',
    })
    expect(executionViewedBaseline(exec)).toBe(100)
  })

  it('a settled run is unviewed until its review page opens', () => {
    const exec = round('exec-1', {
      startedAt: 100,
      sessionId: 's1',
      endedAt: 150,
      result: 'succeeded',
    })
    const task = taskWith([exec])
    expect(executionUnviewed(task, exec)).toBe(true)
    // Opening the review page marks it viewed.
    const viewed: ExecutionRecord = { ...exec, viewedAt: 160 }
    expect(executionUnviewed(taskWith([viewed]), viewed)).toBe(false)
  })

  it('an open plain run is not unviewed while it runs', () => {
    const exec = round('exec-1', { startedAt: 100, sessionId: 's1' })
    const task = taskWith([exec])
    expect(executionUnviewed(task, exec)).toBe(false)
  })

  it('a comment after the viewed baseline re-lights the row', () => {
    const exec = round('exec-1', {
      startedAt: 100,
      sessionId: 's1',
      endedAt: 150,
      result: 'succeeded',
      viewedAt: 160,
    })
    const comment = round('c1', {
      startedAt: 200,
      sessionId: 's1',
      injectedAt: 200,
      endedAt: 250,
      result: 'succeeded',
      parentExecutionId: 'exec-1',
    })
    const task = taskWith([exec, comment])
    expect(executionUnviewed(task, exec)).toBe(true)
  })

  it('task-level unviewed reflects rounds newer than the card baseline', () => {
    // Every real execution carries viewedAt (= its start): a settled run with
    // content older than the card's open baseline is quiet at both levels.
    const task: TaskRecord = {
      ...taskWith([]),
      viewedAt: 100,
      executions: [
        round('exec-1', { startedAt: 50, sessionId: 's1', endedAt: 80, result: 'succeeded', viewedAt: 80 }),
      ],
    }
    expect(taskUnviewed(task)).toBe(false)
    expect(taskUnviewedCount(task)).toBe(0)
    // A fresh settled run after the baseline lights the card up.
    const newer: TaskRecord = {
      ...task,
      executions: [
        round('exec-1', { startedAt: 50, sessionId: 's1', endedAt: 80, result: 'succeeded', viewedAt: 80 }),
        round('exec-2', { startedAt: 120, sessionId: 's2', endedAt: 150, result: 'succeeded', viewedAt: 120 }),
      ],
    }
    expect(taskUnviewed(newer)).toBe(true)
    expect(taskUnviewedCount(newer)).toBe(1)
  })

  it('a new comment re-lights its execution row and the card badge', () => {
    const task: TaskRecord = {
      ...taskWith([]),
      viewedAt: 100,
      executions: [
        round('exec-1', { startedAt: 50, sessionId: 's1', endedAt: 80, result: 'succeeded', viewedAt: 80 }),
      ],
    }
    expect(taskUnviewedCount(task)).toBe(0)
    const withComment: TaskRecord = {
      ...task,
      executions: [
        ...task.executions,
        round('c1', {
          startedAt: 130,
          sessionId: 's1',
          injectedAt: 130,
          endedAt: 160,
          result: 'succeeded',
          parentExecutionId: 'exec-1',
          comment: '好的继续',
        }),
      ],
    }
    expect(taskUnviewed(withComment)).toBe(true)
    expect(taskUnviewedCount(withComment)).toBe(1)
  })

  it('refine-only unread lights the card with a bare 新 (zero unviewed executions)', () => {
    const task: TaskRecord = {
      ...taskWith([]),
      viewedAt: 100,
      refineSessionId: 's-refine',
      executions: [
        round('r1', { startedAt: 130, sessionId: 's-refine', endedAt: 160, result: 'succeeded', refine: true }),
      ],
    }
    expect(taskUnviewed(task)).toBe(true)
    expect(taskUnviewedCount(task)).toBe(0)
  })
})
