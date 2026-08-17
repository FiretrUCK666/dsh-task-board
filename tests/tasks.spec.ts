/**
 * Pure task-domain tests: creation, status transitions, execution settlement.
 */
import { describe, expect, it } from 'vitest'
import {
  applyCardOrder, canMoveManually, createTask, disarmSchedule, executionLabel, hasOpenRun, pendingCommentCount, plainRunsOf, resolveCardDrop, ruleReadiness,
  settleExecution, startExecution, withSchedule, withStatus,
} from '../src/core/tasks.ts'

const NOW = 1_700_000_000_000

function sampleTask() {
  return createTask(
    { title: '  修复登录页样式  ', description: '按钮颜色不对', prompt: '请修复登录页按钮的样式问题' },
    NOW,
    'task-1',
  )
}

describe('createTask', () => {
  it('trims inputs, defaults to todo, and records timestamps', () => {
    const task = sampleTask()
    expect(task.title).toBe('修复登录页样式')
    expect(task.description).toBe('按钮颜色不对')
    expect(task.prompt).toBe('请修复登录页按钮的样式问题')
    expect(task.status).toBe('todo')
    expect(task.createdAt).toBe(NOW)
    expect(task.updatedAt).toBe(NOW)
    expect(task.executions).toEqual([])
  })

  it('keeps ids and empty optional fields intact', () => {
    const task = createTask({ title: 'x', description: '', prompt: '' }, NOW, 'task-2')
    expect(task.id).toBe('task-2')
    expect(task.description).toBe('')
    expect(task.prompt).toBe('')
  })

  it('maps run-configuration fields (agent preset / workspace / model) onto the task', () => {
    const task = createTask(
      { title: 'x', description: '', prompt: '', agentPreset: 'butler', workspaceId: 'ws-9', provider: 'opencode-go', model: 'deepseek-v4-flash', reasoningEffort: 'high', permission: 'read-only' },
      NOW,
      'task-3',
    )
    expect(task.agentPreset).toBe('butler')
    expect(task.workspaceId).toBe('ws-9')
    expect(task.provider).toBe('opencode-go')
    expect(task.model).toBe('deepseek-v4-flash')
    expect(task.reasoningEffort).toBe('high')
    expect(task.permission).toBe('read-only')
    // Absent fields stay absent.
    const plain = createTask({ title: 'y', description: '', prompt: '' }, NOW, 'task-4')
    expect(plain.agentPreset).toBeUndefined()
    expect(plain.workspaceId).toBeUndefined()
    expect(plain.permission).toBeUndefined()
  })

  it('lands in the requested column (backlog) and keeps the order key', () => {
    const task = createTask({ title: 'x', description: '', prompt: '', status: 'backlog' }, NOW, 'task-5', 3)
    expect(task.status).toBe('backlog')
    expect(task.order).toBe(3)
  })
})

