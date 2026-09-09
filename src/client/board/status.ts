/**
 * Shared status copy: one mapping from task status to its locale key, used
 * by the board columns and the task detail badge so both surfaces can never
 * drift apart.
 */
import type { TaskStatus } from '../../core/tasks.ts'
import type { WipLimits } from '../../core/board-doc.ts'
import { isWipOver } from '../../core/board-doc.ts'
import type { TaskBoardKey } from '../locales.ts'

/** Status → locale key. */
export const STATUS_KEY: Record<TaskStatus, TaskBoardKey> = {
  backlog: 'board.status.backlog',
  todo: 'board.status.todo',
  running: 'board.status.running',
  review: 'board.status.review',
  done: 'board.status.done',
}

/**
 * Status → SHORT locale key, read by the compact column navigator. Five equal
 * cells on a phone leave roughly one-and-a-half Chinese characters per label,
 * so the full names all collapse to 「待…」「进…」「已…」 and the navigator
 * stops naming anything at all. The short forms are ordinary locale data (never
 * a hardcoded string, never a truncation rule), and the full name stays on the
 * tab as its accessible name.
 */
export const STATUS_SHORT_KEY: Record<TaskStatus, TaskBoardKey> = {
  backlog: 'board.statusShort.backlog',
  todo: 'board.statusShort.todo',
  running: 'board.statusShort.running',
  review: 'board.statusShort.review',
  done: 'board.statusShort.done',
}

/** Status → pull-policy hint (one sentence per column: what may enter, what
 *  it means to sit here). Read by the column header tooltip (desktop
 *  redundancy) AND the cheatsheet rows (the touch-reachable home — tappable,
 *  searchable, never hover-only). Supplementary orientation, never the sole
 *  carrier of anything actionable. */
export const COLUMN_HINT_KEY: Record<TaskStatus, TaskBoardKey> = {
  backlog: 'board.columnHint.backlog',
  todo: 'board.columnHint.todo',
  running: 'board.columnHint.running',
  review: 'board.columnHint.review',
  done: 'board.columnHint.done',
}

/**
 * Paused-rule explanation keyed by the pausing status: ONE map read by both
 * automation surfaces (the detail editor and the overview row derive the same
 * readiness reason, so the reason copy can never drift).
 */
export const PAUSED_REASON_KEY: Record<'backlog' | 'review' | 'done', TaskBoardKey> = {
  backlog: 'detail.schedule.paused.backlog',
  review: 'detail.schedule.paused.review',
  done: 'detail.schedule.paused.done',
}

/** Full-ledger WIP counts: running cards vs. cards in play (running+review).
 *  THE one computation — the status line, the compact tabs and the column
 *  headers all read one memoized value, so the three can never disagree on
 *  denominators (filtered views never enter here). */
export interface WipCounts {
  running: number
  inPlay: number
}

/** Count one WIP ledger pass over task statuses (single loop, no filters). */
export function wipCountsOf(statuses: readonly TaskStatus[]): WipCounts {
  let running = 0
  let inPlay = 0
  for (const status of statuses) {
    if (status === 'running') {
      running += 1
      inPlay += 1
    } else if (status === 'review') {
      inPlay += 1
    }
  }
  return { running, inPlay }
}

/** Which WIP sentence (if any) the board owes: running wins over global (ONE
 *  sentence discipline). Returns the locale key + params, never text, so the
 *  core stays copy-free and every caller renders through the same `t`.
 *  Masking the `wip` argument scopes the question per column (running-only /
 *  global-only) without a second function. */
export function wipSentenceKeyOf(
  counts: WipCounts,
  wip: WipLimits | undefined,
): { key: TaskBoardKey; params: { n: string; limit: string } } | undefined {
  if (wip?.running !== undefined && isWipOver(counts.running, wip.running)) {
    return { key: 'board.wipRunningOver', params: { n: String(counts.running), limit: String(wip.running) } }
  }
  if (wip?.global !== undefined && isWipOver(counts.inPlay, wip.global)) {
    return { key: 'board.wipOver', params: { n: String(counts.inPlay), limit: String(wip.global) } }
  }
  return undefined
}
