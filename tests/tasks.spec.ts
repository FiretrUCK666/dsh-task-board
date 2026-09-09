/**
 * Pure task-domain tests: creation, status transitions, execution settlement.
 */
import { describe, expect, it } from 'vitest'
import {
  applyCardOrder, canMoveManually, cardSourceLabel, createTask, disarmSchedule, executing, hasCompletedWork, hasOpenRun, landingStatusOf, lastPlainResult, latestExecutionOf, newCommentRound, newExternalRound, normalizeLabels, normalizePriority, openExecutionRoundsOf, openRoundsOf, pendingCommentCount, plainRunsOf, promoteToColumnTop, refinable, refineRoundsOf, refining, resolveCardDrop, ruleReadiness, sessionIsBusy, settleColumnOf, supplementLaunchFields, taskExecutable,
  settleExecution, settleRefine, startExecution, withRefineSession, withSchedule, withStatus,
  type TaskRecord,
} from '../src/core/tasks.ts'
import { taskUnviewed } from '../src/core/session-display.ts'

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

  it('persists prompt images (copied, not aliased) and omits an empty set', () => {
    const withImages = createTask(
      { title: 'x', description: '', prompt: 'p', promptImages: [{ mediaType: 'image/webp', data: 'QUJD', name: 'a.webp' }] },
      NOW,
      'task-img',
    )
    expect(withImages.promptImages).toEqual([{ mediaType: 'image/webp', data: 'QUJD', name: 'a.webp' }])
    // An empty set is stored as ABSENT (a plain task never carries the key).
    const empty = createTask({ title: 'x', description: '', prompt: 'p', promptImages: [] }, NOW, 'task-none')
    expect(empty.promptImages).toBeUndefined()
  })

  it('maps run-configuration fields (agent preset / workspace / model) onto the task', () => {    const task = createTask(
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

  it('inserts at a specific position when moving across columns', () => {
    // b (todo) is dropped into backlog BEFORE e — the cross-column drop lands
    // at e's position, not the column tail, renumbering only backlog.
    const [a, b, c] = column(['a', 'b', 'c'])
    const d = createTask({ title: 'd', description: '', prompt: '' }, NOW, 'd', 0)
    const e = createTask({ title: 'e', description: '', prompt: '' }, NOW, 'e', 1)
    const moved = applyCardOrder(
      [a, b, c, { ...d, status: 'backlog' }, { ...e, status: 'backlog' }],
      'b', 'backlog', 'e', NOW + 1,
    )
    // b lands at e's position in backlog; the source column keeps its
    // relative order (c stays 2 with a harmless gap — sorting only compares
    // within a column).
    expect(moved.find(task => task.id === 'b')?.status).toBe('backlog')
    expect(keyed(moved)).toEqual({ d: 0, b: 1, e: 2, a: 0, c: 2 })
  })

  it('no-ops for an unknown task', () => {
    const [a, b, c] = column(['a', 'b', 'c'])
    const out = applyCardOrder([a, b, c], 'ghost', 'todo', undefined, NOW + 1)
    expect(keyed(out)).toEqual({ a: 0, b: 1, c: 2 })
  })
})

describe('promoteToColumnTop', () => {
  /** Three tasks in one column, orders 0..2, in the given array order. */
  function column(ids: string[], orders = [0, 1, 2]) {
    return ids.map((id, index) => createTask({ title: id, description: '', prompt: '' }, NOW, id, orders[index]))
  }

  /** Map task id → order key, the shape the board sorts by. */
  const keyed = (tasks: readonly ReturnType<typeof createTask>[]): Record<string, number> =>
    Object.fromEntries(tasks.map(task => [task.id, task.order]))

  it('promotes a card to the top of its column, shifting others down in order', () => {
    const [a, b, c] = column(['a', 'b', 'c'])
    const promoted = promoteToColumnTop([a, b, c], 'c', 'todo', NOW + 1)
    expect(keyed(promoted)).toEqual({ c: 0, a: 1, b: 2 })
    expect(promoted.find(task => task.id === 'c')?.updatedAt).toBe(NOW + 1)
  })

  it('promotes a cross-column card into a new column at the top', () => {
    const [a, b, c] = column(['a', 'b', 'c'])
    const backlog = createTask({ title: 'e', description: '', prompt: '' }, NOW, 'e', 0)
    const backlogTask = { ...backlog, status: 'backlog' as const }
    const promoted = promoteToColumnTop([a, b, c, backlogTask], 'c', 'backlog', NOW + 1)
    expect(promoted.find(task => task.id === 'c')?.status).toBe('backlog')
    expect(promoted.find(task => task.id === 'c')?.order).toBe(0)
    // Cross-column promotion records the move in the history.
    expect(promoted.find(task => task.id === 'c')?.statusHistory)
      .toEqual([{ status: 'todo', at: NOW }, { status: 'backlog', at: NOW + 1 }])
    // The source column keeps its own keys (gaps are harmless).
    expect(keyed(promoted)).toEqual({ a: 0, b: 1, e: 1, c: 0 })
  })

  it('is a no-op when the card is already at the top of its status', () => {
    const [a, b] = column(['a', 'b'])
    const out = promoteToColumnTop([a, b], 'a', 'todo', NOW + 1)
    expect(keyed(out)).toEqual({ a: 0, b: 1 })
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

describe('landingStatusOf', () => {
  it('lands an external sidebar drop in exactly the dropped column (all five)', () => {
    expect(landingStatusOf('backlog')).toBe('backlog')
    expect(landingStatusOf('todo')).toBe('todo')
    expect(landingStatusOf('running')).toBe('running')
    expect(landingStatusOf('review')).toBe('review')
    expect(landingStatusOf('done')).toBe('done')
  })
})

describe('settleExecution', () => {
  it('settles a successful run into review (the human gate before done)', () => {
    const { task } = startExecution(sampleTask(), NOW, 'exec-1')
    const settled = settleExecution(task, 'exec-1', 'succeeded', NOW + 10, undefined)
    expect(settled.status).toBe('review')
    expect(settled.executions[0].endedAt).toBe(NOW + 10)
    expect(settled.executions[0].result).toBe('succeeded')
    expect(settled.executions[0].error).toBeUndefined()
  })

  it('settles a failed run into review too (outcome lives in the record)', () => {
    const { task } = startExecution(sampleTask(), NOW, 'exec-1')
    const settled = settleExecution(task, 'exec-1', 'failed', NOW + 10, 'boom')
    expect(settled.status).toBe('review')
    expect(settled.executions[0].result).toBe('failed')
    expect(settled.executions[0].error).toBe('boom')
  })

  it('cancelled runs return a non-running task to todo', () => {
    const { task } = startExecution(sampleTask(), NOW, 'exec-1')
    const settled = settleExecution(task, 'exec-1', 'cancelled', NOW + 10, 'interrupted')
    expect(settled.status).toBe('todo')
    expect(settled.executions[0].result).toBe('cancelled')
  })

  it('is a no-op for unknown or already-settled executions', () => {
    const { task } = startExecution(sampleTask(), NOW, 'exec-1')
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

  it('keeps a budgeted scheduled batch running until the final run (fire counts at launch)', () => {
    // Real order: the scheduler persists the incremented runCount at
    // fire-accept, BEFORE the run can settle — a settled scheduled run is
    // already counted, so "more runs remain" is `runCount < maxRuns`.
    let task = withSchedule(sampleTask(), { enabled: true, cron: '* * * * *', maxRuns: 3, runCount: 1 }, NOW)
    const first = startExecution(task, NOW, 'e1')
    const settled1 = settleExecution(first.task, 'e1', 'succeeded', NOW + 1, undefined)
    // Run 1 of 3: the card stays 'running' (the batch is not complete).
    expect(settled1.status).toBe('running')
    expect(settled1.executions[0].result).toBe('succeeded')
    // Run 2 of 3: still within budget — the off-by-one form (`+1`) would land
    // 'review' here and the next tick would skip the final fire via the
    // column pause, leaving the batch one run short.
    task = withSchedule(settled1, { runCount: 2 }, NOW + 2)
    const second = startExecution(task, NOW + 3, 'e2')
    const settled2 = settleExecution(second.task, 'e2', 'succeeded', NOW + 4, undefined)
    expect(settled2.status).toBe('running')
    // The final budgeted run: disarmed at fire (runCount = maxRuns), settles
    // into review — the human gate.
    task = withSchedule(settled2, { runCount: 3, enabled: false }, NOW + 5)
    const third = startExecution(task, NOW + 6, 'e3')
    const settled3 = settleExecution(third.task, 'e3', 'succeeded', NOW + 7, undefined)
    expect(settled3.status).toBe('review')
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

  it('a cancelled noise round with prior success lands in review (never swallows the gate)', () => {
    let task = sampleTask()
    const first = startExecution(task, NOW, 'e1')
    task = { ...first.task, executions: first.task.executions.map(round => ({ ...round, sessionId: 's-1' })) }
    task = settleExecution(task, 'e1', 'succeeded', NOW + 1, undefined)
    expect(task.status).toBe('review')
    // Native noise arrives later (external observation drives running).
    const noisy: TaskRecord = {
      ...task,
      status: 'running',
      executions: [...task.executions, newExternalRound({ id: 'ext-1', now: NOW + 2, sessionId: 's-1', text: 'hi' })],
    }
    const cancelled = settleExecution(noisy, 'ext-1', 'cancelled', NOW + 3, undefined)
    expect(cancelled.status).toBe('review')
  })

  it('a cancelled noise round with prior failure lands in review too', () => {
    let task = sampleTask()
    const first = startExecution(task, NOW, 'e1')
    task = settleExecution(first.task, 'e1', 'failed', NOW + 1, 'boom')
    const noisy: TaskRecord = {
      ...task,
      status: 'running',
      executions: [...task.executions, newExternalRound({ id: 'ext-1', now: NOW + 2, sessionId: 's-1' })],
    }
    expect(settleExecution(noisy, 'ext-1', 'cancelled', NOW + 3, undefined).status).toBe('review')
  })

  it('a cancelled first run with no history returns to todo', () => {
    const { task } = startExecution(sampleTask(), NOW, 'e1')
    expect(hasCompletedWork(task)).toBe(false)
    expect(settleExecution(task, 'e1', 'cancelled', NOW + 1, undefined).status).toBe('todo')
  })

  it('settleColumnOf keeps a parked column on cancel (never yanks it)', () => {
    const parked = withStatus(sampleTask(), 'backlog', NOW)
    expect(settleColumnOf(parked, 'cancelled', false, false, false)).toBe('backlog')
    const running = withStatus(sampleTask(), 'running', NOW)
    expect(settleColumnOf(running, 'cancelled', false, false, false)).toBe('todo')
    expect(settleColumnOf(running, 'succeeded', false, false, false)).toBe('review')
    expect(settleColumnOf(running, 'succeeded', true, false, false)).toBe('running')
  })

  it('an open refine round never pins a plain settle in running', () => {
    let task = sampleTask()
    const plain = startExecution(task, NOW, 'e-plain')
    task = {
      ...plain.task,
      executions: [
        ...plain.task.executions.map(round => ({ ...round, sessionId: 's-plain' })),
        { id: 'ref-1', sessionId: 's-refine', startedAt: NOW + 1, endedAt: undefined, result: undefined, error: undefined, refine: true },
      ],
    }
    expect(openExecutionRoundsOf(task).map(round => round.id)).toEqual(['e-plain'])
    const settled = settleExecution(task, 'e-plain', 'succeeded', NOW + 2, undefined)
    expect(settled.status).toBe('review')
  })
})

describe('newCommentRound', () => {
  it('builds an execution-anchored pending comment round', () => {
    const round = newCommentRound({ id: 'c-1', now: NOW, text: '继续', sessionId: 's-1', parentExecutionId: 'e-1' })
    expect(round.comment).toBe('继续')
    expect(round.sessionId).toBe('s-1')
    expect(round.parentExecutionId).toBe('e-1')
    expect(round.sessionAnchor).toBeUndefined()
    expect(round.endedAt).toBeUndefined()
    expect(round.injectedAt).toBeUndefined()
    expect(round.result).toBeUndefined()
    expect(round.command).toBeUndefined()
    expect(round.startedAt).toBe(NOW)
  })

  it('builds a session-anchored pending comment round for a linked session', () => {
    const round = newCommentRound({ id: 'c-2', now: NOW, text: '驱动一下', sessionId: 'linked-7', sessionAnchor: 'linked-7' })
    expect(round.comment).toBe('驱动一下')
    expect(round.sessionId).toBe('linked-7')
    expect(round.sessionAnchor).toBe('linked-7')
    expect(round.parentExecutionId).toBeUndefined()
    expect(round.endedAt).toBeUndefined()
  })

  it('flags slash-command rounds while plain text stays unflagged', () => {
    const command = newCommentRound({ id: 'c-3', now: NOW, text: '/plan 干', command: true, sessionId: 's-1', parentExecutionId: 'e-1' })
    expect(command.command).toBe(true)
    const plain = newCommentRound({ id: 'c-4', now: NOW, text: '普通', sessionId: 's-1', parentExecutionId: 'e-1' })
    expect(plain.command).toBeUndefined()
  })
})

describe('withSchedule', () => {
  it('creates a schedule rule on a task without one and bumps updatedAt', () => {
    const task = sampleTask()
    const scheduled = withSchedule(task, { enabled: true, cron: '0 9 * * *', nextRunAt: NOW + 100 }, NOW + 1)
    expect(scheduled.schedule).toEqual({
      enabled: true, mode: 'cron', cron: '0 9 * * *', nextRunAt: NOW + 100, lastTriggeredAt: undefined,
      maxRuns: undefined, runCount: 0, primed: true,
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
      maxRuns: undefined, runCount: 0, primed: true,
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

  it('refuses EVERY column while an execution is open (a dragged-away card would orphan the round)', () => {
    const { task } = startExecution(sampleTask(), NOW, 'e1')
    expect(resolveCardDrop(task, 'done')).toEqual({ kind: 'reject', reason: 'busy' })
    expect(resolveCardDrop(task, 'review')).toEqual({ kind: 'reject', reason: 'busy' })
    // Leaving 进行中 to backlog/todo used to be allowed — it silently orphaned
    // the open round (no surface settles a parked card's plain run), which
    // then held a slot and swallowed the session's future native turns.
    expect(resolveCardDrop(task, 'backlog')).toEqual({ kind: 'reject', reason: 'busy' })
    expect(resolveCardDrop(task, 'todo')).toEqual({ kind: 'reject', reason: 'busy' })
  })

  it('refuses the move when the open round is NOT the last record (several sessions on one card)', () => {
    // The single-lane assumption lived here: the guard tested the LAST row.
    // With per-session lanes the newest row is often a conversation that
    // already finished while an older one still runs — dragging then orphaned
    // the live round (it held a slot and swallowed its session's native turns
    // until the watchdog released it three minutes later).
    const { task } = startExecution(sampleTask(), NOW, 'e1')
    const withLaterSettled: TaskRecord = {
      ...task,
      executions: [
        { ...task.executions[0], sessionId: 's-1' },
        {
          id: 'e2', sessionId: 's-2', startedAt: NOW + 1, endedAt: NOW + 5,
          result: 'succeeded' as const, error: undefined,
        },
      ],
    }
    expect(withLaterSettled.executions[withLaterSettled.executions.length - 1].endedAt).toBeDefined()
    expect(resolveCardDrop(withLaterSettled, 'todo')).toEqual({ kind: 'reject', reason: 'busy' })
    expect(resolveCardDrop(withLaterSettled, 'backlog')).toEqual({ kind: 'reject', reason: 'busy' })
  })

  it('a saved (never-started) comment round still allows free movement', () => {
    // Only an OPEN round on a RUNNING card is the orphan case; a parked card
    // with a queued comment is not busy at all.
    const queued = withStatus({ ...sampleTask(), executions: [{ id: 'c1', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined, comment: 'hi', sessionId: 's-1' }] }, 'backlog', NOW)
    expect(resolveCardDrop(queued, 'todo')).toEqual({ kind: 'move', status: 'todo' })
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

  it('a chain card moves freely (automation never blocks a drop)', () => {
    const base = withSchedule(sampleTask(), { enabled: true, mode: 'chain', cron: '' }, NOW)
    const { task } = startExecution(base, NOW, 'e1') // running + open
    // An open run on the running column is a no-op (already there).
    expect(resolveCardDrop(task, 'running')).toEqual({ kind: 'none' })
    // Settled but still 'running' (the chain keeps the card in progress).
    const settled = settleExecution(task, 'e1', 'succeeded', NOW + 1, undefined)
    expect(settled.status).toBe('running')
    expect(resolveCardDrop(settled, 'running')).toEqual({ kind: 'run' })
    // The chain never rejects a move: leaving the lane is a manual decision
    // (moveTask pauses/stops it on the controller side, never a rejection).
    expect(resolveCardDrop(settled, 'todo')).toEqual({ kind: 'move', status: 'todo' })
    expect(resolveCardDrop(settled, 'done')).toEqual({ kind: 'move', status: 'done' })
    expect(resolveCardDrop(settled, 'backlog')).toEqual({ kind: 'move', status: 'backlog' })
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
    // Injected (the real marker `launchComment` writes, not a hand-flipped
    // column) → the card is working again.
    const injected = {
      ...withPending,
      status: 'running' as const,
      executions: withPending.executions.map(round => round.id === 'c1' ? { ...round, injectedAt: NOW + 3 } : round),
    }
    expect(hasOpenRun(injected)).toBe(true)
  })

  it('sees an open round that is NOT the last record (a card runs several sessions)', () => {
    // The lane is the session: a card can have one conversation still working
    // while a newer record (another session) already settled. "the latest
    // execution" must never be the only thing the budget/drop-guard checks —
    // a round behind it would hold its slot forever.
    const { task } = startExecution(sampleTask(), NOW, 'e1')
    const withTwo: TaskRecord = {
      ...task,
      executions: [
        { ...task.executions[0], sessionId: 's-1' },
        {
          id: 'e2', sessionId: 's-2', startedAt: NOW + 1, endedAt: NOW + 5,
          result: 'succeeded' as const, error: undefined,
        },
      ],
    }
    expect(withTwo.executions[withTwo.executions.length - 1].endedAt).toBeDefined()
    expect(hasOpenRun(withTwo)).toBe(true)
    expect(openRoundsOf(withTwo).map(round => round.id)).toEqual(['e1'])
    expect(sessionIsBusy(withTwo, 's-1')).toBe(true)
    expect(sessionIsBusy(withTwo, 's-2')).toBe(false)
  })

  it('lastPlainResult answers "how did this task run" regardless of which row is newest', () => {
    const { task } = startExecution(sampleTask(), NOW, 'e1')
    const ran = settleExecution(task, 'e1', 'failed', NOW + 1, 'boom')
    // A later comment round that succeeded, and a later comment still SAVED
    // (no result at all): neither may change the answer about the card's own
    // execution — that split is what made one surface read 失败 and another
    // 成功 for the same card.
    const withLanes: TaskRecord = {
      ...ran,
      executions: [
        ...ran.executions,
        { id: 'c1', sessionId: 's-2', startedAt: NOW + 2, endedAt: NOW + 3, result: 'succeeded' as const, error: undefined, comment: '留言跑通了' },
        { id: 'c2', sessionId: 's-3', startedAt: NOW + 4, endedAt: undefined, result: undefined, error: undefined, comment: '挂着' },
      ],
    }
    expect(lastPlainResult(withLanes)).toBe('failed')
    expect(latestExecutionOf(withLanes)?.result).toBeUndefined()
    expect(lastPlainResult(sampleTask())).toBeUndefined()
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

  it('excludes refinement rounds alongside comment rounds', () => {
    const task = {
      ...withComments(),
      executions: [
        ...withComments().executions,
        { id: 'r1', sessionId: 's-refine', startedAt: NOW + 6, endedAt: NOW + 7, result: 'succeeded' as const, error: undefined, refine: true },
      ],
    }
    expect(plainRunsOf(task).map(run => run.id)).toEqual(['e1'])
  })
})

describe('requirement refinement', () => {
  function withRefine() {
    const base = createTask({ title: '想法', description: '', prompt: '', status: 'backlog' }, NOW, 'task-1')
    return {
      ...base,
      refineSessionId: 's-refine',
      executions: [
        { id: 'r1', sessionId: 's-refine', startedAt: NOW, endedAt: NOW + 1, result: 'succeeded' as const, error: undefined, refine: true },
        { id: 'r2', sessionId: 's-refine', startedAt: NOW + 2, endedAt: undefined, result: undefined, error: undefined, refine: true },
      ],
    }
  }

  it('refineRoundsOf returns only refinement rounds in order', () => {
    const task = withRefine()
    expect(refineRoundsOf(task).map(round => round.id)).toEqual(['r1', 'r2'])
    expect(refineRoundsOf(sampleTask())).toEqual([])
  })

  it('refining is true while a refinement round is open', () => {
    expect(refining(withRefine())).toBe(true)
    const settled = { ...withRefine(), executions: withRefine().executions.map(round => ({ ...round, endedAt: NOW + 9 })) }
    expect(refining(settled)).toBe(false)
    expect(refining(sampleTask())).toBe(false)
  })

  it('hasOpenRun treats an open refinement round as an open run', () => {
    const task = withRefine()
    // Even though the task sits in backlog (not running), the refine round
    // occupies the session — a plain run must not start on top.
    expect(hasOpenRun(task)).toBe(true)
    const settled = { ...task, executions: task.executions.map(round => ({ ...round, endedAt: NOW + 9 })) }
    expect(hasOpenRun(settled)).toBe(false)
  })

  it('refinable needs at least one non-blank field (an all-blank task has nothing to research)', () => {
    expect(refinable(withRefine())).toBe(true)
    expect(refinable(createTask({ title: '  ', description: ' ', prompt: '' }, NOW, 'blank'))).toBe(false)
    expect(refinable(createTask({ title: '', description: '有个想法', prompt: '' }, NOW, 'desc'))).toBe(true)
  })

  it('executing excludes lone refinement (display truth, never a gate)', () => {
    // A refining backlog card is preparing, not executing — the card must
    // read 完善中, never 进行中 (the "一点完善整卡变进行中" bug).
    expect(executing(withRefine())).toBe(false)
    const settled = { ...withRefine(), executions: withRefine().executions.map(round => ({ ...round, endedAt: NOW + 9 })) }
    expect(executing(settled)).toBe(false)
    const plain = {
      ...sampleTask(),
      executions: [{ id: 'e1', sessionId: 's-1', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined }],
    }
    expect(executing(plain)).toBe(true)
  })

  it('withRefineSession binds the session and stamps the update', () => {
    const task = withRefineSession(sampleTask(), 's-new', NOW + 5)
    expect(task.refineSessionId).toBe('s-new')
    expect(task.updatedAt).toBe(NOW + 5)
    // Re-binding the same session is a no-op.
    expect(withRefineSession(task, 's-new', NOW + 6)).toBe(task)
  })

  it('settleRefine records the outcome without moving the task out of its column', () => {
    const task = withRefine()
    const settled = settleRefine(task, 'r2', 'failed', NOW + 8, '调研失败')
    expect(settled.status).toBe('backlog')
    expect(settled.executions[1]).toMatchObject({ endedAt: NOW + 8, result: 'failed', error: '调研失败' })
    expect(settled.updatedAt).toBe(NOW + 8)
    // Unknown or already-settled rounds are no-ops.
    expect(settleRefine(task, 'ghost', 'succeeded', NOW + 9, undefined)).toBe(task)
    expect(settleRefine(settled, 'r1', 'failed', NOW + 10, undefined)).toBe(settled)
  })

  it('a settled refine round is seen at its own settle (no eternal unread ring)', () => {
    const task = withRefine()
    const settled = settleRefine(task, 'r2', 'succeeded', NOW + 8, undefined)
    const round = settled.executions.find(item => item.id === 'r2')!
    expect(round.viewedAt).toBe(NOW + 8)
    // With the task's own baseline at/after the settle, the finished refine
    // turn never counts as unread — the 完善中 glow was state-bound anyway.
    expect(taskUnviewed({ ...settled, viewedAt: NOW + 8 })).toBe(false)
  })
})

describe('ruleReadiness', () => {
  const armed = { mode: 'chain' as const, cron: '', maxRuns: undefined, runCount: 0 }

  it('is disabled without a rule or when the rule is off', () => {
    expect(ruleReadiness(sampleTask())).toEqual({ kind: 'disabled' })
    const off = withSchedule(sampleTask(), { enabled: false, cron: '0 9 * * *' }, NOW)
    expect(ruleReadiness(off)).toEqual({ kind: 'disabled' })
  })

  it('is active for todo/running as soon as the rule is armed (no manual-first gate)', () => {
    for (const status of ['todo', 'running'] as const) {
      const task = withSchedule(withStatus(sampleTask(), status, NOW), { ...armed, enabled: true, cron: '0 9 * * *' }, NOW)
      expect(ruleReadiness(task)).toEqual({ kind: 'active' })
    }
  })

  it('is paused for backlog/review/done in CRON mode, naming the blocking status', () => {
    // The column pause belongs to the cron wheel: a scheduled instant can
    // land on a shelved card, so it must not drive one.
    const armedCron = { mode: 'cron' as const, cron: '0 9 * * *', maxRuns: undefined, runCount: 0 }
    const backlog = withSchedule(withStatus(sampleTask(), 'backlog', NOW), { ...armedCron, enabled: true }, NOW)
    expect(ruleReadiness(backlog)).toEqual({ kind: 'paused', status: 'backlog' })
    const review = withSchedule(withStatus(sampleTask(), 'review', NOW), { ...armedCron, enabled: true }, NOW)
    expect(ruleReadiness(review)).toEqual({ kind: 'paused', status: 'review' })
    // Done is also paused: a completed task's armed rule must never drive it
    // (the completion path additionally disarms it outright — this is the
    // safety net for legacy rows that still carry a stale enabled flag).
    const done = withSchedule(withStatus(sampleTask(), 'done', NOW), { ...armedCron, enabled: true }, NOW)
    expect(ruleReadiness(done)).toEqual({ kind: 'paused', status: 'done' })
  })

  it('a CHAIN is never column-paused: 完成后接续 keeps going at every settle', () => {
    // The hand-off runs at the settle instant (the task was drivable when the
    // run started; the completion IS the appointment), so a chain armed on a
    // review/done card reads active — 待审核/已完成 are what the run landed
    // in, never a reason for the chain to stop.
    for (const status of ['backlog', 'review', 'done'] as const) {
      const chain = withSchedule(withStatus(sampleTask(), status, NOW), { ...armed, enabled: true }, NOW)
      expect(ruleReadiness(chain)).toEqual({ kind: 'active' })
    }
  })

  it('is BLOCKED when the execution prompt is empty (an armed rule cannot drive nothing)', () => {
    const blank = {
      ...withSchedule(withStatus(sampleTask(), 'todo', NOW), { ...armed, enabled: true, cron: '0 9 * * *' }, NOW),
      prompt: '',
    }
    expect(ruleReadiness(blank)).toEqual({ kind: 'blocked' })
    // Column state does not matter: blocked wins over the column pause, and a
    // disarmed rule stays disabled (disabled wins).
    expect(ruleReadiness({ ...blank, status: 'done' })).toEqual({ kind: 'blocked' })
    expect(ruleReadiness(withSchedule(blank, { enabled: false, cron: '0 9 * * *' }, NOW))).toEqual({ kind: 'disabled' })
  })
})

describe('taskExecutable', () => {
  it('is true only when the prompt has real (trimmed) content', () => {
    expect(taskExecutable({ ...sampleTask(), prompt: 'run' })).toBe(true)
    expect(taskExecutable({ ...sampleTask(), prompt: '  run  ' })).toBe(true)
    expect(taskExecutable({ ...sampleTask(), prompt: '' })).toBe(false)
    expect(taskExecutable({ ...sampleTask(), prompt: '   ' })).toBe(false)
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

describe('cardSourceLabel', () => {
  it('shows the bound session title only when it differs from the task title', () => {
    const task = createTask({ title: 'My task', description: '', prompt: '' }, NOW, 'task-1')
    expect(cardSourceLabel(task, 'My task', 'workspace-a')).toBe('workspace-a')
    expect(cardSourceLabel(task, 'The real session', 'workspace-a')).toBe('The real session')
  })

  it('skips a source named exactly like the task, in order: session then workspace', () => {
    const task = createTask({ title: 'Same name', description: '', prompt: '' }, NOW, 'task-1')
    expect(cardSourceLabel(task, 'Same name', 'workspace-a')).toBe('workspace-a')
    expect(cardSourceLabel(task, '', 'Same name')).toBe('')
    expect(cardSourceLabel(task, 'Same name', 'Same name')).toBe('')
  })

  it('prefers the session source over the workspace label', () => {
    const task = createTask({ title: 'Task', description: '', prompt: '' }, NOW, 'task-1')
    expect(cardSourceLabel(task, 'Session X', 'Workspace Y')).toBe('Session X')
  })

  it('is empty when there is nothing to show (never a guessed default)', () => {
    const task = createTask({ title: 'Task', description: '', prompt: '' }, NOW, 'task-1')
    expect(cardSourceLabel(task, '', '')).toBe('')
  })
})

describe('supplementLaunchFields (真执行自动补全 — 缺则补、填则守，任何一次执行)', () => {
  const prompt = '画一只猫\n并解释配色'

  it('(a) title+description both missing → both filled from the prompt', () => {
    const task = { ...sampleTask(), prompt, title: '  ', description: '' }
    expect(supplementLaunchFields(task)).toEqual({ title: '画一只猫', description: prompt })
  })

  it('(b) only description missing → description filled, title untouched', () => {
    const task = { ...sampleTask(), prompt, title: '猫咪插画', description: '  ' }
    expect(supplementLaunchFields(task)).toEqual({ description: prompt })
  })

  it('(c) only title missing → title filled, description untouched', () => {
    const task = { ...sampleTask(), prompt, title: '', description: '猫咪插画' }
    expect(supplementLaunchFields(task)).toEqual({ title: '画一只猫' })
  })

  it('existing fields are never overwritten', () => {
    const task = { ...sampleTask(), prompt, title: '猫咪插画', description: '描述' }
    expect(supplementLaunchFields(task)).toBeUndefined()
  })

  it('an already-run task is STILL supplemented when a field is missing (任何一次执行缺则补)', () => {
    const ran = { ...sampleTask(), prompt, title: '', description: '' }
    const withRun = startExecution(ran, NOW, 'e1').task
    const settled = settleExecution(withRun, 'e1', 'succeeded', NOW + 1, undefined)
    expect(supplementLaunchFields(settled)).toEqual({ title: '画一只猫', description: prompt })
  })

  it('an already-settled task with fields present is never touched (填则守)', () => {
    const ran = { ...sampleTask(), prompt, title: '猫咪插画', description: '描述' }
    const withRun = startExecution(ran, NOW, 'e1').task
    const settled = settleExecution(withRun, 'e1', 'succeeded', NOW + 1, undefined)
    expect(supplementLaunchFields(settled)).toBeUndefined()
  })

  it('an empty prompt is never supplemented (the task is inert anyway)', () => {
    expect(supplementLaunchFields({ ...sampleTask(), prompt: '  ' })).toBeUndefined()
  })

  it('the title takes the first non-empty line, capped at 40 chars', () => {
    const long = '先行行' + 'x'.repeat(60)
    const task = { ...sampleTask(), prompt: `\n${long}\n第二行`, title: '', description: '' }
    expect(supplementLaunchFields(task)).toEqual({ title: long.slice(0, 40), description: `${long}\n第二行` })
  })
})

describe('normalizePriority (1/2/3 or absent)', () => {
  it('accepts 1, 2 and 3, rejects everything else', () => {
    expect(normalizePriority(1)).toBe(1)
    expect(normalizePriority(2)).toBe(2)
    expect(normalizePriority(3)).toBe(3)
    expect(normalizePriority(0)).toBeUndefined()
    expect(normalizePriority(4)).toBeUndefined()
    expect(normalizePriority('1')).toBeUndefined()
    expect(normalizePriority(Number.NaN)).toBeUndefined()
    expect(normalizePriority(undefined)).toBeUndefined()
  })

  it('createTask carries a valid priority and drops junk', () => {
    expect(createTask({ title: 't', description: '', prompt: 'p', priority: 1 }, NOW, 'a').priority).toBe(1)
    expect(createTask({ title: 't', description: '', prompt: 'p' }, NOW, 'a').priority).toBeUndefined()
    expect(createTask({ title: 't', description: '', prompt: 'p', priority: 9 as unknown as 1 }, NOW, 'a').priority).toBeUndefined()
  })
})

describe('normalizeLabels (lowercase/dedupe/cap or absent)', () => {
  it('trims, lowercases, dedupes and drops empties', () => {
    expect(normalizeLabels(['  Urgent ', 'urgent', '', 'phone'])).toEqual(['urgent', 'phone'])
    expect(normalizeLabels([])).toBeUndefined()
    expect(normalizeLabels(['   '])).toBeUndefined()
    expect(normalizeLabels('urgent')).toBeUndefined()
    expect(normalizeLabels(undefined)).toBeUndefined()
  })

  it('drops overlong labels and caps the count', () => {
    expect(normalizeLabels(['x'.repeat(25)])).toBeUndefined()
    expect(normalizeLabels(['a', 'b', 'c', 'd', 'e', 'f'])).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('createTask carries normalized labels', () => {
    expect(createTask({ title: 't', description: '', prompt: 'p', labels: ['B', 'b', 'a'] }, NOW, 'a').labels).toEqual(['b', 'a'])
    expect(createTask({ title: 't', description: '', prompt: 'p' }, NOW, 'a').labels).toBeUndefined()
  })
})

describe('statusHistory (column-move ledger)', () => {
  it('createTask seeds the birth column', () => {
    expect(createTask({ title: 't', description: '', prompt: 'p' }, NOW, 'a').statusHistory)
      .toEqual([{ status: 'todo', at: NOW }])
  })

  it('withStatus appends on moves and skips touches', () => {
    const task = createTask({ title: 't', description: '', prompt: 'p' }, NOW, 'a')
    const moved = withStatus(task, 'running', NOW + 1)
    expect(moved.statusHistory).toEqual([{ status: 'todo', at: NOW }, { status: 'running', at: NOW + 1 }])
    const touched = withStatus(moved, 'running', NOW + 2)
    expect(touched.statusHistory).toEqual(moved.statusHistory)
    expect(touched.updatedAt).toBe(NOW + 2)
  })

  it('withStatus backfills the birth column for legacy rows (createdAt, one rule)', () => {
    const legacy = { ...createTask({ title: 't', description: '', prompt: 'p' }, NOW, 'a'), statusHistory: undefined, updatedAt: NOW + 5 }
    const moved = withStatus(legacy, 'running', NOW + 10)
    expect(moved.statusHistory).toEqual([
      { status: 'todo', at: NOW },
      { status: 'running', at: NOW + 10 },
    ])
  })
})