describe('applyCardOrder', () => {
  /** Three tasks in one column, orders 0..2, in the given array order. */
  function column(ids: string[], orders = [0, 1, 2]) {
    return ids.map((id, index) => createTask({ title: id, description: '', prompt: '' }, NOW, id, orders[index]))
  }

  /** Map task id → order key, the shape the board sorts by. */
  const keyed = (tasks: readonly ReturnType<typeof createTask>[]): Record<string, number> =>
    Object.fromEntries(tasks.map(task => [task.id, task.order]))

  it('inserts before a target card and renumbers only the target column', () => {
    const [a, b, c] = column(['a', 'b', 'c'])
    const reordered = applyCardOrder([a, b, c], 'c', 'todo', 'a', NOW + 1)
    expect(keyed(reordered)).toEqual({ c: 0, a: 1, b: 2 })
    expect(reordered.find(task => task.id === 'c')?.updatedAt).toBe(NOW + 1)
    // Original array untouched.
    expect(keyed([a, b, c])).toEqual({ a: 0, b: 1, c: 2 })
  })

  it('appends at the tail without a target and is a no-op when moving onto itself', () => {
    const [a, b, c] = column(['a', 'b', 'c'])
    const appended = applyCardOrder([a, b, c], 'a', 'todo', undefined, NOW + 1)
    expect(keyed(appended)).toEqual({ b: 0, c: 1, a: 2 })
    const self = applyCardOrder([a, b, c], 'a', 'todo', 'a', NOW + 1)
    expect(keyed(self)).toEqual({ a: 0, b: 1, c: 2 })
  })

  it('moves across columns preserving the target column order and other columns untouched', () => {
    const [a, b, c] = column(['a', 'b', 'c'])
    const d = createTask({ title: 'd', description: '', prompt: '' }, NOW, 'd', 0)
    const moved = applyCardOrder([a, b, c, { ...d, status: 'backlog' }], 'b', 'backlog', undefined, NOW + 1)
    expect(moved.find(task => task.id === 'b')?.status).toBe('backlog')
    expect(moved.find(task => task.id === 'b')?.order).toBe(1)
    // Other columns keep their own keys (gaps are harmless — sorting only
    // compares within a column).
    expect(keyed(moved)).toEqual({ a: 0, b: 1, c: 2, d: 0 })
  })

  it('no-ops for an unknown task', () => {
    const [a, b, c] = column(['a', 'b', 'c'])
    const out = applyCardOrder([a, b, c], 'ghost', 'todo', undefined, NOW + 1)
    expect(keyed(out)).toEqual({ a: 0, b: 1, c: 2 })
  })
})

describe('status transitions', () => {
  it('manual moves are allowed to backlog/todo/done', () => {
    expect(canMoveManually('todo', 'backlog')).toBe(true)
    expect(canMoveManually('review', 'todo')).toBe(true)
    expect(canMoveManually('done', 'backlog')).toBe(true)
    expect(canMoveManually('todo', 'running')).toBe(false)
    expect(canMoveManually('backlog', 'review')).toBe(false)
  })

  it('withStatus bumps updatedAt and swaps the status', () => {
    const moved = withStatus(sampleTask(), 'backlog', NOW + 1)
    expect(moved.status).toBe('backlog')
    expect(moved.updatedAt).toBe(NOW + 1)
  })

  it('startExecution moves to running and appends an open execution', () => {
    const { task, execution } = startExecution(sampleTask(), NOW + 5, 'exec-1')
    expect(task.status).toBe('running')
    expect(task.executions).toHaveLength(1)
    expect(execution.id).toBe('exec-1')
    expect(execution.startedAt).toBe(NOW + 5)
    expect(execution.endedAt).toBeUndefined()
    expect(execution.result).toBeUndefined()
    expect(task.updatedAt).toBe(NOW + 5)
  })
})

