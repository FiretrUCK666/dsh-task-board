/**
 * Notification center aggregation: every session across every task that is
 * currently waiting on the user (approval / plan-review / question) plus
 * unviewed review results (failed/succeeded awaiting the human gate) — one
 * row per waiting session / per review task, newest first. Read-only:
 * clicking a row opens the task detail (the detail owns sessions, answers
 * and navigation), so the center never duplicates a surface that already
 * exists.
 *
 * Three clocks, never mixed:
 * - the ROUND clock (`note.at`): the round's own activity (started→ended) —
 *   the ledger fact, stable across metadata writes;
 * - the ARRIVAL clock: when THIS browser first saw the row (the board's own
 *   eyes — a memory-state `key → firstSeen` map in TaskBoard). A run that
 *   waits late in a long turn must sort by its arrival, never by the round's
 *   start, or "just arrived" reads as ten minutes old. Absent an arrival
 *   reader (legacy callers/tests) the rows keep their ledger clock;
 * - the WATERLINE (`drawerOpenedAt` in TaskBoard): what the user last saw —
 *   arrivals after it light the bell's "just arrived" dot.
 *
 * Row grammar for waiting rows: signal (waitingKind) + content (excerpt) +
 * answer affordance (go-answer vs go-session). A row carrying a readable
 * question/plan body is CONTENT; a proven wait with no readable body is a
 * SHELL (kind + honest missing-body line + navigate) — never blank silence
 * (see `awaitingOf` in question-mirror.ts, the same backstop one layer down).
 *
 * Pure and framework-free (the pending signal arrives as a callback), so the
 * aggregation unit-tests in isolation; TaskBoard supplies the live faces.
 * `notificationsOf` stays waiting-only (legacy callers/tests); the board
 * reads `notificationsExOf` for the full three-tier view.
 */
import type { PendingInteractionKind } from '../../core/controller.ts'
import { taskUnviewed } from '../../core/session-display.ts'
import { relatedSessionIdsOf } from '../../core/task-live.ts'
import { lastPlainResult, plainRunsOf, type TaskRecord } from '../../core/tasks.ts'

/** One notification row (waiting session or unviewed review task). */
export interface NotificationItem {
  taskId: string
  taskTitle: string
  sessionId: string
  sessionTitle: string
  /** Waiting kind (waiting rows only; review rows leave it undefined). */
  waitingKind?: PendingInteractionKind
  /** Tier: waiting outranks review (the bell counts both, waiting first). */
  kind: 'waiting' | 'review'
  /** Review outcome (review rows only). */
  result?: 'succeeded' | 'failed' | 'cancelled'
  /**
   * One-line content preview of the wait (waiting rows only): a plan's body
   * (detail, falling back to its question line) or a question batch's first
   * question. Plain text, never Markdown — the row is a scan line, not a
   * document. Absent = shell (proven wait, unreadable body) or review row.
   */
  excerpt?: string
  /**
   * Whether the row can land on an in-board answer card (a readable
   * question/plan carrier whose host exposes answer/cancel). True = the row
   * offers 「去回答」; false/absent = 「去会话」 only (approvals can never be
   * answered in-board; a shell has no body to answer).
   */
  answerable?: boolean
  /** Moment instant: waiting rides the round's own activity clock
   *  (started→ended), review rides its settle — never task.updatedAt, so
   *  metadata writes (recolor, reorder, cruise toggles) cannot reorder the
   *  bell, fake arrivals, or poison the unseen waterline. */
  at: number
}

/** THE row key (`task|session|kind`): snooze stamps, drawer keys and the
 *  unseen set all derive from this one constructor — never a retyped
 *  template, so the three can never disagree on identity. */
export function noteKeyOf(note: Pick<NotificationItem, 'taskId' | 'sessionId' | 'kind'>): string {
  return `${note.taskId}|${note.sessionId}|${note.kind}`
}

/** Metadata-orthogonal row order: lexicographic key comparison for sort
 *  tiebreaks (stable across metadata writes, drags and reorders). */
