/**
 * Native-side activity detection — the "两端同步" contract. When a user chats
 * in the native conversation UI (not through the board), the board learns of
 * the turn through complementary channels:
 * - the WAKE channel (0.1.5): the host's `api-session/activity` event (or
 *   the equivalent list `updatedAt` advance) fires per durable user message;
 *   the controller records its stamp and the scan below re-checks the
 *   session even when the running flag did not move — so a turn that starts
 *   AND finishes between two reconcile passes can never be missed;
 * - the legacy live frame (pre-0.5 `user/message` stream events, parsed by
 *   `nativeTurnOf`), which the engine records the instant it arrives — kept
 *   as the fast path on hosts that still serve it;
 * - the CATCH-UP backstop here: a STATE rule on every reconcile pass — a
 *   related session that is running RIGHT NOW with no board-owned round for
 *   this run period fires an external round. "Running now" covers the cases
 *   the old edge (flip) rule silently missed: a session already running when
 *   the page loaded (the "行显示进行中、卡片不过列" gap), a session born
 *   running at its first message, and frames lost while the tab was frozen.
 *
 * One rule per RUNNING PERIOD: `book.recorded` consumes a session's current
 * run (set when it fires or is suppressed by an open board round / the
 * direct-send grace; cleared the moment the session reads idle), so the same
 * native turn is never recorded twice, while every NEW turn re-arms it. Past
 * completed turns are never re-fired (a finished turn is not running).
 *
 * THE other half of this module — {@link sessionActivityOf} and the index
 * behind it — answers the DIFFERENT question the board's surfaces ask: "is this
 * session still working?" (its own turn OR a subagent descendant it summoned).
 * The two must never be confused: the detector below reads the session's OWN
 * turn flag verbatim (one native turn = one observed round), while the activity
 * layer rolls the same flag up the lineage (see session-lineage.ts). Feeding
 * the rolled-up value into the detector would lengthen a session's run period
 * behind a descendant and fabricate external rounds that never happened.
 * Pure and framework-free.
 */
import {
  indexSubagentDescendants,
  type DescendantRollup,
  type LineageIndex,
  type LineageRow,
} from './session-lineage.ts'

/** Bookkeeping the controller keeps between passes (baselines + grace). */
export interface ActivityBook {
  /** Last observed running flag per session (baseline bookkeeping). */
  running: Map<string, boolean>
  /** When an external round was created per session (for the settle grace). */
  externalSince: Map<string, number>
  /**
   * Sessions whose CURRENT running period is already consumed (fired or
   * suppressed by a board-owned turn). Cleared when the session reads idle,
   * so the next native turn re-arms detection — one external round per turn,
   * never two, never zero.
   */
  recorded: Set<string>
}

/** Narrow transcript slice: a native user text message. */
interface UserMessageEventShape {
  type: 'user/message'
  seq?: number
  data?: {
    source?: { kind?: unknown }
    content?: unknown
  }
}

/** The renderable facts of the newest native user message. */
export interface LatestUserMessage {
  /** The message's text (absent when the message carried no text). */
  text?: string
  /** Whether the message carried image blocks. */
  hasImage: boolean
  /** The native log seq of the message that started the turn — THE anchor
   *  identifying this turn across detection channels, devices and engines
   *  (same session, same seq = same turn; never record it twice). */
  anchor?: number
}

/**
 * THE newest native user message in a transcript tail — the line the user
 * typed in the native chat that started the observed turn. The LATEST user
 * message is the truth and never falls back to an older one: a picture-only
 * message reports `{ text: undefined, hasImage: true }` so the thread shows a
 * 图片消息 placeholder instead of stale text from an earlier message.
 * undefined when the tail carries no user message at all.
 */
export function latestUserMessage(events: readonly unknown[]): LatestUserMessage | undefined {
  if (!Array.isArray(events)) return undefined
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const turn = turnOfMessageEvent(events[index])
    if (turn !== undefined) return turn
  }
  return undefined
}

/**
 * Parse ONE native event into the turn facts the board records: a
 * `user/message` from the user source (the legacy live stream's
 * `session/event` payload carries exactly this shape). undefined for
 * anything else — the caller ignores assistant chatter, tool events and
 * system frames.
 */
export function nativeTurnOf(event: unknown): LatestUserMessage | undefined {
  return turnOfMessageEvent(event)
}

/** The one reader of the user-message wire shape (transcript tail + live frame). */
function turnOfMessageEvent(event: unknown): LatestUserMessage | undefined {
  const entry = event as UserMessageEventShape | null
  if (typeof entry !== 'object' || entry === null || entry.type !== 'user/message') return undefined
  const data = entry.data
  if (typeof data !== 'object' || data === null) return undefined
  if (data.source?.kind !== 'user') return undefined
  const text = contentTextOf(data.content)
  return {
    ...text !== '' ? { text } : {},
    hasImage: hasImageBlock(data.content),
    ...typeof entry.seq === 'number' && Number.isFinite(entry.seq) ? { anchor: entry.seq } : {},
  }
}

