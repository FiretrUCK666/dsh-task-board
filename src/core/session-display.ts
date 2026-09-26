/**
 * Shared session display logic: derive the live state of any execution's
 * underlying session (across all its rounds: the original run + comments).
 * Used by execution rows, task cards, and the reminder
 * system so every surface shows the same truth.
 *
 * Pure functions — no side effects, fully unit-testable.
 */
import type { PendingInteractionKind } from './controller.ts'
import { isOpenRound, type TaskRecord, type ExecutionRecord } from './tasks.ts'

/**
 * The live state of an execution's session (aggregating all rounds that share
 * the session: the original run and its comments).
 */
export interface SessionDisplay {
  /** The session's current state (waiting > running > latest settled). */
  state: 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled'
  /** When the session last saw activity (started or settled a round). */
  lastActivity: number | undefined
  /** The interaction kind if the session is waiting on the user. */
  waitingKind: PendingInteractionKind | undefined
}

/**
 * Collect every round belonging to an execution's session:
 * - Rounds with the same sessionId (comments injected into this session).
 * - Rounds whose parentExecutionId matches (comments attributed by parent
 *   rather than session — legacy data compatibility).
 * The execution itself is always included.
 */
/**
 * THE CONVERSATION: every round this task recorded in that session, whatever
 * lane produced it (a run, an injected comment, an observed native turn, a
 * direct steer, a rule instruction). It answers "what has happened in this
 * conversation on this card" — the state chip, the activity window, the unread
 * clock. One set and no lane filter, because a conversation that was driven
 * from a linked panel or steered straight into the native UI is the SAME
 * conversation: a row that cannot see those rounds reports an outcome that
 * stopped happening minutes ago.
 */
function conversationRoundsOf(task: TaskRecord, sessionId: string | undefined): readonly ExecutionRecord[] {
  if (sessionId === undefined) return []
  return task.executions.filter(round => round.sessionId === sessionId)
}

/**
 * THE EXECUTION'S REVIEW THREAD: the execution plus the comments submitted
 * FROM its review page, plus legacy rows attributed by `parentExecutionId`.
 *
 * This is deliberately NOT the conversation. A session-anchored drive comment
 * belongs to the linked conversation's thread and must never make an
 * execution's review page read as live. EXCEPTION: externally-observed rounds
 * (a native-side turn recorded onto the task) keep their thread slot AND count
 * as the execution's unread, because they are that run's own turn happening out
 * of band.
 *
 * A surface asking "what state is this conversation in" reads
 * {@link conversationRoundsOf}; a surface asking "is there unread content on
 * THIS review page" reads this one.
 */
export function executionThreadOf(task: TaskRecord, execution: ExecutionRecord): readonly ExecutionRecord[] {
  const id = execution.id
  const sid = execution.sessionId
  return task.executions.filter(round =>
    round.id === id ||
    (sid !== undefined && round.sessionId === sid && (round.sessionAnchor === undefined || round.external === true)) ||
    round.parentExecutionId === id
  )
}

/** The result → settled-state table (succeeded / failed, everything else
 *  honestly cancelled) — one mapping for every derivation in this module. */
function settledStateOf(result: ExecutionRecord['result']): SessionDisplay['state'] {
  return result === 'succeeded' ? 'succeeded' : result === 'failed' ? 'failed' : 'cancelled'
}

/** The latest start among a set (a conversation's most recent word). */
function lastStartOf(rounds: readonly ExecutionRecord[]): number | undefined {
  let latest: number | undefined
  for (const round of rounds) latest = latest === undefined ? round.startedAt : Math.max(latest, round.startedAt)
  return latest
}

/**
 * THE live state of ONE conversation on this task, over its whole round set
 * (`conversationRoundsOf` — every lane). Priority: waiting (the human turn is
 * first) > an open round > the native activity leg > the newest settled
 * outcome. A conversation with nothing settled and nothing open reads 未运行:
 * there is nothing in the ledger to read, and the host session row carries no
 * outcome of its own.
 *
 * `active` is the NATIVE truth, supplied by the caller and never re-derived
 * here: this session's own turn OR a running subagent descendant it summoned
 * (session-activity.ts). TRUE means the agent is working no matter which
 * surface started the turn (a plain run, an injected comment, a direct steer,
 * a session rule, an out-of-band native chat) and no matter whose turn holds
 * the session. It only ADDS the native truth; a board round keeps its own
 * semantics above.
 */
