/**
 * Official pending-interaction mirror — the 0.1.5 answer-side read model.
 *
 * On dsh 0.1.5 the waterfall (`user-questions/request`) is a CLAIM chain, not
 * a broadcast: the board must never register its own listener (it would race
 * the native composer). The official read-only projection is the uiSession
 * `pendingInteractions` snapshot (`Map<sessionId, interaction>`), where each
 * interaction carries its session, kind and full question batch — AND, on the
 * shipped host, the carrier's own `answer`/`cancel` (the native
 * `PendingQuestion`). The board subscribes to that snapshot for DISPLAY and,
 * when the carrier exposes those actions, settles the request through the
 * very object it received: same claim, no second answerer, so the two
 * surfaces can never disagree about who answered. A carrier without them is
 * display-only and the card degrades to navigate-to-answer.
 *
 * Framework-free and DOM-free, so the rules unit-test in isolation (the live
 * subscription and the action calls live in the client adapter).
 */

import { isDetailOnlyPlanItem } from './question-rpc.ts'

/** The three waiting kinds the native session rows surface. */
export type MirrorWaitingKind = 'approval' | 'plan-review' | 'question'

/** One normalized question item (unknown shapes trimmed to the wire contract). */
export interface MirrorQuestionItem {
  /** Stable caller-provided question id. */
  id: string
  /** The question to display. */
  question: string
  /** Optional supporting detail (kept out of option labels). */
  detail?: string
  /** Optional short heading/group label. */
  header?: string
  /** Optional choices a capable UI can render as a menu. */
  options?: readonly { label: string; description?: string }[]
  /** Whether more than one option may be selected (defaults to single). */
  multiSelect?: boolean
}

/** One pending question batch on the official mirror, keyed for display. */
export interface MirrorQuestion {
  /** The mirror render identity (the official carrier key). */
  key: string
  /** The session the question was asked in. */
  sessionId: string
  /** The whole question batch (one ask, many questions). */
  questions: readonly MirrorQuestionItem[]
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
 * Normalize one mirror question item; drop anything malformed. Same grammar
 * as the historical wire model (question-rpc.ts): the question text is
 * mandatory — EXCEPT a detail-carried plan review (see isDetailOnlyPlanItem),
 * whose body lives in `detail` by official contract.
 */
export function normalizeMirrorQuestion(value: unknown): MirrorQuestionItem | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const source = value as Record<string, unknown>
  const questionText = typeof source.question === 'string' ? source.question : ''
  if (questionText === '' && !isDetailOnlyPlanItem(value)) return undefined
  const detail = typeof source.detail === 'string' ? source.detail : undefined
  const item: MirrorQuestionItem = {
    id: typeof source.id === 'string' && source.id !== '' ? source.id
      : questionText !== '' ? questionText
      : detail !== undefined ? detail.slice(0, 40) : 'plan',
    question: questionText,
  }
  if (detail !== undefined) item.detail = detail
  if (typeof source.header === 'string') item.header = source.header
  if (Array.isArray(source.options)) {
    const options = source.options
      .map((option): { label: string; description?: string } | undefined => {
        if (typeof option !== 'object' || option === null) return undefined
        const entry = option as Record<string, unknown>
        if (typeof entry.label !== 'string') return undefined
        const result: { label: string; description?: string } = { label: entry.label }
        if (typeof entry.description === 'string') result.description = entry.description
        return result
      })
      .filter((option): option is { label: string; description?: string } => option !== undefined)
    if (options.length > 0) item.options = options
  }
  if (source.multiSelect === true || source.multiSelect === 'true') item.multiSelect = true
  return item
}

/** Normalize a whole mirror question list; undefined when nothing is usable. */
export function mirrorQuestionsOf(value: unknown): MirrorQuestionItem[] | undefined {
  if (!Array.isArray(value)) return undefined
  const questions = value
    .map(normalizeMirrorQuestion)
    .filter((question): question is MirrorQuestionItem => question !== undefined)
  return questions.length > 0 ? questions : undefined
}

/**
 * Whether an official mirror interaction is a question the board renders:
 * the carrier kind is `question` or `plan-review` (never `approval` — the
 * approval card belongs to the native surface).
 */
export function isMirrorQuestionKind(kind: unknown): boolean {
  return kind === 'question' || kind === 'plan-review'
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
  const questions = mirrorQuestionsOf(interaction.questions)
  if (questions === undefined) return undefined
  const rawKey = interaction.key
  const key = typeof rawKey === 'string' && rawKey !== '' ? rawKey : mapKey
  return {
    key,
    sessionId: rawSessionId,
    questions,
    isPlanReview:
      interaction.kind === 'plan-review' ||
      questions.some(item => intentOf(item) === 'plan-review'),
  }
}

/** The plan-review intent marker of one normalized item, when tagged. */
function intentOf(item: MirrorQuestionItem): string | undefined {
  const tagged = item as MirrorQuestionItem & { intent?: unknown }
  const intent = tagged.intent
  if (typeof intent !== 'object' || intent === null) return undefined
  const kind = (intent as Record<string, unknown>).kind
  return kind === 'plan-review' ? 'plan-review' : undefined
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
