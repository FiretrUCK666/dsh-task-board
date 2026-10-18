/**
 * The workbench's numbers: one contract for the bar's badges and the overview.
 *
 * WHY THIS IS ITS OWN FILE. The bar and the overview both print these numbers,
 * and the failure mode when they disagree is silent — a badge saying 3 above a
 * tile saying 2 looks like a rounding thing, so nobody files it. Every case
 * below pins ONE number to ONE input, so a change that makes the two surfaces
 * drift makes exactly one of them red.
 *
 * The two calibers worth reading twice are here on purpose:
 *   - 「最旧多久没动」 reads the card's own progress stamp, never `updatedAt`
 *     (that one is redrawn on every reorder, which would make a busy column
 *     claim every card moved today).
 *   - a finished checklist row is never `overdue`, however its dates read —
 *     the list hides it from the day agenda, and a count that disagreed would
 *     send the reader to a row they cannot find.
 */
import { describe, expect, it } from 'vitest'
import type { ItemRecord } from '../src/core/item.ts'
import { createTask, type TaskRecord } from '../src/core/tasks.ts'
import {
  PIPELINE_ORDER,
  cardProgressAtOf,
  weeklyCompletionsOf,
  workbenchCountsOf,
  workbenchSummaryOf,
} from '../src/core/workbench-summary.ts'

const DAY = 86_400_000
const T0 = new Date('2026-10-18T09:00:00+08:00').getTime()

/** One card, with only what a case cares about overridden. */
function task(patch: Partial<TaskRecord> = {}): TaskRecord {
  const base = createTask({ title: 'A card', description: '', prompt: '' }, T0, 't-1')
  return { ...base, ...patch }
}

/** One checklist row, with only what a case cares about overridden. */
function item(patch: Partial<ItemRecord> = {}): ItemRecord {
  return {
    id: 'i-1',
    ref: 12,
    title: 'A row',
    body: '',
    attachments: [],
    notes: '',
    steps: [],
    status: 'todo',
    priority: 'normal',
    tags: [],
    startsAfter: undefined,
    dueAt: undefined,
    hardDueAt: undefined,
    taskId: undefined,
    origin: { source: 'human', at: T0 },
    createdAt: T0,
    updatedAt: T0,
    ...patch,
  }
}

const NO_DEMAND = { total: 0, waiting: 0, review: 0 }

describe('PIPELINE_ORDER', () => {
  it('is the five columns in reading order', () => {
    expect(PIPELINE_ORDER).toEqual(['backlog', 'todo', 'running', 'review', 'done'])
  })
})

describe('workbenchCountsOf', () => {
  it('takes 等你处理 / 待审核 from the demand it was handed, not from a second count', () => {
    const counts = workbenchCountsOf([], [], { total: 5, waiting: 2, review: 3 }, T0)
    expect(counts.demand).toBe(5)
    expect(counts.review).toBe(3)
  })

  it('counts 进行中 by column', () => {
    const counts = workbenchCountsOf([
      task({ id: 'a', status: 'running' }),
      task({ id: 'b', status: 'running' }),
      task({ id: 'c', status: 'review' }),
    ], [], NO_DEMAND, T0)
    expect(counts.running).toBe(2)
  })

  it('counts an open row whose deadline passed, and nothing else', () => {
    const counts = workbenchCountsOf([], [
      item({ id: 'late', hardDueAt: T0 - 2 * DAY }),
      item({ id: 'late-plan', dueAt: T0 - 2 * DAY }),
      item({ id: 'ahead', hardDueAt: T0 + 2 * DAY }),
      item({ id: 'none' }),
    ], NO_DEMAND, T0)
    expect(counts.overdue).toBe(2)
  })

  it('never calls a finished row late', () => {
    const counts = workbenchCountsOf([], [
      item({ id: 'done', status: 'done', hardDueAt: T0 - 9 * DAY }),
    ], NO_DEMAND, T0)
    expect(counts.overdue).toBe(0)
  })

  it('counts today separately from late', () => {
    const counts = workbenchCountsOf([], [
      item({ id: 'today', dueAt: T0 + 3 * 3_600_000 }),
    ], NO_DEMAND, T0)
    expect(counts.dueToday).toBe(1)
    expect(counts.overdue).toBe(0)
  })
})

