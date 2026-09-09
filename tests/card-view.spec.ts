/**
 * Card view-model (client/board/card-view.ts): single prioritized summary —
 * waiting > running > refining > queued > failed > review > idle.
 */
import { describe, expect, it } from 'vitest'
import { cardNextActionOf, cardViewModelOf, dueStateOf } from '../src/client/board/card-view.ts'
import { createTask, newCommentRound, startExecution } from '../src/core/tasks.ts'

const NOW = 1_700_000_000_000

function task() {
  return createTask({ title: 't', description: '', prompt: 'p' }, NOW, 'task-1')
}

describe('cardViewModelOf', () => {
  it('idle task with nothing scheduled has no emphasis', () => {
    const view = cardViewModelOf(task())
    expect(view.primary).toEqual({ kind: 'idle' })
    expect(view.active).toBe(false)
    expect(cardNextActionOf(view, task())).toBeUndefined()
  })

  it('waiting outranks running', () => {
    const started = startExecution(task(), NOW, 'e1')
    const view = cardViewModelOf(started.task, { live: 'running', waiting: 'question', pendingCount: 1 })
    expect(view.primary).toEqual({ kind: 'waiting', waiting: 'question' })
    expect(view.active).toBe(true)
  })

  it('queued comments surface with their count', () => {
    const base = task()
    const round = newCommentRound({ id: 'c1', now: NOW, text: 'hi', sessionId: 's-1', parentExecutionId: 'e-1' })
    const view = cardViewModelOf({ ...base, executions: [round] }, {})
    expect(view.primary).toEqual({ kind: 'queued', count: 1 })
    expect(cardNextActionOf(view, base)).toEqual({ kind: 'queued', count: 1 })
  })

  it('dots cap at 3 with overflow counted', () => {
    const view = cardViewModelOf(task(), {
      sessionIds: ['a', 'b', 'c', 'd'],
      sessionStateOf: () => 'idle',
    })
    expect(view.dots).toHaveLength(3)
    expect(view.overflowDots).toBe(1)
  })
})

describe('dueStateOf (day-granularity, incomplete columns only)', () => {
  // Fixed "now": 2025-01-05 14:23 local.
  const now = new Date(2025, 0, 5, 14, 23, 0).getTime()
  const day = (y: number, m: number, d: number): number => new Date(y, m, d).getTime()

  it('reads absent due as undefined', () => {
    expect(dueStateOf({ ...task(), dueAt: undefined }, now)).toBeUndefined()
  })

  it('reads today and past days on incomplete columns', () => {
    const base = { ...task(), status: 'todo' as const }
    expect(dueStateOf({ ...base, dueAt: day(2025, 0, 5) }, now)).toBe('today')
    expect(dueStateOf({ ...base, dueAt: day(2025, 0, 4) }, now)).toBe('overdue')
    expect(dueStateOf({ ...base, status: 'running', dueAt: day(2025, 0, 1) }, now)).toBe('overdue')
    expect(dueStateOf({ ...base, status: 'backlog', dueAt: day(2025, 0, 4) }, now)).toBe('overdue')
  })

  it('future dues and closed columns stay quiet', () => {
    const base = { ...task(), status: 'todo' as const }
    expect(dueStateOf({ ...base, dueAt: day(2025, 0, 8) }, now)).toBeUndefined()
    expect(dueStateOf({ ...base, status: 'review', dueAt: day(2025, 0, 1) }, now)).toBeUndefined()
    expect(dueStateOf({ ...base, status: 'done', dueAt: day(2025, 0, 1) }, now)).toBeUndefined()
  })
})