describe('settleExecution', () => {
  it('settles a successful run into review (the human gate before done)', () => {
    const { task, execution } = startExecution(sampleTask(), NOW, 'exec-1')
    const settled = settleExecution(task, 'exec-1', 'succeeded', NOW + 10, undefined)
    expect(settled.status).toBe('review')
    expect(settled.executions[0].endedAt).toBe(NOW + 10)
    expect(settled.executions[0].result).toBe('succeeded')
    expect(settled.executions[0].error).toBeUndefined()
  })

  it('settles a failed run into review too (outcome lives in the record)', () => {
    const { task, execution } = startExecution(sampleTask(), NOW, 'exec-1')
    const settled = settleExecution(task, 'exec-1', 'failed', NOW + 10, 'boom')
    expect(settled.status).toBe('review')
    expect(settled.executions[0].result).toBe('failed')
    expect(settled.executions[0].error).toBe('boom')
  })

  it('cancelled runs return a non-running task to todo', () => {
    const { task, execution } = startExecution(sampleTask(), NOW, 'exec-1')
    const settled = settleExecution(task, 'exec-1', 'cancelled', NOW + 10, 'interrupted')
    expect(settled.status).toBe('todo')
    expect(settled.executions[0].result).toBe('cancelled')
  })

  it('is a no-op for unknown or already-settled executions', () => {
    const { task, execution } = startExecution(sampleTask(), NOW, 'exec-1')
    expect(settleExecution(task, 'nope', 'succeeded', NOW + 1, undefined)).toBe(task)
    const settled = settleExecution(task, 'exec-1', 'succeeded', NOW + 1, undefined)
    // Second settle with the same id does not overwrite the outcome.
    const again = settleExecution(settled, 'exec-1', 'failed', NOW + 2, 'late')
    expect(again.executions[0].result).toBe('succeeded')
    expect(again.executions[0].endedAt).toBe(NOW + 1)
  })

  it('keeps sibling executions intact', () => {
    let task = sampleTask()
    const first = startExecution(task, NOW, 'exec-1')
    task = first.task
    const second = startExecution(task, NOW + 1, 'exec-2')
    const settled = settleExecution(second.task, 'exec-2', 'succeeded', NOW + 2, undefined)
    expect(settled.executions).toHaveLength(2)
    expect(settled.executions[0].result).toBeUndefined()
    expect(settled.executions[1].result).toBe('succeeded')
  })

  it('keeps a budgeted scheduled batch running until the final run', () => {
    let task = withSchedule(sampleTask(), { enabled: true, cron: '* * * * *', maxRuns: 2, runCount: 0 }, NOW)
    const first = startExecution(task, NOW, 'e1')
    const settled1 = settleExecution(first.task, 'e1', 'succeeded', NOW + 1, undefined)
    // Run 1 of 2: the card stays 'running' (the batch is not complete).
    expect(settled1.status).toBe('running')
    expect(settled1.executions[0].result).toBe('succeeded')
    // The scheduler increments the counter after the settle, then run 2…
    task = withSchedule(settled1, { runCount: 1 }, NOW + 2)
    const second = startExecution(task, NOW + 3, 'e2')
    const settled2 = settleExecution(second.task, 'e2', 'succeeded', NOW + 4, undefined)
    // …the final budgeted run settles into review.
    expect(settled2.status).toBe('review')
  })

  it('settles an unlimited schedule into review per run', () => {
    const task = withSchedule(sampleTask(), { enabled: true, cron: '* * * * *', maxRuns: undefined, runCount: 3 }, NOW)
    const { task: running } = startExecution(task, NOW + 1, 'e1')
    const settled = settleExecution(running, 'e1', 'succeeded', NOW + 2, undefined)
    expect(settled.status).toBe('review')
  })

  it('settles a disabled schedule into review like a manual run', () => {
    const task = withSchedule(sampleTask(), { enabled: false, cron: '* * * * *', maxRuns: 5, runCount: 0 }, NOW)
    const { task: running } = startExecution(task, NOW + 1, 'e1')
    const settled = settleExecution(running, 'e1', 'succeeded', NOW + 2, undefined)
    expect(settled.status).toBe('review')
  })

  it('a failed batch run settles into review even while runs remain', () => {
    const task = withSchedule(sampleTask(), { enabled: true, cron: '* * * * *', maxRuns: 5, runCount: 0 }, NOW)
    const { task: running } = startExecution(task, NOW + 1, 'e1')
    const settled = settleExecution(running, 'e1', 'failed', NOW + 2, 'boom')
    expect(settled.status).toBe('review')
  })

  it('keeps an unlimited chain running after every succeeded run', () => {
    const task = withSchedule(sampleTask(), { enabled: true, mode: 'chain', cron: '', maxRuns: undefined, runCount: 0 }, NOW)
    const { task: running } = startExecution(task, NOW + 1, 'e1')
    const settled = settleExecution(running, 'e1', 'succeeded', NOW + 2, undefined)
    expect(settled.status).toBe('running')
  })

  it('keeps a budgeted chain running until the final budgeted run', () => {
    let task = withSchedule(sampleTask(), { enabled: true, mode: 'chain', cron: '', maxRuns: 3, runCount: 0 }, NOW)
    const first = startExecution(task, NOW, 'e1')
    const settled1 = settleExecution(first.task, 'e1', 'succeeded', NOW + 1, undefined)
    expect(settled1.status).toBe('running')
    task = withSchedule(settled1, { runCount: 1 }, NOW + 2)
    const second = startExecution(task, NOW + 3, 'e2')
    const settled2 = settleExecution(second.task, 'e2', 'succeeded', NOW + 4, undefined)
    expect(settled2.status).toBe('running')
    task = withSchedule(settled2, { runCount: 2 }, NOW + 5)
    const third = startExecution(task, NOW + 6, 'e3')
    const settled3 = settleExecution(third.task, 'e3', 'succeeded', NOW + 7, undefined)
    expect(settled3.status).toBe('review')
  })

  it('a failed chain run settles into review and never continues', () => {
    const task = withSchedule(sampleTask(), { enabled: true, mode: 'chain', cron: '', maxRuns: undefined, runCount: 0 }, NOW)
    const { task: running } = startExecution(task, NOW + 1, 'e1')
    const settled = settleExecution(running, 'e1', 'failed', NOW + 2, 'boom')
    expect(settled.status).toBe('review')
  })
})

