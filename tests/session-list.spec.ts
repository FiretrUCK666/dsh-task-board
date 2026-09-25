/**
 * Unified session-list tests: the single "会话" derivation — run + linked
 * merged by session id, run-wins dedupe, derived hide set, ordering.
 */
import { describe, expect, it } from 'vitest'
import { createTask, settleExecution, startExecution, type TaskRecord } from '../src/core/tasks.ts'
import { hasHiddenSessions, hiddenSessionIdsOf, orderedSessionsOf, sessionRowTitleOf, sessionWindowOf, taskSessionsOf } from '../src/core/session-list.ts'
import { newExternalRound } from '../src/core/tasks.ts'
import type { LinkedSessionRow } from '../src/core/linked-sessions.ts'

const NOW = 1_700_000_000_000

function sampleTask(): TaskRecord {
  return createTask({ title: 't', description: '', prompt: '' }, NOW, 'task-1')
}

/** A task with one settled run on session s-1 (execution e-1). */
function withOneRun(): TaskRecord {
  let { task } = startExecution(sampleTask(), NOW, 'e-1')
  task = { ...task, executions: task.executions.map(round =>
    round.id === 'e-1' ? { ...round, sessionId: 's-1' } : round) }
  return settleExecution(task, 'e-1', 'succeeded', NOW + 1, undefined)
}

function linkedRow(overrides: Partial<LinkedSessionRow> = {}): LinkedSessionRow {
  return {
    sessionId: 's-1',
    title: '链接会话',
    workspaceLabel: 'wk',
    running: false,
    pendingInteraction: undefined,
    updatedAt: NOW + 2,
    ...overrides,
  }
}

function ctx(linked: readonly LinkedSessionRow[] = []) {
  return {
    linked,
    titleOf: (id: string): string | undefined => id === 's-1' ? '原生标题' : undefined,
    pendingInteractionOf: () => undefined,
    untitledLabel: '未命名',
  }
}

