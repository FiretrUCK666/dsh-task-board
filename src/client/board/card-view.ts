/**
 * Card view-model: THE one prioritized summary every task card renders.
 * Pure so the column, the detail badge and tests read the same truth.
 *
 * WHY THIS FILE IS THE WHOLE ANSWER
 *
 * The card used to have TWO priority chains: `cardViewModelOf` ranked
 * waiting > running > queued > failed > review > idle, and the component then
 * rendered a DIFFERENT one (running → pending → awaiting-decision → run
 * count). The model's own primary word therefore never reached the screen: a
 * queued card showed no primary at all, and a failed one showed 待你决断 on one
 * line and 失败待决策 on the next. And the component re-derived four more facts
 * of its own (the run list, the last result, the chain/paused words) from
 * `plainRunsOf`, which cannot see a comment, an observed native turn, a direct
 * steer or a rule instruction — the four lanes a card is actually worked on
 * through.
 *
 * So the rule now: `primary` below is the chip. Everything the card shows is a
 * field computed here from the card's OWN facts, and the component renders
 * fields. There is no second chain to drift, and no lane the model cannot see.
 */
import type { PendingInteractionKind } from '../../core/controller.ts'
import { blockedCauseOf, type RuleBlockedCause } from '../../core/automation.ts'
import { sessionUnviewedOf, taskUnviewed, taskUnviewedCount } from '../../core/session-display.ts'
import { gateOf, latestCompletedOf, type GateState, type WaitingSession } from '../../core/task-demand.ts'
import {
  hasOpenRun,
  pendingCommentCount,
  plainRunsOf,
  type TaskRecord,
} from '../../core/tasks.ts'

/**
 * The card's primary line — one emphasis, one priority. Rendered verbatim as
 * the first chip; the next-action line below reads the SAME value, so a card
 * can never say two different things about itself one line apart.
 *
 *   waiting — a session of this card is suspended on the user right now
 *            (approval / plan review / question). The human's turn outranks
 *            everything, including work still in flight.
 *   running — the card or one of its conversations is working.
 *   queued  — comments are saved and waiting for the dispatcher.
 *   gate    — work finished, nobody has looked at it yet, nobody has ruled on
 *            it (`failed` names the outcome). This is the only loud thing a
 *            settled card has to say.
 *   runs    — the settled-run counter. Quiet: it is history, not a request.
 *   idle    — nothing to say.
 */
export type CardPrimary =
  | { kind: 'waiting'; waiting: PendingInteractionKind; count: number }
  | { kind: 'running' }
  | { kind: 'queued'; count: number }
  | { kind: 'gate'; failed: boolean }
  | { kind: 'runs'; count: number; failed: boolean }
  | { kind: 'idle' }

/** One related-session dot (max 3 rendered, +N overflow). */
export interface CardSessionDot {
  sessionId: string
  /** waiting/running = live; unread = a finished run this card has not had
   *  reviewed yet (same clock as the detail row's glow); idle otherwise. */
  state: 'waiting' | 'running' | 'unread' | 'idle'
}

/** Display title: the raw title, or the untitled placeholder when blank.
 *  THE one blank-title judgment — card, board rows, detail header and delete
 *  confirms all read it, so a blank card can never show different faces per
 *  surface. Pure. */
export function titleOrUntitled(title: string, untitled: string): string {
  return title.trim() === '' ? untitled : title
}

/**
 * 卡片「更新于」的时刻：这张卡**自己的工作推进**——创建，以及每一轮的开始与
 * 结束（跑起来的会话、完成的一轮）。
 *
 * 为什么不直接读 `task.updatedAt`：那是**同步戳**，不是「这张卡什么时候动过」。
 * 改一次列内顺序（一次顶格、一次手动拖动）会给**同栏每一张被让位的卡片**盖上
 * 新的 `updatedAt`——同步合并按它排序，漏盖就是两台设备顺序漂移，所以这个戳
 * 去掉不得。可一旦直接显示它，一次顶格就会让整栏几百张卡一起写「刚刚」，
 * 恰好把「哪个先完成」这个信号抹平。于是显示口径与同步口径在这里分家：
 * 戳照盖，屏上读的是这张卡自己的进展。
 */
