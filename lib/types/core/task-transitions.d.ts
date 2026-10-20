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
 * THE BUSY SENTENCE, in one place, because two refusals say it.
 *
 * The model reads it as a receipt; the interface reads the same fact as a
 * disabled button or a line under it. Two wordings would be two answers to
 * one question, and the second one to arrive would be the one the reader
 * believes.
 */
export declare const BUSY_REASON = "\u8FD9\u5F20\u5361\u8FD8\u6709\u8F6E\u6B21\u5728\u8DD1\uFF1A\u8DD1\u5B8C\u518D\u52A8\u5B83\u3002\u73B0\u5728\u79FB\u52A8\u4F1A\u628A\u5728\u8DD1\u7684\u90A3\u4E00\u8F6E\u4E22\u4E0B\uFF0C\u5C4F\u4E0A\u8BF4\u4E0D\u6E05\u662F\u8C01\u7684\u9519\u3002";
/**
 * 把已读钟推到此刻——**卡片自己那一档与它的每一轮**。
 *
 * 「看过」是一个事实，不是一个手势：它同时住在卡片上（卡片的未读光环、「新 N」
 * 那个芯片）与它的每一轮上（那一行的未读点）。只推一半就是两份数据两个说法，
 * 所以这一个函数推两处，而**推的是哪些**由调用点自己决定。
 *
 * 单调：已读钟只往前走（`Math.max`），所以两个设备各自推一次也不会把「看过」
 * 退回「没看过」——一次较早的写不能抹掉一次较晚的写。
 *
 * 什么都没变时**返回同一个对象**：一个没有改动的读状态不该盖一个戳（那会让
 * 每台设备都以为刚刚动过）。
 *
 * @param task - the card whose read clock moves.
 * @param now - the instant it is read at.
 * @returns the new row, or the very same one when nothing moved.
 */
export declare function markTaskViewedAt(task: TaskRecord, now: number): TaskRecord;
/**
 * 通过一张待审核的卡：**一次动作做两件事**——把已读钟推到此刻，并把它移到
 * 「已完成」。
 *
 * 这两件事各有各的理由，凑成一个动作是因为人只按一下：按下去的人是在说
 * 「这一张我看过了，它完了」。而**模型按下去必须是一样的话**——所以这两件事
 * 住在这里，两边都调它，而不是各算一遍。
 *
 * THE ONE REFUSAL, and it is a refusal of the WHOLE action: a card with a
 * round still in flight is refused **untouched** — the column does not move
 * and the read clock does not move either, because 「看过了」说的是「我看过
 * 这一张」，而这一张还在跑的时候说这句话是假的。
 *
 * 忙的那道门是**界面的那道门**（`hasOpenRun`）：这一条与移栏问的不是同一个
 * 问题——移栏问的是「这一栏现在归谁管」（`resolveCardDrop`，所以「已完成」
 * 与「进行中」由执行器说了算），而「通过」问的是「它跑完了吗」，只要还有
 * 一轮在飞就还没跑完。两条门共用**同一个忙的判据**（`hasOpenRun`），
 * 但各答各的问题。
 *
 * @param task - the card to approve.
 * @param now - the instant of the approval.
 * @returns the new row, or a refusal saying why it did not happen.
 */
export declare function approveTaskToStatus(task: TaskRecord, now: number): TransitionResult;
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
