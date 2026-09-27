/**
 * The transitions with MEANING — the one implementation the interface and the
 * model both go through, so "the same thing" cannot come out two ways.
 *
 * A field write needs no shared function: whoever writes `status` writes the
 * same value. But a COLUMN MOVE is not a field write. Moving a card to 已完成
 * is a hard stop for automation: it disarms the schedule and switches off every
 * session rule, and the configuration survives so re-arming resumes the same
 * rule. If the interface did that and the model only set `status`, the board
 * would show a finished card still running itself every morning — two results
 * for one intent, and the second one is invisible until it costs something.
 * THAT is what this module exists to make impossible: the semantics live here,
 * once, and both callers are obliged to call it.
 *
 * WHAT "PURE" MEANS HERE, precisely (the tests scan for it, because a pure
 * function that quietly reads the clock is not pure, it is just untested until
 * someone runs it twice):
 * - no controller, no `ctx`, no store, no module singleton;
 * - the instant comes in as an argument — there is no `Date.now()` in this
 *   file, and a second call with the same input is the same output;
 * - nothing random, so a refusal is reproducible and testable;
 * - a refusal is a VALUE, never a throw: the controller's own style never
 *   throws, and a tool needs to tell the model what to fix rather than hand it
 *   a `false` with nothing behind it.
 *
 * A refusal therefore carries its reason: `{ ok: false, why }`, where the `why`
 * is a sentence the model can act on. "arm refused" tells it nothing; "this
 * card has no execution prompt, so a rule armed on it could never fire" tells
 * it what to do.
 *
 * AND WHEN NOTHING MOVES, THE SAME OBJECT COMES BACK — no stamp, no sync
 * churn. A board that re-stamps a card because a replica re-sent an untouched
 * copy would broadcast to every device for nothing, which is the quiet failure
 * mode this project keeps hitting: not a wrong answer, just a wrong answer on
 * every screen at once.
 *
 * ── ONE FUNCTION HAS A SHAPE WORTH READING BEFORE YOU CALL IT ───────────────
 *
 * Removing a session from a card has two halves. The record half is the row
 * answering for itself: the session's rounds really go, its hidden entries
 * clear, it joins `removedSessions` so a bound workspace can never derive it
 * back, it leaves the manual order, and a bind that pointed ONLY at it is
 * released. The other half is the LEAVE: if that deletion just swept the card's
 * last piece of running evidence, the card must step out of 进行中 in the SAME
 * frame, or the column, the border, the chip and the breathing disagree until
 * the next tick.
 *
 * That leave reads live session state, and the host is the only one who can.
 * So {@link removeSessionFromTask} takes a READER, not a value — and that is
 * not a stylistic choice. The live verdict is folded over the card's related
 * sessions, and the record half can CHANGE that set (releasing the bind, losing
 * the rounds). A value the caller computed BEFORE the call therefore describes
 * a card that no longer exists: it would still say "that session is working",
 * and the card would sit in 进行中 with nothing running — the exact bug this
 * module exists to end. So the caller supplies the way to find out, and the
 * function asks about the row it actually produced.
 */
import { disarmSessionRules } from './automation.ts'
import { isValidCron, nextRunAtMs } from './schedule.ts'
import { leaveRunningTargetOf, type TaskLiveState } from './task-live.ts'
import {
  disarmSchedule,
  hasOpenRun,
  isOpenRound,
  MANUAL_STATUSES,
  ruleArmingBlocked,
  taskBindsOf,
  withSchedule,
  withStatus,
} from './tasks.ts'
import type { TaskRecord, TaskStatus } from './tasks.ts'

/** A transition that happened; `task` is the SAME object when nothing moved. */
export interface TransitionApplied {
  ok: true
  task: TaskRecord
}

/** A transition refused, with a reason the caller can show and the model act on. */
export interface TransitionRefused {
  ok: false
  why: string
}

/** Every transition answers this shape: applied (possibly unchanged), or
 *  refused with a reason. Never a throw. */
export type TransitionResult = TransitionApplied | TransitionRefused

/** A refused transition carrying why. */
function refused(why: string): TransitionRefused {
  return { ok: false, why }
}

/** Applied, and the no-change law is decided by the CALLER comparing the
 *  returned object to the one it passed in. */
function applied(task: TaskRecord): TransitionApplied {
  return { ok: true, task }
}

/** Structural equality, the same instrument the merge kernel uses for its
 *  no-op test. A transition that would change nothing must not stamp. */
function sameTask(a: TaskRecord, b: TaskRecord): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** The patch a schedule write may carry. Every key is optional, and an absent
 *  key means "leave it alone" — never "clear it". */
