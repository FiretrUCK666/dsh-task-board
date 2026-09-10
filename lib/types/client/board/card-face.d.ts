/**
 * Card face: the one display projection of a task card — every card (a bound
 * session/workspace task and a plain created task alike) renders the SAME
 * shape, derived from the same run/comment records, so the two kinds can
 * never drift apart. Fields: the latest plain run's window (start/end/
 * duration), the comment count + latest content (text or the state word),
 * and the remaining-time slot (next scheduled run, or the running task's
 * elapsed). Pure and framework-free, so the projection unit-tests.
 */
import type { TaskRecord } from '../../core/tasks.ts';
import { type LatestCommentView } from './comment-thread.ts';
/** The card's display face (all fields optional — a card shows what it has). */
export interface CardFace {
    /** Whether the card is running right now (the live indicator source). */
    running: boolean;
    /** The latest plain run's window (start/end/duration), or undefined. */
    startedAt?: number;
    endedAt?: number;
    duration?: number;
    /** The comment thread of the run's session (or the bound session when the
     *  task has no board run yet): count + the newest round's summary. */
    commentCount: number;
    latest?: LatestCommentView;
    /** The next scheduled run instant (armed cron rules), or undefined. */
    nextRunAt?: number;
    /** Running task's elapsed milliseconds. */
    elapsed?: number;
}
/** Derive the card face of a task (see module doc; `now` is the clock). */
export declare function cardFaceOf(task: TaskRecord, now: number): CardFace;
