/**
 * The workbench's numbers: one pure function for the whole overview.
 *
 * WHY THIS IS CORE AND NOT A PANEL. The bar's badges and the overview's tiles
 * are the SAME four numbers looked at from two places. Computing them once, in
 * core, is what makes them agree; computing them in the panel is what makes the
 * badge say 3 while the tile says 2 on the day one of them gains a filter.
 *
 * WHAT IT DOES NOT DO. It does not invent numbers. Every field is either
 * derived from the two documents or absent:
 *
 *   - `demand` / `review` come from `boardDemandOf`, the SAME function the
 *     board header and the notification drawer read, so the three surfaces
 *     cannot disagree by construction.
 *   - `overdue` / `dueToday` come from `datePostureOf`, the same verdict the
 *     list row prints under its title.
 *   - `p85Days` is absent until real completions exist (see `flow-metrics.ts`),
 *     and the overview renders the absence as words, never as 0.
 *
 * The stale column is measured from the card's own progress stamp, which is what
 * the board already prints as 「更新于」 — not from the sync stamp (that one is
 * redrawn on every reorder, and would make every column say "just now").
 */
import type { ItemRecord } from './item.ts'
import { datePostureOf } from './item-dates.ts'
import { flowSummaryOf } from './flow-metrics.ts'
import type { BoardDemand } from './task-demand.ts'
import type { TaskRecord, TaskStatus } from './tasks.ts'

/** The five columns, in reading order. Declared here so callers never re-list them. */
export const PIPELINE_ORDER: readonly TaskStatus[] = ['backlog', 'todo', 'running', 'review', 'done']

/** The four numbers the workbench reports. */
export interface WorkbenchCounts {
  /** Cards plus conversations waiting on a human (`boardDemandOf().total`). */
  readonly demand: number
  /** Cards whose finished work nobody has looked at yet. */
  readonly review: number
  /** Cards whose column is 进行中. */
  readonly running: number
  /** Open checklist rows whose hard deadline (or plan date) has passed. */
  readonly overdue: number
  /** Open checklist rows due today. */
  readonly dueToday: number
}

/** One column of the overview's pipeline: how much is in it, and how long the oldest thing has sat. */
export interface PipelineRow {
  readonly status: TaskStatus
  readonly count: number
  /**
   * Whole days since the oldest card in this column last moved. `undefined` for
   * an empty column (an empty column has no oldest thing — a 0 would claim
   * "moved today").
   */
  readonly staleDays?: number
}

/** One recently-touched card, for the overview's activity list. */
export interface RecentCard {
  readonly id: string
  readonly title: string
  readonly status: TaskStatus
  /** The card's own progress stamp, i.e. what the board prints as 「更新于」. */
  readonly at: number
}

/** Everything the overview renders, computed in one pass. */
export interface WorkbenchSummary {
  readonly counts: WorkbenchCounts
  readonly pipeline: readonly PipelineRow[]
  readonly recent: readonly RecentCard[]
  /** p85 cycle days + trailing weekly throughput, from `flow-metrics.ts`. */
  readonly flow: { readonly samples: number; readonly p85Days?: number; readonly perWeek: number }
  /** Completions per week for the trailing four weeks, oldest first. */
  readonly weeks: readonly number[]
}

/**
 * The card's own progress stamp — the same value the board prints.
 *
 * `task.updatedAt` is NOT it: that one is redrawn whenever a card is reordered
 * or re-persisted, so a busy column would report every card as "just now" and
 * erase the only signal the column has. The ledger is the card's own account of
 * when work actually moved, and once it exists it is the ONLY source — taking
 * the larger of the two would put the sync stamp back in charge exactly when it
 * is freshest, which is the case this function exists to exclude.
 * @param task - the card.
 * @returns the epoch ms of the card's last real movement.
 */
export function cardProgressAtOf(task: Pick<TaskRecord, 'updatedAt' | 'statusHistory'>): number {
  const history = task.statusHistory
  if (history === undefined || history.length === 0) return task.updatedAt
  let latest = history[0].at
  for (const entry of history) if (entry.at > latest) latest = entry.at
  return latest
}