describe('executionLabel', () => {
  it('describes open and settled runs', () => {
    const { execution } = startExecution(sampleTask(), NOW, 'e1')
    expect(executionLabel(execution)).toBe('running')
    expect(executionLabel({ ...execution, endedAt: NOW, result: 'succeeded' })).toBe('succeeded')
    expect(executionLabel({ ...execution, endedAt: NOW, result: 'failed' })).toBe('failed')
    expect(executionLabel({ ...execution, endedAt: NOW, result: 'cancelled' })).toBe('cancelled')
  })
})

describe('withSchedule', () => {
  it('creates a schedule rule on a task without one and bumps updatedAt', () => {
    const task = sampleTask()
    const scheduled = withSchedule(task, { enabled: true, cron: '0 9 * * *', nextRunAt: NOW + 100 }, NOW + 1)
    expect(scheduled.schedule).toEqual({
      enabled: true, mode: 'cron', cron: '0 9 * * *', nextRunAt: NOW + 100, lastTriggeredAt: undefined,
      maxRuns: undefined, runCount: 0, primed: false,
    })
    expect(scheduled.updatedAt).toBe(NOW + 1)
    expect(task.schedule).toBeUndefined() // original untouched
  })

  it('merges partial patches and keeps untouched schedule fields', () => {
    const task = withSchedule(
      sampleTask(),
      { enabled: true, cron: '0 9 * * *', nextRunAt: NOW + 100, lastTriggeredAt: NOW },
      NOW,
    )
    const rolled = withSchedule(task, { nextRunAt: NOW + 200 }, NOW + 2)
    expect(rolled.schedule).toEqual({
      enabled: true, mode: 'cron', cron: '0 9 * * *', nextRunAt: NOW + 200, lastTriggeredAt: NOW,
      maxRuns: undefined, runCount: 0, primed: false,
    })
  })

  it('keeps executions and other task fields intact', () => {
    const { task } = startExecution(sampleTask(), NOW, 'exec-1')
    const scheduled = withSchedule(task, { enabled: false, cron: '*/10 * * * *' }, NOW + 1)
    expect(scheduled.executions).toHaveLength(1)
    expect(scheduled.status).toBe('running')
  })

  it('explicit undefined clears a field (disarming nextRunAt)', () => {
    const task = withSchedule(
      sampleTask(),
      { enabled: true, cron: '0 9 * * *', nextRunAt: NOW + 100 },
      NOW,
    )
    const cleared = withSchedule(task, { nextRunAt: undefined }, NOW + 1)
    expect(cleared.schedule?.enabled).toBe(true)
    expect(cleared.schedule?.cron).toBe('0 9 * * *')
    expect(cleared.schedule?.nextRunAt).toBeUndefined()
  })
})

