/**
 * Unified session-list tests: the single "会话" derivation — run + linked
 * merged by session id, run-wins dedupe, derived hide set, ordering.
 */
import { describe, expect, it } from 'vitest'
import { createTask, settleExecution, startExecution, type TaskRecord } from '../src/core/tasks.ts'
import { hasHiddenSessions, hiddenSessionIdsOf, taskSessionsOf } from '../src/core/session-list.ts'
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
    completed: true,
    updatedAt: NOW + 2,
    ...overrides,
  }
}

function ctx(linked: readonly LinkedSessionRow[] = []) {
  return {
    linked,
    titleOf: (id: string): string | undefined => id === 's-1' ? '原生标题' : undefined,
    pendingInteractionOf: () => undefined,
  }
}

describe('taskSessionsOf (统一会话列表)', () => {
  it('lists run sessions — one per session, latest run as the representative', () => {
    let task = withOneRun()
    // A second run reusing s-1 must not add a row, and the representative is
    // the latest one (runIndex 2).
    task = { ...task, executions: [...task.executions, {
      id: 'e-2', sessionId: 's-1', startedAt: NOW + 10, endedAt: NOW + 11, result: 'succeeded' as const, error: undefined,
    }] }
    const rows = taskSessionsOf(task, ctx())
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ sessionId: 's-1', executionId: 'e-2', runIndex: 2 })
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
})
