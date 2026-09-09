/**
 * Flow metrics (the smallest honest set): cycle-time distribution + weekly
 * throughput, derived ONLY from the column-move ledger (statusHistory —
 * without it every duration is a guess, so functions below return undefined
 * instead of inventing numbers from updatedAt).
 *
 * - Cycle time: first entry into `running` → first entry into `done` after
 *   it, elapsed calendar days (review counts: the human gate is waiting too,
 *   and waiting is the enemy — stated here once, never re-debated per call).
 * - Throughput: done tasks per week over the trailing 28 days (only tasks
 *   reaching done count — never execution rounds, never comments).
 * - Expression: distributions, never means (p85 answers "when will it be
 *   done", a mean answers nothing). Framework-free, unit-tested in isolation.
 */
import type { TaskRecord } from './tasks.ts'

/** Trailing window for throughput (28 days = 4 weeks). */
export const THROUGHPUT_WINDOW_MS = 28 * 86_400_000

/** Elapsed cycle days for one task (first running → first done after it),
 *  or undefined when the trip is incomplete or unrecorded (legacy rows). */
export function cycleDaysOf(task: Pick<TaskRecord, 'statusHistory'>): number | undefined {
  const history = task.statusHistory
  if (history === undefined) return undefined
  const start = history.find(entry => entry.status === 'running')
  if (start === undefined) return undefined
  const end = history.find(entry => entry.status === 'done' && entry.at >= start.at)
  if (end === undefined) return undefined
  return Math.max(0, (end.at - start.at) / 86_400_000)
}

/** The p-th percentile of an ascending-sorted sample (nearest-rank);
 *  undefined on empty input (no sample, no number — never zero-fill). */
export function percentileOf(sorted: readonly number[], p: number): number | undefined {
  if (sorted.length === 0) return undefined
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[rank]
}

/** Done task count per week over the trailing window (done instants read
 *  from the ledger: the last `done` entry of each task now in done). */
export function throughputPerWeek(
  tasks: readonly Pick<TaskRecord, 'status' | 'statusHistory'>[],
  now: number = Date.now(),
): number {
  const floor = now - THROUGHPUT_WINDOW_MS
  let count = 0
  for (const task of tasks) {
    if (task.status !== 'done') continue
    const history = task.statusHistory
    if (history === undefined) continue
    const doneAt = history.filter(entry => entry.status === 'done').map(entry => entry.at).pop()
    if (doneAt !== undefined && doneAt >= floor) count++
  }
  return count / 4
}

/** The board's flow summary: samples (measurable cycles), the p85 cycle in
 *  days, and weekly throughput. Zero samples = no sentence (the status line
 *  stays quiet until real history exists — never a pseudo-number). */
export function flowSummaryOf(
  tasks: readonly Pick<TaskRecord, 'status' | 'statusHistory'>[],
  now: number = Date.now(),
): { samples: number; p85Days?: number; perWeek: number } {
  const cycles = tasks
    .map(task => ({ task, days: cycleDaysOf(task) }))
    .filter((entry): entry is { task: Pick<TaskRecord, 'status' | 'statusHistory'>; days: number } =>
      entry.days !== undefined)
    .map(entry => entry.days)
    .sort((a, b) => a - b)
  const p85 = percentileOf(cycles, 85)
  return {
    samples: cycles.length,
    ...(p85 !== undefined ? { p85Days: p85 } : {}),
    perWeek: throughputPerWeek(tasks, now),
  }
}
