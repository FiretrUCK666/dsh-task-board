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
import type { TaskLiveState } from '../../core/task-live.ts'
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
  state: 'waiting' | 'running' | 'idle'
}

/** Display title: the raw title, or the untitled placeholder when blank.
 *  THE one blank-title judgment — card, board rows, detail header and delete
 *  confirms all read it, so a blank card can never show different faces per
 *  surface. Pure. */
export function titleOrUntitled(title: string, untitled: string): string {
  return title.trim() === '' ? untitled : title
}

/** Everything TaskCard renders (no JSX here — testable). */
export interface CardViewModel {
  primary: CardPrimary
  /** Secondary meta chips (chain progress, cron next-run, N 次执行, 新 N). */
  runCount: number
  lastResult: 'succeeded' | 'failed' | 'cancelled' | undefined
  queued: number
  unviewedCount: number
  /** Whether the card breathes (state-bound, independent of unread). */
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
  dots: CardSessionDot[]
  overflowDots: number
}

/**
 * Derive the card's view-model. `live` is the native truth
 * (controller.liveStateOf); absent = status fallback (card without
 * controller). `sessionStateOf` resolves per-session dots (waiting >
 * running > idle); absent = no dots.
 */
export function cardViewModelOf(
  task: TaskRecord,
  opts: {
    live?: TaskLiveState
    pendingCount?: number
    waiting?: PendingInteractionKind
    unviewedCount?: number
    sessionStateOf?: (sessionId: string) => 'waiting' | 'running' | 'idle'
    sessionIds?: readonly string[]
  } = {},
): CardViewModel {
  const running = hasOpenRun(task)
  const showingRunning = executing(task)
  const queued = pendingCommentCount(task)
  const runs = plainRunsOf(task)
  const lastResult = lastPlainResult(task)
  const isRefining = refining(task)
  const liveRunning = (opts.live ?? (task.status === 'running' ? 'running' : 'idle')) === 'running'
  const pendingCount = opts.pendingCount ?? 0
  const active = liveRunning || pendingCount > 0 || isRefining

  let primary: CardPrimary
  if (opts.waiting !== undefined) primary = { kind: 'waiting', waiting: opts.waiting }
  else if (showingRunning) primary = { kind: 'running' }
  else if (isRefining) primary = { kind: 'refining' }
  else if (queued > 0) primary = { kind: 'queued', count: queued }
  else if (task.status === 'review' && lastResult === 'failed') primary = { kind: 'failed' }
  else if (task.status === 'review') primary = { kind: 'review', unviewed: (opts.unviewedCount ?? 0) > 0 }
  else primary = { kind: 'idle' }

  const dots: CardSessionDot[] = []
  const ids = opts.sessionIds ?? []
  const resolve = opts.sessionStateOf
  if (resolve !== undefined) {
    const seen = new Set<string>()
    for (const sessionId of ids) {
      if (seen.has(sessionId)) continue
      seen.add(sessionId)
      dots.push({ sessionId, state: resolve(sessionId) })
      if (dots.length >= 3) break
    }
  }
  const overflowDots = resolve !== undefined
    ? Math.max(0, new Set(ids).size - dots.length)
    : 0

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
    dots,
    overflowDots,
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