function conversationDisplayOf(
  task: TaskRecord,
  waitingKind: PendingInteractionKind | undefined,
  active: boolean,
  sessionId: string | undefined,
): SessionDisplay {
  const rounds = conversationRoundsOf(task, sessionId)
  if (waitingKind !== undefined) {
    return { state: 'waiting', lastActivity: lastStartOf(rounds), waitingKind }
  }
  // An open round is real work in flight. A plain run is open from its start
  // (it carries no `injectedAt`); a comment round is open only once actually
  // injected — a saved/queued comment has not started and must never make the
  // conversation look live. An EXTERNAL round is open from its observation (it
  // IS the native turn, never a queued comment).
  const open = rounds.filter(isOpenRound)
  if (open.length > 0) {
    return { state: 'running', lastActivity: lastStartOf(open), waitingKind: undefined }
  }
  if (active) {
    return { state: 'running', lastActivity: lastStartOf(rounds), waitingKind: undefined }
  }
  let latest: ExecutionRecord | undefined
  for (const round of rounds) {
    if (round.endedAt === undefined) continue
    if (latest === undefined || (round.endedAt ?? 0) > (latest.endedAt ?? 0)) latest = round
  }
  if (latest !== undefined) {
    return { state: settledStateOf(latest.result), lastActivity: latest.endedAt, waitingKind: undefined }
  }
  return { state: 'cancelled', lastActivity: undefined, waitingKind: undefined }
}

/**
 * The live state of an execution's SESSION, for a row whose identity is that
 * execution. A session-scoped read of the one conversation derivation: a
 * conversation the task both ran in and later drove from a linked panel is
 * still one conversation, and its row must show what it just did rather than
 * the outcome of the run that opened the row. (Session-less legacy rows read
 * their own execution, which is all they have.)
 */
export function sessionDisplay(
  task: TaskRecord,
  execution: ExecutionRecord,
  waitingKind: PendingInteractionKind | undefined,
  active = false,
): SessionDisplay {
  return conversationDisplayOf(task, waitingKind, active, execution.sessionId)
}

/**
 * The live state of a LINKED session on one task — the same derivation
 * {@link sessionDisplay} uses, addressed by session id. Two entry points into
 * ONE body on purpose: they used to be separate implementations with different
 * round sets, and the narrower one always won for a session that was both run
 * and bound, so the row reported an outcome that had already been superseded.
 */
export function linkedSessionDisplay(
  task: TaskRecord,
  sessionId: string,
  waitingKind: PendingInteractionKind | undefined,
  active: boolean,
): SessionDisplay {
  return conversationDisplayOf(task, waitingKind, active, sessionId)
}

/**
 * The time window of a conversation on this task (all its rounds, every lane —
 * the same set the state chip and the order key read, so the 开始/结束/耗时
 * line can never describe a different stretch of time than the chip above it).
 * - startedAt = earliest round's start.
 * - endedAt = latest settled round's end; undefined if any round is still open.
 * - duration = endedAt - startedAt; undefined if the session is still open.
 */
export function sessionTimes(task: TaskRecord, execution: ExecutionRecord): {
  startedAt: number
  endedAt: number | undefined
  duration: number | undefined
} {
  const rounds = conversationRoundsOf(task, execution.sessionId)
  if (rounds.length === 0) {
    return { startedAt: execution.startedAt, endedAt: undefined, duration: undefined }
  }

  const startedAt = Math.min(...rounds.map(r => r.startedAt))
  // THE open-round judgment (shared with the dispatcher): a round that is
  // merely saved-and-queued is not work in progress, and a round that has
  // settled is finished — reading `endedAt` alone here would re-derive the
  // same rule a second time and drift from it.
  const anyOpen = rounds.some(r => isOpenRound(r))
  const endedAt = anyOpen
    ? undefined
    : Math.max(...rounds.map(r => r.endedAt ?? 0).filter(t => t > 0))
  const duration = endedAt !== undefined ? endedAt - startedAt : undefined

  return { startedAt, endedAt, duration }
}

// --- unviewed-content reminders ----------------------------------------------
//
// Every surface that can hold new content (a settled run, an injected or
// settled comment) carries a `viewedAt`: the instant the user
// last opened the surface that reveals it (the task detail for the card, the
// review page for an execution row). Content whose activity is newer than the
// baseline counts as unviewed and drives the reminder affordances — the
// card's breathing glow + "新" badge and the row's unread dot — exactly like
// an inbox's unread signal: opening the surface clears it, new activity
// re-lights it. Legacy rows without `viewedAt` default to their own latest
// activity, so nothing already-seen lights up after an upgrade.

/** The activity instant of a round: when it settled, else its last start. */
function roundActivity(round: ExecutionRecord): number {
  return round.endedAt ?? round.startedAt
}