function compareNoteKey(
  a: Pick<NotificationItem, 'taskId' | 'sessionId' | 'kind'>,
  b: Pick<NotificationItem, 'taskId' | 'sessionId' | 'kind'>,
): number {
  const left = noteKeyOf(a)
  const right = noteKeyOf(b)
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Collect every waiting session of every task, deduplicated by
 * task+session (an execution round and the refine round can name the same
 * session — it waits once, not twice). A session without a waiting signal
 * is not a notification, however busy it is.
 */
export function notificationsOf(
  tasks: readonly TaskRecord[],
  pendingOf: (sessionId: string | undefined) => PendingInteractionKind | undefined,
  titleOf: (sessionId: string) => string,
): NotificationItem[] {
  return notificationsExOf(tasks, pendingOf, titleOf, () => false)
    .filter(item => item.kind === 'waiting')
    .map(item => ({
      taskId: item.taskId,
      taskTitle: item.taskTitle,
      sessionId: item.sessionId,
      sessionTitle: item.sessionTitle,
      ...(item.waitingKind !== undefined ? { waitingKind: item.waitingKind } : {}),
      kind: item.kind,
      ...(item.result !== undefined ? { result: item.result } : {}),
      at: item.at,
    }))
}

/**
 * The waiting body the board can quote on a row: a plan-review batch quotes
 * its plan (detail, falling back to the question line); a question batch
 * quotes its first question. THE one excerpt grammar — every waiting row
 * (drawer, folded members) reads the same body the in-board answer card
 * answers, so the row can never promise content the card does not hold.
 */
export interface WaitingBody {
  /** The quoted body (plan detail / plan question / first question). */
  text: string
  /** True when the body IS a plan under review (plan card grammar). */
  isPlan: boolean
}

/** Row-excerpt budget: a notification row is a scan line, not a document. */
export const WAITING_EXCERPT_BUDGET = 60

/** Trim a waiting body to the row budget (whitespace-collapsed, one line). */
export function waitingExcerptOf(text: string, budget: number = WAITING_EXCERPT_BUDGET): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= budget) return collapsed
  return `${collapsed.slice(0, Math.max(0, budget - 1)).trimEnd()}…`
}

/** Pick the quotable body of one open question batch (pure, testable). */
export function waitingBodyOf(question: {
  questions: readonly { question: string; detail?: string; intent?: { kind: string } }[]
  isPlanReview: boolean
} | undefined): WaitingBody | undefined {
  if (question === undefined || question.questions.length === 0) return undefined
  const planItem = question.isPlanReview
    ? question.questions.find(item => item.intent?.kind === 'plan-review')
    : undefined
  const quoted = planItem ?? question.questions[0]
  if (quoted === undefined) return undefined
  const text = (planItem !== undefined ? (quoted.detail ?? quoted.question) : quoted.question).trim()
  if (text === '') return undefined
  return { text, isPlan: planItem !== undefined }
}

/** Waiting-row content supplied by the board's question faces (all optional —
 *  absent = today's signal-only rows; the legacy callers/tests never pass it). */
export interface WaitingContentFace {
  /** The open question/plan batch for one session (mirror or tracker). */
  questionOf?: (sessionId: string | undefined) => {
    questions: readonly { question: string; detail?: string; intent?: { kind: string } }[]
    isPlanReview: boolean
  } | undefined
  /** Whether the board can settle a carrier in place right now. */
  answerInPlace?: boolean
}

/**
 * Full three-tier view: waiting sessions first (newest task first), then
 * unviewed review tasks (failed before succeeded, newest settle first).
 * `isUnviewed` decides the review tier (the board passes `taskUnviewed`);
 * absent/false = waiting-only (legacy behavior). `linkedIdsOf` supplies live
 * linked-session ids per task so a bound-but-never-run waiting session still
 * notifies (same related set as the live state).
 *
 * Waiting rows sort by the ARRIVAL clock when `arrivedAt` is supplied (the
 * board's first-seen map), falling back to the round clock for legacy
 * callers. Review rows always sort by their settle clock.
 */