describe('resolveCardDrop', () => {
  it('drops on running rerun a free task from any column', () => {
    expect(resolveCardDrop(sampleTask(), 'running')).toEqual({ kind: 'run' })
    const settled = settleExecution(
      startExecution(sampleTask(), NOW, 'e1').task, 'e1', 'succeeded', NOW + 1, undefined,
    )
    expect(resolveCardDrop(settled, 'running')).toEqual({ kind: 'run' })
  })

  it('a busy task already sits in the running column: dropping there is a no-op', () => {
    const { task } = startExecution(sampleTask(), NOW, 'e1')
    // A task with an open execution is always in the running column, so
    // dropping it back there changes nothing.
    expect(resolveCardDrop(task, 'running')).toEqual({ kind: 'none' })
  })

  it('refuses done/review while an execution is open, but allows backlog/todo', () => {
    const { task } = startExecution(sampleTask(), NOW, 'e1')
    expect(resolveCardDrop(task, 'done')).toEqual({ kind: 'reject', reason: 'busy' })
    expect(resolveCardDrop(task, 'review')).toEqual({ kind: 'reject', reason: 'busy' })
    expect(resolveCardDrop(task, 'backlog')).toEqual({ kind: 'move', status: 'backlog' })
  })

  it('moves a free task to any non-running column', () => {
    const task = withStatus(sampleTask(), 'backlog', NOW)
    for (const status of ['todo', 'review', 'done'] as const) {
      expect(resolveCardDrop(task, status)).toEqual({ kind: 'move', status })
    }
    expect(resolveCardDrop(task, 'backlog')).toEqual({ kind: 'none' })
  })

  it('is a no-op on the current column', () => {
    const task = withStatus(sampleTask(), 'done', NOW)
    expect(resolveCardDrop(task, 'done')).toEqual({ kind: 'none' })
    expect(resolveCardDrop(task, 'backlog')).toEqual({ kind: 'move', status: 'backlog' })
  })

  it('a running chain owns the card: only run now is allowed (busy rejects)', () => {
    const base = withSchedule(sampleTask(), { enabled: true, mode: 'chain', cron: '', primed: true }, NOW)
    const { task } = startExecution(base, NOW, 'e1') // running + open
    expect(resolveCardDrop(task, 'running')).toEqual({ kind: 'reject', reason: 'busy' })
    // Settled but still 'running' (the chain keeps the card in progress):
    // the chain still owns it — only a run is allowed.
    const settled = settleExecution(task, 'e1', 'succeeded', NOW + 1, undefined)
    expect(settled.status).toBe('running')
    expect(resolveCardDrop(settled, 'running')).toEqual({ kind: 'run' })
    expect(resolveCardDrop(settled, 'todo')).toEqual({ kind: 'reject', reason: 'scheduled' })
    expect(resolveCardDrop(settled, 'done')).toEqual({ kind: 'reject', reason: 'scheduled' })
    expect(resolveCardDrop(settled, 'backlog')).toEqual({ kind: 'reject', reason: 'scheduled' })
  })

  it('a paused chain owns nothing: review/backlog/cancelled cards move freely', () => {
    // Paused (review): the rule must not block recovery moves.
    const reviewChain = withSchedule(withStatus(sampleTask(), 'review', NOW), { enabled: true, mode: 'chain', cron: '', primed: true }, NOW)
    expect(resolveCardDrop(reviewChain, 'todo')).toEqual({ kind: 'move', status: 'todo' })
    expect(resolveCardDrop(reviewChain, 'done')).toEqual({ kind: 'move', status: 'done' })
    expect(resolveCardDrop(reviewChain, 'running')).toEqual({ kind: 'run' }) // resume by running
    // Paused (backlog shelved): same freedom.
    const backlogChain = withSchedule(withStatus(sampleTask(), 'backlog', NOW), { enabled: true, mode: 'chain', cron: '', primed: true }, NOW)
    expect(resolveCardDrop(backlogChain, 'todo')).toEqual({ kind: 'move', status: 'todo' })
    // Cancelled tasks fall back to todo: the chain no longer owns them.
    const cancelledChain = withSchedule(withStatus(sampleTask(), 'todo', NOW), { enabled: true, mode: 'chain', cron: '', primed: true }, NOW)
    expect(resolveCardDrop(cancelledChain, 'backlog')).toEqual({ kind: 'move', status: 'backlog' })
  })

  it('a disabled chain falls back to the plain rules', () => {
    const chain = withSchedule(withStatus(sampleTask(), 'backlog', NOW), { enabled: false, mode: 'chain', cron: '' }, NOW)
    expect(resolveCardDrop(chain, 'todo')).toEqual({ kind: 'move', status: 'todo' })
  })
})