export function cardUpdatedAtOf(task: TaskRecord): number {
  let latest = task.createdAt
  for (const round of task.executions) {
    latest = Math.max(latest, round.endedAt ?? round.startedAt)
  }
  return latest
}

/** Which light a card wears. ONE light at a time — see {@link cardLightOf}. */
export type CardLight = 'none' | 'halo' | 'ring'

/**
 * THE card light table, in code (the board's 光效规则表, one row per card):
 *
 *   'halo' — state-bound brightness: the card is working (waiting / running).
 *           Inset and soft: work in flight is not a request;
 *   'ring' — unread: a run finished and this content has not been looked at.
 *            Outer and stronger: it IS a request to look;
 *   'none' — read and settled, or idle.
 *
 * A card that is BOTH working and unread wears the halo — this function is the
 * single place that decides, so the precedence is stated rather than inherited
 * from stylesheet order (both lights set the same `animation` property through
 * ONE `data-light` switch, so there is no second rule to fight).
 */
export function cardLightOf(active: boolean, unviewed: boolean): CardLight {
  if (active) return 'halo'
  if (unviewed) return 'ring'
  return 'none'
}

/**
 * THE session-dot state — one derivation for every dot a card renders, so the
 * strip can never answer "which conversation is which" differently from the
 * detail's rows:
 *
 *   waiting  — the session is suspended on a question / plan / approval;
 *   running  — its own turn or a running subagent descendant works now;
 *   unread   — a finished run on THIS card has not been reviewed yet
 *              (the per-session clock `sessionUnviewedOf`, the exact clock
 *              the detail's session-row glow reads);
 *   idle     — settled and seen (or a session with no run and no read state).
 *
 * Live states outrank unread: a conversation that is both working and
 * unreviewed reads as working — one dot, one loudest truth. Pure: the board
 * supplies the two live faces, the precedence lives here once.
 */
export function cardSessionDotStateOf(
  task: TaskRecord,
  sessionId: string,
  ctx: {
    pendingInteractionOf: (sessionId: string) => PendingInteractionKind | undefined
    activeOf: (sessionId: string) => boolean
  },
): CardSessionDot['state'] {
  if (ctx.pendingInteractionOf(sessionId) !== undefined) return 'waiting'
  if (ctx.activeOf(sessionId)) return 'running'
  if (sessionUnviewedOf(task, sessionId)) return 'unread'
  return 'idle'
}

/** Everything TaskCard renders (no JSX here — testable). */
export interface CardViewModel {
  /**
   * The card's one loudest line, and the chip the component renders. There is
   * no second ranking anywhere in the card.
   */
  primary: CardPrimary
  /**
   * The human gate, in the card's own words: 'unseen' means finished work the
   * user has neither looked at nor ruled on. This is the SAME state the
   * header's 待审核 count and the notification drawer's rows read
   * (`task-demand.gateOf`), so the chip, the number and the row can never
   * disagree about whether this card is waiting for a person.
   */
  gate: GateState
  /** Run guard (open-round gate — queued comments never block). */
  running: boolean
  /** Whether the card breathes: a state-bound fact, independent of unread. */
  active: boolean
  /** Unread content on the card at all (drives the ring and the 新 chip). */
  unviewed: boolean
  /** How many unviewed NUMBERED runs sit behind 新 N (vs a bare 新留言). */
  unviewedRunCount: number
  /** Total numbered runs (the 执行 sequence — plain runs, by definition). */
  runCount: number
  /** Saved comments waiting for the dispatcher. */
  queued: number
  /** Whether a rule is armed and cannot drive anything, and which one (empty
   *  prompt). undefined = nothing blocked, so the schedule/batch chips keep
   *  their own wording. */
  autoBlocked: RuleBlockedCause | undefined
  /** A chain run is in flight right now (the 接续中 chip). */
  chaining: boolean
  /** Automation paused specifically BECAUSE the last work failed. */
  autoPausedFailed: boolean
  /** The newest finished work's outcome, or undefined when nothing finished. */
  lastResult?: 'succeeded' | 'failed'
}

