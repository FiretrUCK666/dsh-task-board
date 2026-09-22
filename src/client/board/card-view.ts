/**
 * Card view-model: THE one prioritized summary every task card renders.
 * Pure so the column, the detail badge and tests read the same truth.
 *
 * Priority (matches the breathing-light table — waiting > running >
 * refining > queued > failed-review > unviewed-review > idle):
 * waiting (pending interaction) outranks everything; running = any related
 * session genuinely working; refining = preparation (never 进行中); queued =
 * saved comments waiting for the dispatcher; failed = latest plain run
 * failed in review; review = succeeded awaiting confirmation (unviewed only
 * for the glow, read review stays quiet); idle otherwise.
 */
import type { PendingInteractionKind } from '../../core/controller.ts'
import { sessionUnviewedOf } from '../../core/session-display.ts'
import {
  executing,
  hasOpenRun,
  lastPlainResult,
  pendingCommentCount,
  plainRunsOf,
  refining,
  type TaskRecord,
} from '../../core/tasks.ts'

/** The card's primary line (one emphasis). */
export type CardPrimary =
  | { kind: 'waiting'; waiting: PendingInteractionKind }
  | { kind: 'running' }
  | { kind: 'refining' }
  | { kind: 'queued'; count: number }
  | { kind: 'failed' }
  | { kind: 'review'; unviewed: boolean }
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

/** Which light a card wears. ONE light at a time — see {@link cardLightOf}. */
export type CardLight = 'none' | 'halo' | 'ring'

/**
 * THE card light table, in code (the board's 光效规则表, one row per card):
 *
 *   'halo' — state-bound brightness: the card is working (waiting / running /
 *            refining). Inset and soft: work in flight is not a request;
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
 * THE session-dot state — one derivation for every dot a card renders, so
 * the strip can never answer "which conversation is which" differently from
 * the detail's rows:
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
  primary: CardPrimary
  /** Secondary meta chips (chain progress, cron next-run, N 次执行, 新 N). */
  runCount: number
  lastResult: 'succeeded' | 'failed' | 'cancelled' | undefined
  queued: number
  unviewedCount: number
  /**
   * Whether the card breathes: a state-bound fact, independent of unread. True
   * for waiting / running / refining AND for a card sitting in the 进行中
   * column (the same `task.status` the yellow border reads), so the border and
   * the breath are one fact — see {@link cardLightOf}.
   */
  active: boolean
  /**
   * A task in review whose plain run has settled: the human gate owes an
   * answer. Deliberately NOT `unviewed` — reading a card retires the unread
   * glow (that message stays honest) but never resolves the decision, so this
   * keeps counting after the card has been looked at. Drives the static
   * 「待你决断」 chip and the header demand count.
   */
  awaitingDecision: boolean
  /** Display truth splits from the gate: refining never reads as running. */
  showingRunning: boolean
  /** Run guard (open-round gate — queued comments never block). */
  running: boolean
}

/**
 * Derive the card's view-model from the card's OWN facts. Every field is a
 * reading of the task record (open rounds, pending comments, the refine
 * session), so the chip, the light and the next-action line can never disagree:
 * they are one derivation.
 *
 * There is deliberately NO live-state input. The card's "is this working" is
 * already answered by its own unfinished round (`executing`), and a second
 * answer — the native session `running` flag — disagreed with it in exactly the
 * states the user hit: an externally observed turn keeps a card in 进行中 while
 * no session reports running, so the chip said 进行中 and the light stayed off.
 * The per-session DOTS are likewise their own derivation
 * ({@link cardSessionDotStateOf}) — this view model never carries them.
 */
export function cardViewModelOf(
  task: TaskRecord,
  opts: {
    pendingCount?: number
    waiting?: PendingInteractionKind
    unviewedCount?: number
  } = {},
): CardViewModel {
  const running = hasOpenRun(task)
  const showingRunning = executing(task)
  const queued = pendingCommentCount(task)
  const runs = plainRunsOf(task)
  const lastResult = lastPlainResult(task)
  const isRefining = refining(task)
  // THE light is derived from the state the card DISPLAYS, never from a second
  // judgment that can disagree with it. `primary` is computed below from the
  // card's own facts, so binding the pulse to it makes the chip and the light
  // one fact: a card reading 进行中 / 待你决断 / 完善中 pulses, a card reading
  // 已排队 / 待审核 / idle is quiet.

  let primary: CardPrimary
  if (opts.waiting !== undefined) primary = { kind: 'waiting', waiting: opts.waiting }
  else if (showingRunning) primary = { kind: 'running' }
  else if (isRefining) primary = { kind: 'refining' }
  else if (queued > 0) primary = { kind: 'queued', count: queued }
  else if (task.status === 'review' && lastResult === 'failed') primary = { kind: 'failed' }
  else if (task.status === 'review') primary = { kind: 'review', unviewed: (opts.unviewedCount ?? 0) > 0 }
  else primary = { kind: 'idle' }

  // The light table (see the board's 光效规则表): waiting / running / refining
  // breathe; queued, failed, review and idle do not.
  //
  // The card's OWN COLUMN is part of that answer, and it is the SAME fact the
  // yellow border reads (`data-status={task.status}`): a card in the 进行中
  // column wears the halo no matter which leg holds it there — an in-flight
  // round, an armed schedule's gap, or (once the activity derivation landed) a
  // related session whose own turn paused while the subagent it summoned still
  // works. Binding the light to the column makes "has the yellow border ⇒ has
  // the breath" a structural property; the two attributes can no longer
  // disagree, which is exactly the state the user hit (border on, light off —
  // the light used to read `executing(task)`, i.e. only ONE of the ways a card
  // reaches 进行中). Keep this the ONLY place the mapping lives — a second copy
  // is how the chip and the light drift.
  const columnRunning = task.status === 'running'
  const active = columnRunning
    || primary.kind === 'waiting'
    || primary.kind === 'running'
    || primary.kind === 'refining'

  return {
    primary,
    runCount: runs.length,
    lastResult,
    queued,
    unviewedCount: opts.unviewedCount ?? 0,
    awaitingDecision: task.status === 'review' && lastResult !== undefined,
    active,
    showingRunning,
    running,
  }
}

/**
 * One quiet "what's next" sentence for the card (scanning aid, never a
 * second status system — it names the same primary the chips already show,
 * plus the schedule horizon when armed). Returns undefined for idle cards
 * with nothing scheduled (no noise). The caller localizes the template;
 * this returns the structured fact so copy lives in one place.
 */
export function cardNextActionOf(
  view: CardViewModel,
  task: TaskRecord,
): { kind: 'waiting' | 'running' | 'refining' | 'queued' | 'failed' | 'review' | 'scheduled' | 'chain'; count?: number } | undefined {
  switch (view.primary.kind) {
    case 'waiting': return { kind: 'waiting' }
    case 'running': return { kind: 'running' }
    case 'refining': return { kind: 'refining' }
    case 'queued': return { kind: 'queued', count: view.primary.count }
    case 'failed': return { kind: 'failed' }
    case 'review': return view.primary.unviewed ? { kind: 'review' } : undefined
    case 'idle':
      if (task.schedule?.enabled === true) {
        return task.schedule.mode === 'chain' ? { kind: 'chain' } : { kind: 'scheduled' }
      }
      return undefined
  }
}