export function notificationsExOf(
  tasks: readonly TaskRecord[],
  pendingOf: (sessionId: string | undefined) => PendingInteractionKind | undefined,
  titleOf: (sessionId: string) => string,
  isUnviewed: (task: TaskRecord) => boolean = taskUnviewed,
  linkedIdsOf: (task: TaskRecord) => readonly string[] = () => [],
  content: WaitingContentFace = {},
  arrivedAt: (note: Pick<NotificationItem, 'taskId' | 'sessionId' | 'kind'>) => number | undefined = () => undefined,
): NotificationItem[] {
  const waiting: NotificationItem[] = []
  const seen = new Set<string>()
  const push = (task: TaskRecord, sessionId: string | undefined): void => {
    if (sessionId === undefined) return
    const waitingKind = pendingOf(sessionId)
    if (waitingKind === undefined) return
    const key = `${task.id}|${sessionId}`
    if (seen.has(key)) return
    seen.add(key)
    // The waiting moment is the round's own activity (started→ended): a
    // session-less binding (no round yet) falls back to the task clock.
    // Approximation, stated honestly: this is round activity, NOT the pending
    // arrival instant (a long run that starts waiting late still sorts by its
    // start). The board sorts by its own arrival clock instead (see
    // `arrivedAt` below); this clock stays as the ledger fact for legacy
    // callers and for review-tier comparison, never for "just arrived".
    const round = task.executions.find(candidate => candidate.sessionId === sessionId)
    // Signal + content + affordance in ONE derivation: a readable carrier
    // quotes its body and (with an interactive host) offers 去回答; anything
    // else is a shell (kind + go-session only). Approvals never quote and
    // never answer in-board — the native surface owns them.
    const question = (waitingKind === 'question' || waitingKind === 'plan-review')
      ? content.questionOf?.(sessionId)
      : undefined
    const body = waitingBodyOf(question)
    const answerable = body !== undefined && waitingKind !== 'approval' && content.answerInPlace === true
    waiting.push({
      taskId: task.id,
      taskTitle: task.title,
      sessionId,
      sessionTitle: titleOf(sessionId),
      waitingKind,
      kind: 'waiting',
      ...(body !== undefined ? { excerpt: waitingExcerptOf(body.text) } : {}),
      ...(answerable ? { answerable: true } : {}),
      at: round !== undefined ? (round.endedAt ?? round.startedAt) : task.updatedAt,
    })
  }
  for (const task of tasks) {
    for (const { sessionId } of relatedSessionIdsOf(task, linkedIdsOf(task))) push(task, sessionId)
  }
  // Arrival clock first (a wait that fires late in a long turn is NEW news),
  // round clock as the fallback, row key as the metadata-orthogonal tiebreak —
  // never task.updatedAt (which would smuggle the metadata clock back in).
  const arrivalOf = (note: NotificationItem): number =>
    arrivedAt({ taskId: note.taskId, sessionId: note.sessionId, kind: note.kind }) ?? note.at
  waiting.sort((a, b) => arrivalOf(b) - arrivalOf(a) || compareNoteKey(a, b))

  // Review tier: tasks sitting in review with unviewed content (the human
  // gate). Failed first (needs a decision), then succeeded. The session slot
  // names the latest plain run's session (or the task itself when unknown) —
  // the row opens the task detail either way.
  const review: NotificationItem[] = []
  for (const task of tasks) {
    if (task.status !== 'review' || !isUnviewed(task)) continue
    // WAITING already covers it — but ONLY for the same conversation. The old
    // grammar suppressed the review echo for the WHOLE task whenever ANY
    // waiting row existed on it, so a finished run's 通过/打回 vanished the
    // moment an unrelated sibling session asked a question (the "running card
    // shows 通过 and jumps straight to done" report is this hole from the
    // other side: the gate and the block shared one row, and the row only
    // offered the gate's action). A waiting row suppresses the review echo
    // only when they name the SAME session; different sessions keep both rows.
    const runs = plainRunsOf(task)
    const latest = runs[runs.length - 1]
    const sessionId = latest?.sessionId ?? task.executions[task.executions.length - 1]?.sessionId ?? task.id
    if ([...seen].some(key => key === `${task.id}|${sessionId}`)) {
      // The SAME session is already shouting louder (waiting); skip the
      // quieter review echo for that conversation only.
      continue
    }
    const result = lastPlainResult(task)
    review.push({
      taskId: task.id,
      taskTitle: task.title,
      sessionId,
      sessionTitle: titleOf(sessionId),
      kind: 'review',
      ...(result !== undefined ? { result } : {}),
      at: latest?.endedAt ?? task.updatedAt,
    })
  }
  // Prove ordering from the shared event model (one derivation, not two):
  // waiting rows ride their round's activity clock, review rows ride their
  // settle — the sort below is newest-first (then rank, then key) with
  // waiting outranking review on ties.
  review.sort((a, b) => {
    const rank = (result: NotificationItem['result']): number =>
      result === 'failed' ? 0 : result === 'succeeded' ? 1 : 2
    const rankDiff = rank(a.result) - rank(b.result)
    if (rankDiff !== 0) return rankDiff
    if (b.at !== a.at) return b.at - a.at
    return compareNoteKey(a, b)
  })
  return [...waiting, ...review]
}