describe('hasOpenRun', () => {
  it('is true only when the task is running and its latest round is open', () => {
    const { task } = startExecution(sampleTask(), NOW, 'e1')
    expect(hasOpenRun(task)).toBe(true)
    const settled = settleExecution(task, 'e1', 'succeeded', NOW + 1, undefined)
    expect(hasOpenRun(settled)).toBe(false)
  })

  it('is false for a pending comment round (task not running)', () => {
    // A saved-but-not-injected comment round leaves the task in review; the
    // card must never read as running.
    const { task } = startExecution(sampleTask(), NOW, 'e1')
    const settled = settleExecution(task, 'e1', 'succeeded', NOW + 1, undefined)
    const withPending = {
      ...settled,
      executions: [
        ...settled.executions,
        { id: 'c1', sessionId: 's-1', startedAt: NOW + 2, endedAt: undefined, result: undefined, error: undefined, comment: '待注入' },
      ],
    }
    expect(withPending.status).toBe('review')
    expect(hasOpenRun(withPending)).toBe(false)
    // Injected: the task is running again → open run.
    const injected = { ...withPending, status: 'running' as const }
    expect(hasOpenRun(injected)).toBe(true)
  })
})

describe('pendingCommentCount', () => {
  it('counts only saved/queued comment rounds (not injected or settled)', () => {
    const { task } = startExecution(sampleTask(), NOW, 'e1')
    const settled = settleExecution(task, 'e1', 'succeeded', NOW + 1, undefined)
    const base = {
      ...settled,
      executions: [
        ...settled.executions,
        { id: 'c1', sessionId: 's-1', startedAt: NOW + 2, endedAt: undefined, result: undefined, error: undefined, comment: '排队中' },
        { id: 'c2', sessionId: 's-1', startedAt: NOW + 3, endedAt: undefined, result: undefined, error: undefined, comment: '排队中' },
        { id: 'c3', sessionId: 's-1', startedAt: NOW + 4, endedAt: NOW + 5, result: 'succeeded' as const, error: undefined, comment: '已结算', injectedAt: NOW + 4 },
        { id: 'c4', sessionId: 's-1', startedAt: NOW + 6, endedAt: undefined, result: undefined, error: undefined, comment: '已注入', injectedAt: NOW + 6 },
      ],
    }
    expect(pendingCommentCount(base)).toBe(2)
    expect(pendingCommentCount(sampleTask())).toBe(0)
  })
})

describe('plainRunsOf', () => {
  /** Task with one settled run e1, plus comment rounds c1 (settled) and c2 (pending). */
  function withComments() {
    let { task } = startExecution(sampleTask(), NOW, 'e1')
    task = settleExecution(task, 'e1', 'succeeded', NOW + 1, 's-1')
    return {
      ...task,
      executions: [
        ...task.executions,
        { id: 'c1', sessionId: 's-1', parentExecutionId: 'e1', startedAt: NOW + 2, endedAt: NOW + 3, result: 'succeeded' as const, error: undefined, comment: '已结算' },
        { id: 'c2', sessionId: 's-1', parentExecutionId: 'e1', startedAt: NOW + 4, endedAt: undefined, result: undefined, error: undefined, comment: '排队中' },
      ],
    }
  }

  it('returns every plain run, excluding comment rounds', () => {
    const task = withComments()
    const runs = plainRunsOf(task)
    expect(runs.map(run => run.id)).toEqual(['e1'])
  })

  it('stays in chronological order and an empty task has no runs', () => {
    expect(plainRunsOf(sampleTask())).toEqual([])
    let task = withComments()
    task = { ...task, executions: [...task.executions, { id: 'e2', sessionId: 's-2', startedAt: NOW + 5, endedAt: undefined, result: undefined, error: undefined }] }
    expect(plainRunsOf(task).map(run => run.id)).toEqual(['e1', 'e2'])
  })
})