/**
 * Join a native message's text blocks (each trimmed); returns '' when the
 * content carries no text. THE shared block-joiner for native content — the
 * activity reader and the review transcript read the same wire shape, so the
 * join grammar lives here, not in two private copies.
 */
export function contentTextOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const entry = block as { type?: unknown; text?: unknown }
    if (entry.type === 'text' && typeof entry.text === 'string') {
      const text = entry.text.trim()
      if (text !== '') parts.push(text)
    }
  }
  return parts.join('\n')
}

/** Whether a message's blocks carry an image block (the "what was said" of a
 *  picture-only message is the picture itself). */
function hasImageBlock(content: unknown): boolean {
  if (!Array.isArray(content)) return false
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const entry = block as { type?: unknown }
    if (entry.type === 'image') return true
  }
  return false
}

/** One concrete detection: record an external round on this task's session. */
export interface DetectedExternalTurn {
  taskId: string
  sessionId: string
  /** The session is the task's refine session — its round must not move the column. */
  refine: boolean
}

/** The per-task facts the detector needs to avoid false positives. */
export interface ActivityCandidate {
  /** Every related session: executions + bound sessions + refine (de-duplicated). */
  sessions: ReadonlyArray<{ sessionId: string; refine: boolean }>
  /** Whether the task already has an open round on this session (board-owned or previously detected). */
  hasOpenRoundOn(sessionId: string): boolean
  /** Whether the session's CURRENT turn is board-owned already: the live
   *  direct-send grace OR a direct round the board recorded for this same
   *  running period (survives reloads — the in-memory grace alone would let
   *  a long direct turn be double-recorded after 60s). */
  inBoardTurnOn(sessionId: string): boolean
}

/**
 * Scan all candidates for out-of-band turns — the STATE rule (see the module
 * doc): a related session running RIGHT NOW whose current run period is not
 * consumed yet fires one external round. Board-owned turns (the direct-send
 * grace, a direct round of this run) consume the period WITHOUT firing —
 * the turn is already in the ledger, by identity, not by coverage. A lane
 * veto (`hasOpenRoundOn`: another round is holding the lane) is COVERAGE,
 * not identity: it must NOT consume — the veto can lift while the session
 * is still running (a queued comment settles, a stale round clears), and a
 * consumed-but-unfired period never re-arms until idle. Consuming on a
 * transient veto is the "card never lights" machine: the one edge that
 * could have fired is eaten, and a long native turn offers no second edge.
 * (Turns that finished before the pass are covered by the controller's
 * wake-evidence pass, not here.)
 */
export function detectExternalTurns(
  candidates: ReadonlyArray<{ taskId: string; candidate: ActivityCandidate }>,
  book: ActivityBook,
  byId: Readonly<Record<string, { running: boolean } | undefined>>,
): DetectedExternalTurn[] {
  const found: DetectedExternalTurn[] = []
  for (const { taskId, candidate } of candidates) {
    for (const session of candidate.sessions) {
      // RAW ON PURPOSE: one native turn = one observed round. Rolling the
      // descendant activity up here would lengthen the session's run period
      // behind a subagent and fabricate a round for a turn that never
      // happened (the ghost-round/thread-duplication risk the audit proved).
      const current = byId[session.sessionId]?.running ?? false
      book.running.set(session.sessionId, current)
      if (!current) {
        // Idle: the run period ends, the next native turn re-arms.
        book.recorded.delete(session.sessionId)
        continue
      }
      if (book.recorded.has(session.sessionId)) continue
      // Identity veto (this turn IS board-owned): consume, never fire.
      if (candidate.inBoardTurnOn(session.sessionId)) {
        book.recorded.add(session.sessionId)
        continue
      }
      // Coverage veto (another round holds the lane right now): do NOT
      // consume — the veto lifts on its own (settle/cancel) while the
      // session may still be running, and the turn must fire then.
      if (candidate.hasOpenRoundOn(session.sessionId)) continue
      // This running period is now consumed by the round firing below.
      book.recorded.add(session.sessionId)
      found.push({ taskId, sessionId: session.sessionId, refine: session.refine })
    }
  }
  return found
}

/** Whether a grace deadline (epoch ms) is still in the future. */
export function withinGrace(graceUntil: number | undefined, now: number): boolean {
  return graceUntil !== undefined && graceUntil > now
}

/** How long after a board direct-send a running flip is NOT a new external turn. */
export const DIRECT_GRACE_MS = 60_000

/** How long an external round may wait for settle evidence before it is cancelled as spurious. */
export const EXTERNAL_SETTLE_GRACE_MS = 90_000