describe('cardProgressAtOf', () => {
  it('prefers the card own progress over the sync stamp', () => {
    const card = task({
      updatedAt: T0,
      statusHistory: [
        { status: 'todo', at: T0 - 3 * DAY },
        { status: 'running', at: T0 - 6 * 3_600_000 },
      ],
    })
    expect(cardProgressAtOf(card)).toBe(T0 - 6 * 3_600_000)
  })

  it('falls back to updatedAt when no ledger exists', () => {
    const card = task({ updatedAt: T0 - DAY, statusHistory: undefined as never })
    expect(cardProgressAtOf(card)).toBe(T0 - DAY)
  })
})

describe('weeklyCompletionsOf', () => {
  it('puts each completion in its own trailing week, oldest first', () => {
    const done = (id: string, at: number): TaskRecord => task({
      id,
      status: 'done',
      statusHistory: [{ status: 'done', at }],
    })
    const weeks = weeklyCompletionsOf([
      done('a', T0 - 1 * DAY),
      done('b', T0 - 8 * DAY),
      done('c', T0 - 15 * DAY),
      done('d', T0 - 22 * DAY),
    ], T0, 4)
    expect(weeks).toEqual([1, 1, 1, 1])
  })

  it('counts a reworked card once, by its last completion', () => {
    const card = task({
      id: 'rework',
      status: 'done',
      statusHistory: [
        { status: 'done', at: T0 - 9 * DAY },
        { status: 'running', at: T0 - 8 * DAY },
        { status: 'done', at: T0 - 1 * DAY },
      ],
    })
    expect(weeklyCompletionsOf([card], T0, 4)).toEqual([0, 0, 0, 1])
  })

  it('ignores instants in the future (clock skew is data dirt, not throughput)', () => {
    const card = task({ status: 'done', statusHistory: [{ status: 'done', at: T0 + DAY }] })
    expect(weeklyCompletionsOf([card], T0, 4)).toEqual([0, 0, 0, 0])
  })
})

describe('workbenchSummaryOf', () => {
  it('leaves an empty column without a staleness reading (no 0-day claim)', () => {
    const summary = workbenchSummaryOf([], [], NO_DEMAND, T0)
    for (const row of summary.pipeline) {
      expect(row.count).toBe(0)
      expect('staleDays' in row).toBe(false)
    }
  })

  it('measures staleness from the card own progress, not the sync stamp', () => {
    // The card was re-persisted a minute ago (updatedAt = now) but has not
    // actually moved for six days.
    const card = task({
      status: 'todo',
      updatedAt: T0,
      statusHistory: [{ status: 'todo', at: T0 - 6 * DAY }],
    })
    const summary = workbenchSummaryOf([card], [], NO_DEMAND, T0)
    const todo = summary.pipeline.find(row => row.status === 'todo')
    expect(todo?.staleDays).toBe(6)
  })

  it('reports the oldest card in the column, not the newest', () => {
    const summary = workbenchSummaryOf([
      task({ id: 'new', status: 'todo', statusHistory: [{ status: 'todo', at: T0 - DAY }] }),
      task({ id: 'old', status: 'todo', statusHistory: [{ status: 'todo', at: T0 - 9 * DAY }] }),
    ], [], NO_DEMAND, T0)
    expect(summary.pipeline.find(row => row.status === 'todo')?.staleDays).toBe(9)
  })

  it('lists recent cards newest first and never more than six', () => {
    const cards = Array.from({ length: 8 }, (_, index) => task({
      id: `t-${index}`,
      title: `card ${index}`,
      statusHistory: [{ status: 'todo', at: T0 - index * DAY }],
    }))
    const summary = workbenchSummaryOf(cards, [], NO_DEMAND, T0)
    expect(summary.recent).toHaveLength(6)
    expect(summary.recent.map(row => row.id)).toEqual(['t-0', 't-1', 't-2', 't-3', 't-4', 't-5'])
  })

  it('does not invent a cycle time when no trip has completed', () => {
    const summary = workbenchSummaryOf([task({ status: 'todo' })], [], NO_DEMAND, T0)
    expect(summary.flow.samples).toBe(0)
    expect(summary.flow.p85Days).toBeUndefined()
  })

  it('reports a cycle once a running -> done trip exists', () => {
    const card = task({
      status: 'done',
      statusHistory: [
        { status: 'running', at: T0 - 4 * DAY },
        { status: 'done', at: T0 - 2 * DAY },
      ],
    })
    const summary = workbenchSummaryOf([card], [], NO_DEMAND, T0)
    expect(summary.flow.samples).toBe(1)
    expect(summary.flow.p85Days).toBe(2)
  })
})
