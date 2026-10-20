/**
 * Shared status copy: one mapping from task status to its locale key, used
 * by the board columns and the task detail badge so both surfaces can never
 * drift apart.
 */
import type { ManualStatus, TaskStatus } from '../../core/tasks.ts'
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
 * Manual status → the locale key of its "move here" button. The table is
 * EXHAUSTIVE BY TYPE: a manual status without a key fails the build here
 * instead of painting a blank button on the screen — and the keys are named in
 * one place, so a renamed key has exactly one home.
 */
export const STATUS_MOVE_KEY = {
  backlog: 'status.move.backlog',
  todo: 'status.move.todo',
  done: 'status.move.done',
} as const satisfies Readonly<Record<ManualStatus, TaskBoardKey>>

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

/* No per-column hint sentences here. One pull-policy sentence per column
   (「进行中：一次只做少量，完工才拉新」…) is explanation layered onto a surface the
   user reads by scanning: the board states what a column IS through its name, its
   count and the cards in it. Such a sentence needs a visible home, not a `title`
   on the column heading or the empty-column line. */

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
