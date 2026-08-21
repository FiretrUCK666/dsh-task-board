/**
 * Native-side activity detection — the "两端同步" contract. When a user chats
 * in the native conversation UI (not through the board), no submission ever
 * reaches the board: the only out-of-band signal the native session list
 * exposes is the `running` flag, so a related session flipping false→true is
 * "a turn started outside the board". This module reads that signal and
 * decides concretely which external rounds the controller must record so the
 * card, the comment thread and the refine badge all follow the native reality.
 * Pure and framework-free.
 */

/** Bookkeeping the controller keeps between passes (baselines + grace). */
export interface ActivityBook {
  /** Last observed running flag per session (baseline — past activity never re-fires). */
  running: Map<string, boolean>
  /** When an external round was created per session (for the settle grace). */
  externalSince: Map<string, number>
}

/** Narrow transcript slice: a native user text message. */
interface UserMessageEventShape {
  type: 'user/message'
  data?: {
    source?: { kind?: unknown }
    content?: unknown
  }
}

/**
 * The text of the newest native user message in a transcript tail — the line
 * the user typed in the native chat that started the observed turn. The
 * external round records this as its body, so the comment thread shows what
 * was actually said (never an empty row). Mirrors the review page's user
 * text extraction; undefined when the tail carries none (window missed it).
 */
export function latestUserMessageText(events: readonly unknown[]): string | undefined {
  if (!Array.isArray(events)) return undefined
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as UserMessageEventShape | null
    if (typeof event !== 'object' || event === null || event.type !== 'user/message') continue
    const data = event.data
    if (typeof data !== 'object' || data === null) continue
    if (data.source?.kind !== 'user') continue
    const text = textOf(data.content)
    if (text !== '') return text
  }
  return undefined
}

/** Join a message's text blocks (each trimmed); returns '' when there is no text. */
function textOf(content: unknown): string {
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

/** One concrete detection: record an external round on this task's session. */
export interface DetectedExternalTurn {
  taskId: string
  sessionId: string
  /** The session is the task's refine session — its round must not move the column. */
  refine: boolean
}

/** The per-task facts the detector needs to avoid false positives. */
export interface ActivityCandidate {
  /** Every related session: executions + linked + refine (de-duplicated). */
  sessions: ReadonlyArray<{ sessionId: string; refine: boolean }>
  /** Whether the task already has an open round on this session (board-owned or previously detected). */
  hasOpenRoundOn(sessionId: string): boolean
  /** Whether the session is in the direct-send grace (its turn is already recorded by the board). */
  inGrace(sessionId: string): boolean
}

/**
 * Scan all candidates for out-of-band turns that started since the baseline:
 * a false→true flip of `running` on a related session with no board-owned
 * open round and no direct-send grace. The first pass only records baselines
 * (history is never re-fired as external activity).
 */
export function detectExternalTurns(
  candidates: ReadonlyArray<{ taskId: string; candidate: ActivityCandidate }>,
  book: ActivityBook,
  byId: Readonly<Record<string, { running: boolean } | undefined>>,
): DetectedExternalTurn[] {
  const found: DetectedExternalTurn[] = []
  for (const { taskId, candidate } of candidates) {
    for (const session of candidate.sessions) {
      const current = byId[session.sessionId]?.running ?? false
      const previous = book.running.get(session.sessionId)
      if (previous === undefined) {
        book.running.set(session.sessionId, current)
        continue
      }
      const flippedOn = !previous && current
      book.running.set(session.sessionId, current)
      if (!flippedOn) continue
      if (candidate.hasOpenRoundOn(session.sessionId) || candidate.inGrace(session.sessionId)) continue
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