/**
 * Count the workbench numbers.
 *
 * `demand` is PASSED IN rather than computed here: the two halves of it (a
 * suspended conversation, and a card whose work nobody has looked at) are read
 * through the controller, and a core module that reached for the controller
 * would stop being a pure function of two documents.
 * @param tasks - the board's cards.
 * @param items - the checklist's rows (may be empty when the list is switched off).
 * @param demand - `boardDemandOf`'s answer, from whoever holds the controller.
 * @param now - epoch ms; injected so the reading is reproducible in tests.
 * @returns the counts.
 */
export function workbenchCountsOf(
  tasks: readonly TaskRecord[],
  items: readonly ItemRecord[],
  demand: BoardDemand,
  now: number = Date.now(),
): WorkbenchCounts {
  let running = 0
  for (const task of tasks) if (task.status === 'running') running += 1
  let overdue = 0
  let dueToday = 0
  for (const item of items) {
    // A finished row is not late, whatever its dates say. The list hides it the
    // same way (done rows leave the day agenda), and a count that disagreed with
    // the list would send the reader to a row they cannot find.
    if (item.status === 'done') continue
    const posture = datePostureOf(item, now)
    if (posture.kind === 'hardOverdue' || posture.kind === 'behind') overdue += 1
    else if (posture.kind === 'dueToday') dueToday += 1
  }
  return { demand: demand.total, review: demand.review, running, overdue, dueToday }
}

/**
 * Completions per calendar week for the trailing `weeks` weeks, oldest first.
 *
 * The atom is the completion EVENT (a `done` entry in the ledger) counted once
 * per card per week — the same caliber `throughputPerWeek` uses, so the bars and
 * the number above them can never tell two stories.
 * @param tasks - the board's cards.
 * @param now - epoch ms.
 * @param weeks - how many buckets to produce.
 * @returns one count per bucket, oldest first.
 */
export function weeklyCompletionsOf(
  tasks: readonly TaskRecord[],
  now: number,
  weeks = 4,
): number[] {
  const buckets = new Array<number>(Math.max(1, weeks)).fill(0)
  const span = 7 * 86_400_000
  for (const task of tasks) {
    const history = task.statusHistory
    if (history === undefined) continue
    // The last EFFECTIVE completion, exactly as throughput counts it.
    let doneAt: number | undefined
    for (const entry of history) {
      if (entry.status === 'done' && entry.at <= now) doneAt = entry.at
    }
    if (doneAt === undefined) continue
    const back = Math.floor((now - doneAt) / span)
    if (back >= 0 && back < buckets.length) buckets[buckets.length - 1 - back] += 1
  }
  return buckets
}

/**
 * Build the overview's whole view model.
 * @param tasks - the board's cards.
 * @param items - the checklist's rows.
 * @param demand - `boardDemandOf`'s answer, from whoever holds the controller.
 * @param now - epoch ms.
 * @returns the summary.
 */
export function workbenchSummaryOf(
  tasks: readonly TaskRecord[],
  items: readonly ItemRecord[],
  demand: BoardDemand,
  now: number = Date.now(),
): WorkbenchSummary {
  const pipeline: PipelineRow[] = PIPELINE_ORDER.map(status => {
    const column = tasks.filter(task => task.status === status)
    if (column.length === 0) return { status, count: 0 }
    let oldest = now
    for (const task of column) {
      const at = cardProgressAtOf(task)
      if (at < oldest) oldest = at
    }
    const staleDays = Math.max(0, Math.floor((now - oldest) / 86_400_000))
    return { status, count: column.length, staleDays }
  })
  const recent: RecentCard[] = [...tasks]
    .sort((a, b) => cardProgressAtOf(b) - cardProgressAtOf(a))
    .slice(0, 6)
    .map(task => ({
      id: task.id,
      title: task.title === '' ? '—' : task.title,
      status: task.status,
      at: cardProgressAtOf(task),
    }))
  const flow = flowSummaryOf(tasks, now)
  return {
    counts: workbenchCountsOf(tasks, items, demand, now),
    pipeline,
    recent,
    flow,
    weeks: weeklyCompletionsOf(tasks, now, 4),
  }
}
