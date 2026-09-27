import { type TaskLiveState } from './task-live.ts';
import type { TaskRecord, TaskStatus } from './tasks.ts';
/** A transition that happened; `task` is the SAME object when nothing moved. */
export interface TransitionApplied {
    ok: true;
    task: TaskRecord;
}
/** A transition refused, with a reason the caller can show and the model act on. */
export interface TransitionRefused {
    ok: false;
    why: string;
}
/** Every transition answers this shape: applied (possibly unchanged), or
 *  refused with a reason. Never a throw. */
export type TransitionResult = TransitionApplied | TransitionRefused;
/** The patch a schedule write may carry. Every key is optional, and an absent
 *  key means "leave it alone" — never "clear it". */
export interface SchedulePatch {
    enabled?: boolean;
    cron?: string;
    mode?: 'cron' | 'chain';
    maxRuns?: number;
}
/**
 * Move a card to another column, with everything that move MEANS.
 *
 * - Moving to `done` is a hard stop, not a pause: the schedule is disarmed and
 *   every session rule is switched off, while the configuration of both
 *   survives so re-arming resumes the same rule rather than a default one.
 * - Moving OUT of `done` is a rebirth: the spent run budget goes back to zero,
 *   so the same rule resumes from its first run. The rules stay off — moving a
 *   card does not quietly re-arm automation; that stays an explicit act.
 * - The column change itself appends to the status history through the one
 *   funnel (`withStatus`), so every duration on the card is derived from the
 *   same record.
 * - A card already in the target column, with nothing else to say, comes back
 *   as the SAME object.
 *
 * This function does NOT judge whether the move is one a person may make. That
 * judgment is {@link canMoveTaskManually}, and it is a separate question on
 * purpose: a guard buried in here would give the interface one answer (it
 * decides at its own doors) and the model another (this one), which is the very
 * thing this module exists to prevent. One migration, one judgment, both read
 * by both callers.
 *
 * @param now - the instant this move happens (never read from the clock).
 * @returns the new row. The POSITION of the card within its column is not
 *  here: that is {@link applyCardOrder}'s half, which is pure, already shared,
 *  and needs the whole board to answer.
 */
export declare function moveTaskToStatus(task: TaskRecord, status: TaskStatus, now: number): TransitionResult;
/**
 * Whether a person may move THIS card by hand right now.
 *
 * Two questions, both already answered elsewhere and both read rather than
 * rewritten here: the card must sit in a column a person owns (the runner owns
 * the other two), and nothing may still be running on it — a drag that yanks a
 * card out from under a live run is not a move, and the interface already
 * refuses it. Keeping this OUT of {@link moveTaskToStatus} is what stops the
 * interface and the model from ending up with two verdicts on one question.
 *
 * The TARGET column is the caller's other half of the question, answered by the
 * same manual-column list.
 */
export declare function canMoveTaskManually(task: TaskRecord): boolean;
/**
 * Remove a session from a card, with everything that removal MEANS: the rounds
 * really go, the hide tray forgets it, the workspace can never derive it back,
 * the manual order loses its slot, a bind that pointed only at it is released —
 * and if that swept the card's last running evidence, the card leaves 进行中 in
 * the same frame instead of one surface noticing a tick later.
 *
 * @param readLive - how this host answers "is the card still working", called
 *  with the row this function PRODUCED. It is a reader rather than an answer
 *  because the record half can change the card's related-session set, so an
 *  answer computed before the call would describe a card that no longer exists.
 * @param now - the instant of the move, used when the leave changes the column.
 * @returns the new row, or a REFUSAL when this card has nothing of that
 *  session to remove. That case is a refusal rather than a silent no-op
 *  because the two consumers need opposite things from it, and one function
 *  can give both: the interface ignores a refusal — which is exactly what it
 *  does today with a `false` return — while a tool passes `why` straight to
 *  the model. A silent success there would be read as "deleted", which is the
 *  pretending-to-succeed this project keeps killing.
 */
export declare function removeSessionFromTask(task: TaskRecord, sessionId: string, now: number, readLive: (current: TaskRecord) => TaskLiveState): TransitionResult;
/**
 * Arm or disarm a card's schedule, with the two rules that keep an armed rule
 * from being a lie.
 *
 * - A DEAD ARM is refused: a card with no execution prompt can never run, so
 *   arming it would leave a switch that reads "on" over a rule that can never
 *   fire. Disarming is always allowed, which is what keeps a rule armed before
 *   the prompt was cleared removable.
 * - An unparseable or empty cron in cron mode is refused rather than stored.
 * - Changing the run budget starts that budget again: a card whose `maxRuns`
 *   moves has not spent any of the new budget.
 * - The due instant is recomputed from the caller's `now`, so an armed rule
 *   always has a next hop and a disarmed one never does.
 *
 * Note what is NOT here: arming a chain in `chain` mode also STARTS its first
 * run. That is an engine action with its own failure modes, so it belongs to
 * the caller — this returns the row, and the caller decides what to fire.
 *
 * @returns the new row, or a refusal saying what is wrong with the request.
 */
export declare function armSchedule(task: TaskRecord, patch: SchedulePatch, now: number): TransitionResult;
/**
 * Deleting a card is not a transition, and this seam exists to say so out loud.
 *
 * A board card's deletion is IRREVERSIBLE — the checklist's rows go through a
 * tombstone and can be restored, and this one cannot. What stops a stale
 * replica from bringing the card back afterwards is the merge grammar, not a
 * function here: the tombstone is stamped one millisecond above the newest
 * `updatedAt` the host ever saw for that id, so it outranks every copy another
 * device still holds while a genuinely newer edit (a concurrent revive) still
 * wins. That arithmetic belongs to board-merge-core.ts and is exercised
 * through it in the tests, so there is no second implementation to drift.
 *
 * @param _now - accepted so a caller's write funnel can pass its instant
 *  uniformly. Deliberately unused: stamping a row on its way OUT would move
 *  the tombstone the host derives from it, and the host is the authority on
 *  that stamp.
 */
export declare function deleteTaskFromDoc(task: TaskRecord, _now: number): TaskRecord;