/**
 * Derive the card's view-model from the card's OWN facts. Every field is a
 * reading of the task record (open rounds, pending comments) or of the ONE
 * shared gate derivation, so the chip, the light, the next-action line and the
 * header's number can never disagree: they are one derivation.
 *
 * The ONLY live input is `waiting` — the related-session set's live block,
 * computed by the board (`waitingSessionsOf`, the same call the demand row and
 * the bell make) and handed in as data so this function stays pure. It is the
 * RELATED set, not "sessions that happen to own a round here", so a session
 * dragged in from the workspace raises the card's own voice instead of only
 * lighting a dot the user cannot see on a touch screen.
 *
 * There is deliberately NO second "is this working" input. The card's work is
 * already answered by its own unfinished round (`hasOpenRun`) and by its own
 * column; a second answer is how a card ends up saying 进行中 with the light
 * off. The per-session DOTS are their own derivation
 * ({@link cardSessionDotStateOf}) — this view model never carries them.
 */
export function cardViewModelOf(
  task: TaskRecord,
  opts: {
    /** Sessions of this card suspended on the user (the related set). */
    waiting?: readonly WaitingSession[]
  } = {},
): CardViewModel {
  const waitingSessions = opts.waiting ?? []
  const running = hasOpenRun(task)
  const queued = pendingCommentCount(task)
  const runs = plainRunsOf(task)
  const lastRun = runs[runs.length - 1]
  const gate = gateOf(task)
  const lastResult = latestCompletedOf(task)?.result
  const unviewed = taskUnviewed(task)
  const unviewedRunCount = taskUnviewedCount(task)
  const blocked = blockedCauseOf(task)
  const chaining = task.schedule?.enabled === true
    && task.schedule.mode === 'chain'
    && task.status === 'running'
  // Automation paused by a failure reads the same newest-work fact the gate
  // does, so the 失败 word and the 待你决断 chip can never disagree about it.
  const autoPausedFailed = task.status === 'review' && lastResult === 'failed'

  // ONE chain, in the order a person scanning the board needs it.
  let primary: CardPrimary
  if (waitingSessions.length > 0) {
    primary = { kind: 'waiting', waiting: waitingSessions[0].waitingKind, count: waitingSessions.length }
  } else if (running) {
    primary = { kind: 'running' }
  } else if (queued > 0) {
    primary = { kind: 'queued', count: queued }
  } else if (gate.state === 'unseen') {
    primary = { kind: 'gate', failed: gate.work?.result === 'failed' }
  } else if (lastRun !== undefined) {
    primary = { kind: 'runs', count: runs.length, failed: lastRun.result === 'failed' }
  } else {
    primary = { kind: 'idle' }
  }

  // The light table: waiting / running breathe; queued, gate and idle do not.
  //
  // The card's OWN COLUMN is part of that answer, and it is the SAME fact the
  // yellow border reads (`data-status={task.status}`): a card in the 进行中
  // column wears the halo no matter which leg holds it there. Binding the
  // light to the column makes "has the yellow border ⇒ has the breath" a
  // structural property. Keep this the ONLY place the mapping lives.
  const active = task.status === 'running'
    || primary.kind === 'waiting'
    || primary.kind === 'running'

  return {
    primary,
    gate: gate.state,
    running,
    active,
    unviewed,
    unviewedRunCount,
    runCount: runs.length,
    queued,
    autoBlocked: blocked,
    chaining,
    autoPausedFailed,
    ...lastResult !== undefined ? { lastResult } : {},
  }
}

/**
 * One quiet "what's next" sentence for the card (scanning aid, never a
 * second status system — it names the same primary the chip already shows,
 * plus the schedule horizon when armed). Returns undefined for idle cards
 * with nothing scheduled (no noise). The caller localizes the template;
 * this returns the structured fact so copy lives in one place.
 */
export function cardNextActionOf(
  view: CardViewModel,
  task: TaskRecord,
): { kind: 'waiting' | 'running' | 'queued' | 'failed' | 'review' | 'scheduled' | 'chain'; count?: number } | undefined {
  switch (view.primary.kind) {
    case 'waiting': return { kind: 'waiting', count: view.primary.count }
    case 'running': return { kind: 'running' }
    case 'queued': return { kind: 'queued', count: view.primary.count }
    case 'gate': return view.primary.failed ? { kind: 'failed' } : { kind: 'review' }
    case 'runs': return undefined
    case 'idle':
      if (task.schedule?.enabled === true) {
        return task.schedule.mode === 'chain' ? { kind: 'chain' } : { kind: 'scheduled' }
      }
      return undefined
  }
}