/**
 * 「这个会话最后一次有动静」的时刻 —— 会话列的排序键与每会话未读时钟的
 * **同一份**推导（`max(round.endedAt ?? round.startedAt)`，开轮算它自己的开始），
 * 两条读数因此不可能互相矛盾。
 *
 * 它对**这个任务**记录的所有轮次取最大值——普通运行、保存中的评论、旁听到的
 * 原生对话、直发，一视同仁：「这段对话又产出新东西了」不关心是哪条车道产出
 * 的。会话没有轮次时返回 0（读作「没有动过」，调用方自己拿宿主时间兜底）。
 */
export function sessionActivityOf(task: TaskRecord, sessionId: string): number {
  let activity = 0
  for (const round of task.executions) {
    if (round.sessionId !== sessionId) continue
    activity = Math.max(activity, roundActivity(round))
  }
  return activity
}

/**
 * The viewed baseline of an execution row: when the user last opened its
 * review page; absent, the run's own start (every created/normalized run
 * carries a viewedAt, so this only guards test fixtures). A stable anchor —
 * a run starts viewed at its start, its settlement (or a later comment)
 * then lights the unread dot until the review page opens.
 */
export function executionViewedBaseline(execution: ExecutionRecord): number {
  return execution.viewedAt ?? execution.startedAt
}

/**
 * Whether an execution's session has content newer than the last time its
 * review page was opened: any round of the session (the run itself plus its
 * comments) with activity after the baseline. The single source for the
 * execution row's unread dot and the card's "新" badge.
 */
export function executionUnviewed(task: TaskRecord, execution: ExecutionRecord): boolean {
  const baseline = executionViewedBaseline(execution)
  return executionThreadOf(task, execution).some(round => roundActivity(round) > baseline)
}

/**
 * The viewed baseline of a task card: when the user last opened the task
 * detail; absent (legacy) it equals the task's newest round activity, so
 * already-seen content stays quiet after an upgrade.
 */
export function taskViewedBaseline(task: TaskRecord): number {
  if (task.viewedAt !== undefined) return task.viewedAt
  let latest = 0
  for (const round of task.executions) latest = Math.max(latest, roundActivity(round))
  return latest
}

/**
 * Whether the task has any unviewed content: any round — a run settling, a
 * comment being injected or settling — with activity newer
 * than the card's viewed baseline. Drives the card's breathing glow.
 */
export function taskUnviewed(task: TaskRecord): boolean {
  const baseline = taskViewedBaseline(task)
  return task.executions.some(round => roundActivity(round) > baseline)
}

/**
 * How many plain-run executions of the task are unviewed — the "新 N" count
 * on the card. Comment-only unread (no unviewed plain runs) shows a
 * bare "新" instead.
 */
export function taskUnviewedCount(task: TaskRecord): number {
  let count = 0
  for (const execution of task.executions) {
    if (execution.comment !== undefined) continue
    if (executionUnviewed(task, execution)) count += 1
  }
  return count
}

/**
 * Whether ONE session of a task still owes the user a look — THE per-session
 * read clock, shared by the detail's session-row glow and the card's session
 * dot, so the two surfaces can never disagree about which conversation just
 * finished.
 *
 * ONE sentence: the session's LATEST activity is newer than the last time
 * anything of it was acknowledged. Both edges are maxima over ALL of the
 * session's rounds — plain runs, saved comments, observed native turns and
 * direct sends alike — because "this conversation produced something new"
 * does not care which lane produced it:
 *
 *  - activity = max(round.endedAt ?? round.startedAt) — an open round counts
 *    as its own start, which never beats an equal-or-later acknowledgment;
 *    {@link sessionActivityOf} is that reading, named once for both callers;
 *  - acknowledgment = max(round.viewedAt ?? round.startedAt) — rounds are
 *    born seen (their creator stamps `viewedAt`; storage backfills old rows
 *    to their own activity), and the existing funnels move it forward
 *    (review page open, 标已读 单·组·全部, approve, notification per-session
 *    open). An unstamped round falls back to its start: activity after an
 *    acknowledgment nobody recorded is exactly what should glow.
 *
 * It never writes; opening the task DETAIL does not clear it (reading the
 * list is not acknowledging the conversation — the card ring keeps its own,
 * coarser task-level clock).
 */
export function sessionUnviewedOf(task: TaskRecord, sessionId: string): boolean {
  const activity = sessionActivityOf(task, sessionId)
  let acknowledged = 0
  for (const round of task.executions) {
    if (round.sessionId !== sessionId) continue
    acknowledged = Math.max(acknowledged, round.viewedAt ?? round.startedAt)
  }
  return activity > 0 && activity > acknowledged
}