describe('taskSessionsOf (统一会话列表)', () => {
  it('lists run sessions — one per session, latest run as the representative', () => {
    let task = withOneRun()
    // A second run reusing s-1 must not add a row, and the representative is
    // the latest one.
    task = { ...task, executions: [...task.executions, {
      id: 'e-2', sessionId: 's-1', startedAt: NOW + 10, endedAt: NOW + 11, result: 'succeeded' as const, error: undefined,
    }] }
    const rows = taskSessionsOf(task, ctx())
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ sessionId: 's-1', executionId: 'e-2' })
  })

  it('permanently removed sessions never re-derive — even from bound sources', () => {
    // s-9 is a genuine linked-only session: removing it must drop its row for
    // good (the hidden set would re-show it; removed cannot).
    const task = { ...withOneRun(), removedSessions: ['s-9'] }
    const rows = taskSessionsOf(task, ctx([linkedRow({ sessionId: 's-9', title: '外部', updatedAt: NOW + 5 })]))
    expect(rows.map(row => row.sessionId)).toEqual(['s-1'])
  })

  it('appends linked rows that are not run sessions; run wins on a clash', () => {
    const task = withOneRun() // run session s-1
    const rows = taskSessionsOf(task, ctx([
      linkedRow(),                                                          // same s-1 → run wins, one row only
      linkedRow({ sessionId: 's-9', title: '外部', updatedAt: NOW + 5 }),   // genuine linked-only session
    ]))
    expect(rows.map(row => row.sessionId)).toEqual(['s-1', 's-9'])
    expect(rows[0]).toMatchObject({ executionId: 'e-1', title: '原生标题' })
    expect(rows[1]).toMatchObject({ title: '外部', workspaceLabel: 'wk' })
  })

  it('hides sessions from both families via the derived set', () => {
    const task = { ...withOneRun(), hidden: { sessions: ['s-1'] } }
    expect(taskSessionsOf(task, ctx())).toEqual([])
    expect(hasHiddenSessions(task)).toBe(true)
    // An execution-family hide maps onto the same session (legacy data).
    const task2 = { ...withOneRun(), hidden: { executions: ['e-1'] } }
    expect(hiddenSessionIdsOf(task2).has('s-1')).toBe(true)
    expect(taskSessionsOf(task2, ctx())).toEqual([])
    expect(hasHiddenSessions(task2)).toBe(true)
  })

  it('drops run rounds whose session is still unknown (connecting)', () => {
    const { task } = startExecution(sampleTask(), NOW, 'e-1') // no sessionId yet
    expect(taskSessionsOf(task, ctx())).toEqual([])
  })

  it('sorts run rows by latest activity, then linked rows in workspace order', () => {
    let task = withOneRun() // s-1 ended NOW+1
    task = { ...task, executions: [...task.executions, {
      id: 'e-2', sessionId: 's-2', startedAt: NOW, endedAt: NOW + 2, result: 'succeeded' as const, error: undefined,
    }] }
    const rows = taskSessionsOf(task, ctx([
      linkedRow({ sessionId: 's-9', updatedAt: NOW + 999 }),
    ]))
    expect(rows[0].sessionId).toBe('s-2') // newest run activity first
    expect(rows[1].sessionId).toBe('s-1')
    expect(rows[2].sessionId).toBe('s-9') // linked group after the run group
  })

  it('a session NOT in the arrangement floats by the work it did on this card', () => {
    // The trap this pins: a row's key used to be the host's `updatedAt` for a
    // linked conversation, so a bound session you had just chatted with — whose
    // turn the board observed onto this very card — sorted as if nothing had
    // happened, and stayed buried under the arranged rows. The key is now the
    // session's own activity on this card, whichever source is newer.
    const task = { ...withOneRun(), sessionsOrder: ['s-1'] } // arranged: s-1 only
    const observed = { ...task, executions: [...task.executions, newExternalRound({
      id: 'x-1', now: NOW + 5, sessionId: 's-2', text: '看一眼',
    })] }
    const rows = taskSessionsOf(observed, ctx([
      // Bound, with a much older host touch than the observed turn.
      linkedRow({ sessionId: 's-2', updatedAt: NOW - 10_000 }),
    ]))
    expect(rows.map(row => row.sessionId)).toEqual(['s-2', 's-1'])
    expect(rows[0].updatedAt).toBe(NOW + 5)
  })

  it('a bound session with no work on this card keeps the host touch as its key', () => {
    const task = { ...withOneRun(), sessionsOrder: ['s-1'] }
    const rows = taskSessionsOf(task, ctx([
      linkedRow({ sessionId: 's-9', updatedAt: NOW + 999 }),
    ]))
    expect(rows.map(row => row.sessionId)).toEqual(['s-9', 's-1'])
    expect(rows[0].updatedAt).toBe(NOW + 999)
  })

  it('shows 未命名 for a title-less run session (never the task title, never a raw id)', () => {
    const task = sampleTask()
    const { task: running } = startExecution(task, NOW, 'e-1')
    const withSession = { ...running, executions: running.executions.map(e => ({ ...e, sessionId: 's-x' })) }
    const rows = taskSessionsOf(withSession, {
      linked: [],
      titleOf: () => undefined,
      pendingInteractionOf: () => undefined,
      untitledLabel: '未命名',
    })
    expect(rows[0].title).toBe('未命名')
  })

  it('a linked row named by its raw id (no title, no cwd) reads 未命名 too', () => {
    const rows = taskSessionsOf(withOneRun(), ctx([
      linkedRow({ sessionId: 's-bare', title: 's-bare', workspaceLabel: undefined, updatedAt: NOW + 7 }),
    ]))
    const bare = rows.find(row => row.sessionId === 's-bare')
    expect(bare?.title).toBe('未命名')
  })
})

describe('sessionRowTitleOf (未命名文法)', () => {
  it('shows the native title when present, else the untitled placeholder', () => {
    expect(sessionRowTitleOf('原生标题', '未命名')).toBe('原生标题')
    expect(sessionRowTitleOf(undefined, '未命名')).toBe('未命名')
    expect(sessionRowTitleOf('', '未命名')).toBe('未命名')
  })
})

describe('orderedSessionsOf (manual 会话 order)', () => {
  const rows = [
    { sessionId: 's-run', title: 'a', executionId: 'e-1', display: { state: 'succeeded' as const, lastActivity: NOW, waitingKind: undefined }, updatedAt: NOW },
    { sessionId: 's-9', title: 'b', display: { state: 'cancelled' as const, lastActivity: NOW + 2, waitingKind: undefined }, updatedAt: NOW + 5 },
  ]

  it('defaults to the passed order when the user never reordered', () => {
    expect(orderedSessionsOf(sampleTask(), rows).map(row => row.sessionId)).toEqual(['s-run', 's-9'])
  })

  it('follows the manual array exactly, and NEW sessions land at the TOP', () => {
    const task = { ...sampleTask(), sessionsOrder: ['s-9', 's-run'] }
    const withNew = [...rows, {
      sessionId: 's-new', title: 'c', display: { state: 'cancelled' as const, lastActivity: NOW + 9, waitingKind: undefined }, updatedAt: NOW + 9,
    }]
    expect(orderedSessionsOf(task, withNew).map(row => row.sessionId)).toEqual(['s-new', 's-9', 's-run'])
  })

  it('never hides a row — an order array without a row just leaves it fresh', () => {
    const task = { ...sampleTask(), sessionsOrder: ['s-run'] }
    expect(orderedSessionsOf(task, rows).map(row => row.sessionId)).toEqual(['s-9', 's-run'])
  })
})

