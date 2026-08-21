/**
 * Card face: the one display projection of a task card — every card (a bound
 * session/workspace task and a plain created task alike) renders the SAME
 * shape, derived from the same run/comment records, so the two kinds can
 * never drift apart. Fields: the latest plain run's window (start/end/
 * duration), the comment count + latest content (text or the state word),
 * and the remaining-time slot (next scheduled run, or the running task's
 * elapsed). Pure and framework-free, so the projection unit-tests.
 */
import type { TaskRecord } from '../../core/tasks.ts'
import { hasOpenRun, plainRunsOf } from '../../core/tasks.ts'
import { latestCommentView, sessionCommentsOf, type LatestCommentView } from './comment-thread.ts'

/** The card's display face (all fields optional — a card shows what it has). */
export interface CardFace {
  /** Whether the card is running right now (the live indicator source). */
  running: boolean
  /** The latest plain run's window (start/end/duration), or undefined. */
  startedAt?: number
  endedAt?: number
  duration?: number
  /** The comment thread of the run's session (or the bound session when the
   *  task has no board run yet): count + the newest round's summary. */
  commentCount: number
  latest?: LatestCommentView
  /** The next scheduled run instant (armed cron rules), or undefined. */
  nextRunAt?: number
  /** Running task's elapsed milliseconds. */
  elapsed?: number
}

/** Derive the card face of a task (see module doc; `now` is the clock). */
export function cardFaceOf(task: TaskRecord, now: number): CardFace {
  const running = hasOpenRun(task)
  const faces: CardFace = { running, commentCount: 0 }
  const runs = plainRunsOf(task)
  const lastRun = runs[runs.length - 1]
  // The thread belongs to the newest round's session (any kind — a comment
  // round, a direct send, an observed external turn, or a plain run), falling
  // back to the bound session for a task that never had a round yet.
  let sessionId: string | undefined
  for (let index = task.executions.length - 1; index >= 0; index -= 1) {
    const round = task.executions[index]
    if (round.sessionId !== undefined) {
      sessionId = round.sessionId
      break
    }
  }
  sessionId = sessionId ?? (task.bind?.kind === 'session' ? task.bind.sessionId : undefined)
  if (sessionId !== undefined) {
    const comments = sessionCommentsOf(task, sessionId, true)
    faces.commentCount = comments.length
    faces.latest = latestCommentView(task, sessionId, true)
  }
  if (lastRun !== undefined) {
    faces.startedAt = lastRun.startedAt
    faces.endedAt = lastRun.endedAt
    faces.duration = lastRun.endedAt !== undefined && lastRun.endedAt >= lastRun.startedAt
      ? lastRun.endedAt - lastRun.startedAt
      : undefined
  }
  const schedule = task.schedule
  if (schedule !== undefined && schedule.enabled && schedule.mode === 'cron' && schedule.nextRunAt !== undefined) {
    faces.nextRunAt = schedule.nextRunAt
  }
  if (running && lastRun !== undefined) {
    faces.elapsed = Math.max(0, now - lastRun.startedAt)
  }
  return faces
}