describe('ruleReadiness', () => {
  const armed = { mode: 'chain' as const, cron: '', maxRuns: undefined, runCount: 0 }

  it('is disabled without a rule or when the rule is off', () => {
    expect(ruleReadiness(sampleTask())).toEqual({ kind: 'disabled' })
    const off = withSchedule(sampleTask(), { enabled: false, cron: '0 9 * * *' }, NOW)
    expect(ruleReadiness(off)).toEqual({ kind: 'disabled' })
  })

  it('is standby when armed but never started by a manual run', () => {
    const standby = withSchedule(sampleTask(), { ...armed, enabled: true, cron: '0 9 * * *' }, NOW)
    expect(ruleReadiness(standby)).toEqual({ kind: 'standby' })
  })

  it('is active for todo/running once primed', () => {
    for (const status of ['todo', 'running'] as const) {
      const task = withSchedule(withStatus(sampleTask(), status, NOW), { ...armed, enabled: true, primed: true, cron: '0 9 * * *' }, NOW)
      expect(ruleReadiness(task)).toEqual({ kind: 'active' })
    }
  })

  it('is paused for backlog/review/done once primed, naming the blocking status', () => {
    const backlog = withSchedule(withStatus(sampleTask(), 'backlog', NOW), { ...armed, enabled: true, primed: true, cron: '0 9 * * *' }, NOW)
    expect(ruleReadiness(backlog)).toEqual({ kind: 'paused', status: 'backlog' })
    const review = withSchedule(withStatus(sampleTask(), 'review', NOW), { ...armed, enabled: true, primed: true, cron: '0 9 * * *' }, NOW)
    expect(ruleReadiness(review)).toEqual({ kind: 'paused', status: 'review' })
    // Done is also paused: a completed task's armed rule must never drive it
    // (the completion path additionally disarms it outright — this is the
    // safety net for legacy rows that still carry a stale enabled flag).
    const done = withSchedule(withStatus(sampleTask(), 'done', NOW), { ...armed, enabled: true, primed: true, cron: '0 9 * * *' }, NOW)
    expect(ruleReadiness(done)).toEqual({ kind: 'paused', status: 'done' })
  })
})

describe('disarmSchedule', () => {
  it('disarms an armed rule while keeping its configuration (cron/mode/budget/prime)', () => {
    const armed = withSchedule(withStatus(sampleTask(), 'todo', NOW), {
      enabled: true, mode: 'chain', cron: '0 9 * * *', primed: true, maxRuns: 7, runCount: 3, nextRunAt: NOW + 1000,
    }, NOW)
    const disarmed = disarmSchedule(armed, NOW + 1)
    expect(disarmed.schedule?.enabled).toBe(false)
    expect(disarmed.schedule?.nextRunAt).toBeUndefined()
    // Identity preserved so re-arming resumes the same schedule.
    expect(disarmed.schedule?.mode).toBe('chain')
    expect(disarmed.schedule?.cron).toBe('0 9 * * *')
    expect(disarmed.schedule?.primed).toBe(true)
    expect(disarmed.schedule?.maxRuns).toBe(7)
    expect(disarmed.schedule?.runCount).toBe(3)
    expect(disarmed.updatedAt).toBe(NOW + 1)
  })

  it('is a no-op without a schedule or on an already-disarmed rule', () => {
    const plain = sampleTask()
    expect(disarmSchedule(plain, NOW)).toBe(plain)
    const off = withSchedule(sampleTask(), { enabled: false, cron: '0 9 * * *' }, NOW)
    expect(disarmSchedule(off, NOW)).toBe(off)
  })
})