describe('sessionWindowOf (the linked row derives the same start/end/duration grammar)', () => {
  it('derives the window from every round of the session (runs and external turns alike)', () => {
    let task = withOneRun() // e-1: startedAt NOW, endedAt NOW+1
    task = { ...task, executions: [...task.executions,
      newExternalRound({ id: 'x1', now: NOW + 10, sessionId: 's-1', text: '你好' }),
      { ...newExternalRound({ id: 'x2', now: NOW + 20, sessionId: 's-1' }), endedAt: NOW + 30, result: 'succeeded' as const },
    ] }
    expect(sessionWindowOf(task, 's-1')).toEqual({ startedAt: NOW, endedAt: NOW + 30, duration: 30 })
  })

  it('is empty for an unknown session and skips other sessions', () => {
    const task = withOneRun()
    expect(sessionWindowOf(task, 'nope')).toEqual({})
    expect(sessionWindowOf(task, 's-1')).toEqual({ startedAt: NOW, endedAt: NOW + 1, duration: 1 })
    expect(sessionWindowOf(task, undefined)).toEqual({})
  })
})

describe('linked rows read the SAME state derivation as run rows (no second dialect)', () => {
  /** A task with NO plain runs (so the bind forms the row) and optional rounds. */
  const bound = (executions: TaskRecord['executions'] = []): TaskRecord => ({
    ...sampleTask(),
    executions,
  })

  it('a settled round on THIS task decides the row outcome (no second dialect)', () => {
    // 开始/结束/耗时 beside the state chip: both read the rounds. The host
    // session row serves no outcome of its own, so the ledger IS the outcome.
    const task = bound([
      { id: 'c1', sessionId: 's-1', startedAt: NOW + 1, endedAt: NOW + 5, result: 'succeeded' as const, error: undefined, comment: '你好' },
    ])
    const rows = taskSessionsOf(task, ctx([linkedRow()]))
    expect(rows[0]?.display.state).toBe('succeeded')
    expect(rows[0]?.display.lastActivity).toBe(NOW + 5)
    // A failed observed turn reads failed — the honest outcome, not idle.
    const failedTask = bound([
      { id: 'x1', sessionId: 's-1', startedAt: NOW + 1, endedAt: NOW + 5, result: 'failed' as const, error: 'boom', comment: '', sessionAnchor: 's-1', external: true },
    ])
    expect(taskSessionsOf(failedTask, ctx([linkedRow()]))[0]?.display.state).toBe('failed')
  })

  it('open rounds and live activity outrank; a ledger-empty bind reads 未运行', () => {
    // An observed native turn in flight: external rounds are open from their
    // observation (they ARE the native turn, never a queue slot).
    const openTask = bound([
      { id: 'x1', sessionId: 's-1', startedAt: NOW + 1, endedAt: undefined, result: undefined, error: undefined, comment: '', sessionAnchor: 's-1', external: true },
    ])
    expect(taskSessionsOf(openTask, ctx([linkedRow()]))[0]?.display.state).toBe('running')
    // No rounds + still working (native turn observed elsewhere): running.
    const activeCtx = {
      ...ctx([linkedRow()]),
      sessionActiveOf: () => true,
    }
    expect(taskSessionsOf(bound(), activeCtx)[0]?.display.state).toBe('running')
    // No rounds and not working: nothing in the ledger to read — the idle row.
    expect(taskSessionsOf(bound(), ctx([linkedRow()]))[0]?.display.state).toBe('cancelled')
  })

  it('waiting outranks everything, same as the run rows', () => {
    // The waiting signal rides the LINKED ROW itself (the same face
    // taskSessionsOf has always read), not the context.
    const display = taskSessionsOf(bound(), ctx([linkedRow({ pendingInteraction: 'question' })]))[0]?.display
    expect(display).toMatchObject({ state: 'waiting', waitingKind: 'question' })
  })
})
