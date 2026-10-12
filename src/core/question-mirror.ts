/**
 * Official pending-interaction read model (the answer side).
 *
 * The waterfall (`user-questions/request`) is a CLAIM chain, not a broadcast:
 * the board must never register its own listener (it would race the native
 * composer). The official read-only projection is the uiSession session-status
 * snapshot, whose per-session `pendingInteraction` field carries the live
 * request, and each interaction carries its session, kind and full question
 * batch — AND, on the shipped host, the carrier's own `answer`/`dismiss` (the
 * native `PendingQuestion`). The board subscribes to that snapshot for DISPLAY
 * and, when the carrier exposes those actions, settles the request through the
 * very object it received: same claim, no second answerer, so the two surfaces
 * can never disagree about who answered. A carrier without them is display-only
 * and the card degrades to navigate-to-answer.
 *
 * Framework-free and DOM-free, so the rules unit-test in isolation (the live
 * subscription and the action calls live in the client adapter).
 *
 * The ITEM grammar is the wire model's (`question-rpc.ts`: normalization, the
 * intent marker, the plan-body law) — imported, never re-implemented here, so
 * both paths read one question shape. What this module adds is the SNAPSHOT
 * grammar: which carriers render, how the batch is keyed, and the waiting kind.
 */

import { wireQuestionsOf, type WireQuestionItem } from './question-rpc.ts'

/** The three waiting kinds the native session rows surface. */
export type MirrorWaitingKind = 'approval' | 'plan-review' | 'question'

/** One pending question batch on the official mirror, keyed for display. */
export interface MirrorQuestion {
  /** The mirror render identity (the official carrier key). */
  key: string
  /** The session the question was asked in. */
  sessionId: string
  /** The whole question batch (one ask, many questions). */
  questions: readonly WireQuestionItem[]
  /** True when the batch IS a plan review (single intent-tagged question). */
  isPlanReview: boolean
}

/**
 * What the comment interface shows for a session's wait: parsed content, or
 * — when the session list proves a plan/question wait but no content parsed —
 * an honest shell (kind + navigate) instead of blank nothing. The shell is
 * the backstop against any future carrier-shape drift: a proven wait can
 * never again reach the UI as silence.
 */
export type AwaitingCard<T = MirrorQuestion> =
  | { type: 'content'; question: T }
  | { type: 'shell'; waitingKind: 'plan-review' | 'question' }

/** Fold one session's wire content + waiting signal into its card (pure). */
export function awaitingOf<T>(
  question: T | undefined,
  waitingKind: MirrorWaitingKind | undefined,
): AwaitingCard<T> | undefined {
  if (question !== undefined) return { type: 'content', question }
  if (waitingKind === 'plan-review' || waitingKind === 'question') {
    return { type: 'shell', waitingKind }
  }
  return undefined
}

/** The structural slice of an official interaction the mirror reads. */
export interface MirrorInteractionLike {
  readonly key?: unknown
  readonly kind?: unknown
  readonly sessionId?: unknown
  readonly questions?: unknown
}

/** The structural slice of the official pending snapshot. */
export type MirrorSnapshotLike = ReadonlyMap<string, MirrorInteractionLike>

/**
 * Whether an official mirror interaction is a question the board renders:
 * the carrier kind is `question` or `plan-review` (never `approval` — the
 * approval card belongs to the native surface).
 */
export function isMirrorQuestionKind(kind: unknown): boolean {
  return kind === 'question' || kind === 'plan-review'
}

/**
 * Whether a batch IS a plan review: the carrier's kind says so, or one of its
 * questions declares the plan-review intent. The intent leg is what makes the
 * reading independent of the host's kind derivation — an intent-tagged question
 * is a plan awaiting confirmation wherever it arrives, and both readers of the
 * snapshot (the display batch here, the answering projection in
 * `pending-mirror.ts`) decide it HERE.
 */
export function isPlanReviewBatch(kind: unknown, questions: readonly WireQuestionItem[]): boolean {
  return kind === 'plan-review' || questions.some(item => item.intent?.kind === 'plan-review')
}

/**
 * Normalize one official mirror interaction into the board's display model;
 * undefined when it is not a renderable question batch (approval carriers,
 * malformed shapes, empty batches). The key falls back to the map key so a
 * carrier without one still renders stably.
 */
export function mirrorQuestionOf(
  sessionId: string,
  mapKey: string,
  interaction: MirrorInteractionLike | undefined,
): MirrorQuestion | undefined {
  if (interaction === undefined) return undefined
  if (!isMirrorQuestionKind(interaction.kind)) return undefined
  const rawSessionId = interaction.sessionId
  if (typeof rawSessionId !== 'string' || rawSessionId === '') return undefined
  if (rawSessionId !== sessionId) return undefined
  const questions = wireQuestionsOf(interaction.questions)
  if (questions === undefined) return undefined
  const rawKey = interaction.key
  const key = typeof rawKey === 'string' && rawKey !== '' ? rawKey : mapKey
  return {
    key,
    sessionId: rawSessionId,
    questions,
    isPlanReview: isPlanReviewBatch(interaction.kind, questions),
  }
}

/**
 * The pending mirror question for one session, when any. The snapshot is
 * keyed BY SESSION, so at most one interaction wins per session upstream —
 * the newest renderable entry wins here.
 */
export function pendingMirrorOf(
  snapshot: MirrorSnapshotLike | undefined,
  sessionId: string | undefined,
): MirrorQuestion | undefined {
  if (snapshot === undefined || sessionId === undefined) return undefined
  let latest: MirrorQuestion | undefined
  for (const [mapKey, interaction] of snapshot) {
    const question = mirrorQuestionOf(sessionId, mapKey, interaction)
    if (question !== undefined) latest = question
  }
  return latest
}

/**
 * The waiting kind of one session from the official mirror: a question batch
 * reads as `question`/`plan-review` (the kind string), an approval carrier
 * reads as `approval`, anything else is not waiting. This is the SAME signal
 * the native sidebar consumes — the board's waiting display and the native
 * one can never disagree again.
 */
export function mirrorWaitingOf(
  snapshot: MirrorSnapshotLike | undefined,
  sessionId: string | undefined,
): MirrorWaitingKind | undefined {
  if (snapshot === undefined || sessionId === undefined) return undefined
  let waiting: MirrorWaitingKind | undefined
  for (const [, interaction] of snapshot) {
    if (typeof interaction !== 'object' || interaction === null) continue
    if (interaction.sessionId !== sessionId) continue
    const kind = interaction.kind
    if (kind === 'plan-review') waiting = 'plan-review'
    else if (kind === 'question') waiting = waiting === 'plan-review' ? waiting : 'question'
    else if (kind === 'approval' && waiting === undefined) waiting = 'approval'
  }
  return waiting
}
