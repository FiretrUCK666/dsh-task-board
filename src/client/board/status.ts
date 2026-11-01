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
 * The ONE place where 「移到已完成」 is the wrong verb for what the button does.
 *
 * A card in 审核 carries a chip that says 待你确认完成 — the board is telling the
 * reader "this is the decision I am waiting for". Opening it and finding a
 * button called 「移到已完成」 asks the reader to work out that the confirm they
 * were promised is spelled as a column move. Same action, different word: when
 * the source column IS review, the move to done IS the confirmation, so it says
 * so. Every other source keeps the plain column verb, because there the move is
 * a move.
 */
export function statusMoveKeyOf(from: TaskStatus, to: ManualStatus): TaskBoardKey {
  if (from === 'review' && to === 'done') return 'status.move.confirm'
  return STATUS_MOVE_KEY[to]
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