export interface SchedulePatch {
  enabled?: boolean
  cron?: string
  mode?: 'cron' | 'chain'
  maxRuns?: number
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
export function moveTaskToStatus(task: TaskRecord, status: TaskStatus, now: number): TransitionResult {
  if (task.status === status) return applied(task)
  const moved = withStatus(task, status, now)
  if (status === 'done') return applied(disarmSessionRules(disarmSchedule(moved, now)))
  if (task.status === 'done' && moved.schedule !== undefined) {
    return applied({ ...moved, schedule: { ...moved.schedule, runCount: 0 } })
  }
  return applied(moved)
}

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
export function canMoveTaskManually(task: TaskRecord): boolean {
  return MANUAL_STATUSES.includes(task.status) && !hasOpenRun(task)
}

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
export function removeSessionFromTask(
  task: TaskRecord,
  sessionId: string,
  now: number,
  readLive: (current: TaskRecord) => TaskLiveState,
): TransitionResult {
  // 1) the record half — everything the row can answer for itself.
  const kept = task.executions.filter(round => round.sessionId !== sessionId)
  const wasHidden = task.hidden?.sessions?.includes(sessionId) === true
  if (kept.length === task.executions.length && !wasHidden) {
    return refused(`这张卡上没有可摘的 ${sessionId}：它没有轮次，也不在隐藏格里——先用 taskboard_query 看这张卡挂着哪些会话`)
  }
  const removed = task.removedSessions ?? []
  const next: TaskRecord = {
    ...task,
    executions: kept,
    ...!removed.includes(sessionId) ? { removedSessions: [...removed, sessionId] } : {},
  }
  const hidden = task.hidden
  if (hidden !== undefined) {
    const sessions = (hidden.sessions ?? []).filter(id => id !== sessionId)
    // A hidden ROUND of that session is hidden no longer — it is gone.
    const executions = (hidden.executions ?? []).filter(id =>
      task.executions.find(round => round.id === id && round.sessionId === sessionId) === undefined)
    if (sessions.length > 0 || executions.length > 0) {
      next.hidden = {
        ...(sessions.length > 0 ? { sessions } : {}),
        ...(executions.length > 0 ? { executions } : {}),
      }
    } else {
      delete next.hidden
    }
  }
  // A removed session cannot stay in the manual order either — it can never
  // rejoin the list — so its slot is gone for good.
  const order = task.sessionsOrder
  if (order !== undefined) {
    const keptOrder = order.filter(id => id !== sessionId)
    if (keptOrder.length > 0) next.sessionsOrder = keptOrder
    else delete next.sessionsOrder
  }
  // A live binding that points ONLY at this session cannot stay: its source is
  // no longer on the card. (Both the modern list and the legacy field go.)
  const binds = taskBindsOf(next)
  const onlyThisOne = binds.length === 1 && binds[0].kind === 'session' && binds[0].sessionId === sessionId
  const shaped: TaskRecord = !onlyThisOne ? next : withoutBinds(next)

  // 2) the leave — same frame, so the column, the border, the chip and the
  // breathing agree. The deletion may have removed the very round that was
  // holding the card in 进行中, in which case the schedule is not a reason to
  // stay either.
  const deletedOpen = task.executions.some(round => round.sessionId === sessionId && isOpenRound(round))
  const target = leaveRunningTargetOf(shaped, readLive(shaped), { ignoreSchedule: deletedOpen })
  if (target === undefined) return applied(shaped)
  // Column changes funnel through withStatus, so the history appends.
  return applied(withStatus(shaped, target, now))
}

/** A card with no source left: the modern list AND the legacy field, because a
 *  reader that still looks for the old one must not find a dangling bind. */
function withoutBinds(task: TaskRecord): TaskRecord {
  const freed: TaskRecord = { ...task }
  delete freed.bind
  delete freed.binds
  return freed
}

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
export function armSchedule(task: TaskRecord, patch: SchedulePatch, now: number): TransitionResult {
  const current = task.schedule
  const mode = patch.mode ?? current?.mode ?? 'cron'
  // Chain mode merely stops consuming the expression; it never clears it, so
  // switching back to cron keeps the last value the person typed.
  const cron = patch.cron !== undefined ? patch.cron.trim() : (current?.cron ?? '')
  if (mode === 'cron' && (cron === '' || !isValidCron(cron))) {
    return refused(`cron 表达式「${cron}」不是一个可解析的五段式，没上膛（chain 模式不用它）`)
  }
  const enabled = patch.enabled ?? current?.enabled ?? false
  if (enabled && !current?.enabled && ruleArmingBlocked(task)) {
    return refused('这张卡没有可执行的执行 Prompt，排期上膛了也永远不会触发——先给它一句 Prompt')
  }
  const maxRunsChanged = patch.maxRuns !== undefined && patch.maxRuns !== current?.maxRuns
  const maxRuns = patch.maxRuns !== undefined ? patch.maxRuns : current?.maxRuns
  const nextRunAt = enabled && mode === 'cron' ? nextRunAtMs(cron, now) : undefined
  const next = withSchedule(task, {
    enabled,
    mode,
    cron,
    nextRunAt,
    ...maxRunsChanged ? { maxRuns, runCount: 0 } : {},
  }, now)
  return applied(sameTask(next, task) ? task : next)
}

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
export function deleteTaskFromDoc(task: TaskRecord, _now: number): TaskRecord {
  return task
}