/**
 * What the board owes the user, stated as one fact for the whole surface.
 *
 * The bell's badge counts ROWS (folded by task), and a column header counts
 * CARDS — two numbers that measure different things and, on screen, never
 * reconcile. Neither of them answers the question the board exists to answer
 * (「等我做什么」), and a card that has been glanced at drops out of the bell
 * entirely. This derivation is that answer, and it is deliberately independent
 * of `viewedAt`:
 *
 *  - `waiting` is a live block: an agent suspended on approval / plan / question.
 *  - `review` is the human gate: a task sitting in review with a settled run.
 *    Once looked at it stops BREATHING (that is the unread signal, and it stays
 *    honest) but it is not resolved until a human passes or sends it back — so
 *    it keeps counting here. This is the split the board was missing: five
 *    cards can wait in review while the only visible demand is an 11px digit.
 *
 * Pure, so the header row and the tests read the same number.
 */
export interface BoardDemand {
  /** Total items awaiting a human: waiting sessions + review tasks. */
  total: number
  /** Sessions currently suspended on a question / approval / plan. */
  waiting: number
  /** Tasks in review whose latest plain run has settled. */
  review: number
}

export function boardDemandOf(
  tasks: readonly TaskRecord[],
  pendingOf: (sessionId: string | undefined) => PendingInteractionKind | undefined,
  linkedIdsOf: (task: TaskRecord) => readonly string[] = () => [],
): BoardDemand {
  let waiting = 0
  let review = 0
  for (const task of tasks) {
    // A waiting session is counted once per session, exactly like the bell:
    // a run round and a refine round can name the same session.
    const counted = new Set<string>()
    // `relatedSessionIdsOf` takes the task's linked ids as an ARRAY (it is the
    // live related-set derivation, shared with the card's glow and the bell), so
    // the callback is invoked here — passing the callback itself would iterate
    // the function's characters instead of the ids.
    for (const { sessionId } of relatedSessionIdsOf(task, linkedIdsOf(task))) {
      if (sessionId === undefined || counted.has(sessionId)) continue
      if (pendingOf(sessionId) === undefined) continue
      counted.add(sessionId)
      waiting += 1
    }
    // The human gate. `lastPlainResult !== undefined` means a plain run has
    // settled; the task is still in review, so nobody has decided yet.
    if (task.status === 'review' && lastPlainResult(task) !== undefined) review += 1
  }
  return { total: waiting + review, waiting, review }
}

/**
 * The arrival clock's pure half (TaskBoard owns the memory map; this owns
 * the merge grammar): stamp every unseen waiting key at `now`, drop keys
 * that left the board, keep first-seen for the rest. The review tier never
 * enters this map — its settle clock is already an arrival-grade instant.
 * @returns the merged map (a fresh instance — the caller's state stays immutable).
 */
export function stampWaitingArrivals(
  seen: ReadonlyMap<string, number>,
  notes: readonly Pick<NotificationItem, 'taskId' | 'sessionId' | 'kind'>[],
  now: number,
): Map<string, number> {
  const live = new Set(notes.map(note => noteKeyOf(note)))
  const next = new Map<string, number>()
  for (const [key, at] of seen) {
    if (live.has(key)) next.set(key, at)
  }
  for (const note of notes) {
    if (note.kind !== 'waiting') continue
    const key = noteKeyOf(note)
    if (!next.has(key)) next.set(key, now)
  }
  return next
}

/** Read one row's arrival instant (missing key = unknown, never 0). */
export function arrivalOf(
  seen: ReadonlyMap<string, number>,
  note: Pick<NotificationItem, 'taskId' | 'sessionId' | 'kind'>,
): number | undefined {
  return seen.get(noteKeyOf(note))
}
/** One folded task entry: the head row plus every row sharing its task. */
export interface FoldedNotification {
  head: NotificationItem
  /** Every row in this head's task (head first). */
  items: NotificationItem[]
  /** Rows folded into this head (items.length — 1 is unfolded and renders
   *  exactly as before). */
  count: number
}

/**
 * Fold notification rows by task (same-task rows share one head — the first,
 * which the waiting-first ordering already ranked loudest). Pure view-layer
 * grouping: `notificationsExOf` keeps its signature so existing callers and
 * tests never change; the bell badge and the drawer list fold the same way.
 */
export function foldNotesByTask(notes: readonly NotificationItem[]): FoldedNotification[] {
  const folded: FoldedNotification[] = []
  const index = new Map<string, FoldedNotification>()
  for (const note of notes) {
    const existing = index.get(note.taskId)
    if (existing !== undefined) {
      existing.items.push(note)
      existing.count += 1
      continue
    }
    const entry: FoldedNotification = { head: note, items: [note], count: 1 }
    index.set(note.taskId, entry)
    folded.push(entry)
  }
  return folded
}