// --- session activity: THE one "is this session still working?" derivation ----
//
// The board used to answer that question in three places — the column
// (`runningJustificationOf`'s live leg), the card's light (`executing(task)`),
// and every session row's own `running` read — and the three answers disagreed
// in exactly the states the user hit: a session whose own turn stopped while
// the subagent it summoned kept working (official sidebar: still working), and
// a card parked in 进行中 by its column or its armed schedule with no open
// round (yellow border, no breath). One derivation answers it now, and every
// surface reads THAT: `own` (this session's turn) ∨ `descendant` (an
// uninterrupted subagent-origin chain below it is running) ⇒ active.

/**
 * One session's activity answer — the complete truth, so a caller can never
 * mistake "no verdict" for "not working".
 * - `'own'` — this session's own turn is running;
 * - `'descendant'` — a subagent-origin descendant of this session is running,
 *   even when this session's own turn already stopped (the official sidebar's
 *   「N 个子代理运行中」 case);
 * - `'idle'` — the session is PRESENT in a ready list and neither holds;
 * - `'unknown'` — no verdict: the list has not arrived (`phase === 'pending'`)
 *   or the session's row is missing from the snapshot (the host list is the
 *   only truth, and an absent row cannot tell "not working" from "not listed").
 *   Callers must neither read it as idle (that is how a working card gets
 *   written out of 进行中 and persisted) nor as active (that would park a card
 *   forever on a session that no longer exists).
 */
export type SessionActivity = 'own' | 'descendant' | 'idle' | 'unknown'

/**
 * Whether one session is still working: its own turn or a running
 * subagent-origin descendant. `ready` is the caller's snapshot-readiness fact
 * (`phase !== 'pending'`); a list that has not arrived testifies about
 * nothing, so every session reads `unknown` there — the same law the round
 * watchdogs already follow.
 * @param sessionId - the session to judge.
 * @param rows - the list snapshot's `byId` (verbatim, including subagent rows).
 * @param rollup - the lineage index over those rows (session-lineage.ts).
 * @param ready - whether the list has served its baseline.
 */
export function sessionActivityOf(
  sessionId: string,
  rows: Readonly<Record<string, LineageRow | undefined>>,
  rollup: LineageIndex,
  ready = true,
): SessionActivity {
  if (!ready) return 'unknown'
  const own = rows[sessionId]
  if (own === undefined) return 'unknown'
  if (own.running) return 'own'
  return (rollup.get(sessionId)?.runningCount ?? 0) > 0 ? 'descendant' : 'idle'
}

/**
 * Whether a session counts as working right now — THE boolean every surface
 * that used to read the bare `running` flag wants (the card's session dots,
 * the session rows' glow, the detail/review state chips, the card's live leg).
 * `unknown` is false: "no verdict" must never be rendered as working; the
 * leave-running side reads the three-valued form instead.
 */
export function sessionActiveOf(
  sessionId: string,
  rows: Readonly<Record<string, LineageRow | undefined>>,
  rollup: LineageIndex,
  ready = true,
): boolean {
  const activity = sessionActivityOf(sessionId, rows, rollup, ready)
  return activity === 'own' || activity === 'descendant'
}

/**
 * The O(1) activity lookup for one snapshot: the index the callers hold. Built
 * once per snapshot REFERENCE (the controller's cache), so the board's
 * per-card / per-row asks are lookups and the lineage is never re-walked per
 * query.
 */
export interface SessionActivityIndex {
  /** Whether the snapshot behind this index may be used as evidence at all. */
  readonly ready: boolean
  /** The three-valued answer (see {@link SessionActivity}). */
  activityOf(sessionId: string): SessionActivity
  /** The two-valued answer: own ∨ descendant (see {@link sessionActiveOf}). */
  active(sessionId: string): boolean
  /** How many subagent descendants of this session are running right now. */
  descendantRunningCount(sessionId: string): number
}

/**
 * Build the activity index for one snapshot: the lineage rollup plus the
 * O(1) lookups over it.
 * @param rows - the list snapshot's `byId`.
 * @param rollup - the lineage index over those rows (session-lineage.ts).
 * @param ready - the snapshot's readiness (`phase !== 'pending'`).
 */
export function buildSessionActivityIndex(
  rows: Readonly<Record<string, LineageRow | undefined>>,
  rollup: LineageIndex,
  ready = true,
): SessionActivityIndex {
  return {
    ready,
    activityOf: sessionId => sessionActivityOf(sessionId, rows, rollup, ready),
    active: sessionId => sessionActiveOf(sessionId, rows, rollup, ready),
    descendantRunningCount: sessionId => rollup.get(sessionId)?.runningCount ?? 0,
  }
}

/** Build the lineage index + the activity index over one snapshot in one call —
 *  the ONE construction site (the controller's snapshot-keyed cache; tests
 *  build the same pair). */
export function buildSessionActivity(
  rows: Readonly<Record<string, LineageRow | undefined>>,
  ready = true,
): { rollup: LineageIndex; activity: SessionActivityIndex } {
  const rollup = indexSubagentDescendants(rows)
  return { rollup, activity: buildSessionActivityIndex(rows, rollup, ready) }
}

/** Re-exported for the callers that need the rollup's shape (display counts). */
export type { DescendantRollup }
