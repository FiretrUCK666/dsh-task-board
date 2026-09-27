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
 * question has its own named homes and this module is deliberately not one of
 * them: the action catalog limits `task.move`'s `status` to `MANUAL_STATUSES`,
 * so the model's path is already fenced by the very constant the interface
 * renders its buttons from, and the engine goes through `resolveCardDrop`.
 * Three needs, one shared list — a fourth expression here would be a stricter
 * one than the board really is (it would refuse a settled 待审核 card, whose
 * move buttons are enabled today and should be), with no caller to keep it
 * honest. A guard buried in this function would be worse still: the interface
 * one answer, the model another, for one question.
 *
 * @param now - the instant this move happens (never read from the clock).
 * @returns the new row. The POSITION of the card within its column is not
 *  here: that is {@link applyCardOrder}'s half, which is pure, already shared,
 *  and needs the whole board to answer.
 */
export declare function moveTaskToStatus(task: TaskRecord, status: TaskStatus, now: number): TransitionResult;
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
