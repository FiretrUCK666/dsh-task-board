/**
 * Flow metrics (core/flow-metrics.ts): cycle days from the column-move
 * ledger, nearest-rank percentiles, trailing-28d throughput, and the
 * samples-gated summary. No ledger, no numbers — never a pseudo-metric.
 */
import { describe, expect, it } from 'vitest'
import {
  cycleDaysOf,
  flowSummaryOf,
  percentileOf,
  throughputPerWeek,
  THROUGHPUT_WINDOW_MS,
} from '../src/core/flow-metrics.ts'

const DAY = 86_400_000
const NOW = 1_700_000_000_000

function history(...entries: Array<[string, number]>) {
  return entries.map(([status, at]) => ({ status: status as 'todo' | 'running' | 'done', at }))
}

describe('cycleDaysOf (first running → first done after it)', () => {
  it('measures elapsed calendar days, review included', () => {
    expect(cycleDaysOf({ statusHistory: history(['todo', NOW], ['running', NOW], ['review', NOW + 2 * DAY], ['done', NOW + 5 * DAY]) })).toBe(5)
  })

  it('returns undefined for incomplete or unrecorded trips', () => {
    expect(cycleDaysOf({ statusHistory: history(['todo', NOW], ['running', NOW]) })).toBeUndefined()
    expect(cycleDaysOf({ statusHistory: history(['todo', NOW], ['done', NOW + DAY]) })).toBeUndefined()
    expect(cycleDaysOf({})).toBeUndefined()
  })

  it('treats future instants as dirt (same law as throughput)', () => {
    expect(cycleDaysOf(
      { statusHistory: history(['running', NOW - 7 * DAY], ['done', NOW + DAY]) },
      NOW,
    )).toBeUndefined()
    expect(cycleDaysOf(
      { statusHistory: history(['running', NOW + DAY], ['done', NOW + 2 * DAY]) },
      NOW,
    )).toBeUndefined()
  })

  it('skips a future tombstone mid-array (filter-then-find, like throughput)', () => {
    expect(cycleDaysOf(
      {
        statusHistory: history(
          ['running', NOW - 20 * DAY],
          ['done', NOW + DAY],
          ['done', NOW - 6 * DAY],
        ),
      },
      NOW,
    )).toBe(14)
  })
})

describe('percentileOf (nearest-rank, never zero-filled)', () => {
  it('picks the rank and guards empties', () => {
    expect(percentileOf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 85)).toBe(9)
    expect(percentileOf([4], 85)).toBe(4)
    expect(percentileOf([], 85)).toBeUndefined()
  })
})

describe('throughputPerWeek (done tasks, trailing 28d)', () => {
  it('counts done tasks in the window only (never rounds or comments)', () => {
    const tasks = [
      { status: 'done' as const, statusHistory: history(['running', NOW - 7 * DAY], ['done', NOW - 7 * DAY]) },
      { status: 'done' as const, statusHistory: history(['running', NOW - 40 * DAY], ['done', NOW - 40 * DAY]) },
      { status: 'todo' as const, statusHistory: history(['todo', NOW]) },
    ]
    expect(throughputPerWeek(tasks, NOW)).toBe(0.25)
    expect(THROUGHPUT_WINDOW_MS).toBe(28 * DAY)
  })

  it('keeps a completion earned before a revival (columns aggregate, history records)', () => {
    const tasks = [
      { status: 'todo' as const, statusHistory: history(['running', NOW - 7 * DAY], ['done', NOW - 7 * DAY], ['todo', NOW - DAY]) },
    ]
    expect(throughputPerWeek(tasks, NOW)).toBe(0.25)
  })

  it('ignores future completions (clock skew is dirt, not throughput)', () => {
    const tasks = [
      { status: 'done' as const, statusHistory: history(['running', NOW - 7 * DAY], ['done', NOW + DAY]) },
    ]
    expect(throughputPerWeek(tasks, NOW)).toBe(0)
  })

  it('a future tombstone never erases the real completions', () => {
    const tasks = [
      { status: 'done' as const, statusHistory: history(['running', NOW - 20 * DAY], ['done', NOW - 6 * DAY], ['done', NOW + DAY]) },
    ]
    expect(throughputPerWeek(tasks, NOW)).toBe(0.25)
  })

  it('counts a twice-completed task once (task caliber, last completion wins)', () => {
    const tasks = [
      { status: 'done' as const, statusHistory: history(['running', NOW - 20 * DAY], ['done', NOW - 20 * DAY], ['running', NOW - 6 * DAY], ['done', NOW - 6 * DAY]) },
    ]
    expect(throughputPerWeek(tasks, NOW)).toBe(0.25)
  })
})

describe('flowSummaryOf (samples-gated)', () => {
  it('stays quiet without samples', () => {
    expect(flowSummaryOf([], NOW)).toEqual({ samples: 0, perWeek: 0 })
  })

  it('reports p85 + throughput once history exists', () => {
    const tasks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(days => ({
      status: 'done' as const,
      statusHistory: history(['running', NOW - 20 * DAY], ['done', NOW - 20 * DAY + days * DAY]),
    }))
    const summary = flowSummaryOf(tasks, NOW)
    expect(summary.samples).toBe(10)
    expect(summary.p85Days).toBe(9)
    expect(summary.perWeek).toBe(2.5)
  })
})
