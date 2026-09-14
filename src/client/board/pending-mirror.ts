/**
 * Official pending-interaction mirror: the 0.1.5 question face.
 *
 * The waterfall is a claim chain (first answer wins), so the board never
 * REGISTERS a listener of its own — it subscribes to the official uiSession
 * `pendingInteractions` snapshot (the same source the native sidebar and
 * composer read) and, while an entry is live, it holds the carrier object
 * that entry carries.
 *
 * That carried object IS the native `PendingQuestion`: its `answer(answer)`
 * and `cancel()` settle the very waterfall invocation the native composer
 * would settle (verified against the shipped plugin: the carrier exposes
 * `sessionId / kind / key / questions` plus those two methods, and the
 * client-side listener's return value resolves the host call). Answering
 * through it is therefore NOT a competing answerer — nothing new is
 * registered, the same claim is settled once, and the other surface's card
 * drops with the next snapshot notification. In-place answering is offered
 * only for a carrier that really exposes those methods; a host whose
 * snapshot entries carry data but no action (or no uiSession at all) keeps
 * the read-only navigate shell.
 */
import type { QuestionAnswerEntry, QuestionRpcFace, WireQuestion } from '../../core/question-rpc.ts'
import {
  mirrorQuestionsOf,
  type MirrorInteractionLike,
  type MirrorSnapshotLike,
} from '../../core/question-mirror.ts'

/**
 * The action half of an official carrier, when the entry has one. Read
 * structurally (never `instanceof` across the plugin boundary): the shipped
 * native `PendingQuestion` exposes both, a snapshot entry that does not is
 * display-only and degrades to the navigate shell.
 */
export interface MirrorCarrierActions {
  answer(answer: { answers: readonly QuestionAnswerEntry[] }): Promise<unknown> | unknown
  cancel(): Promise<unknown> | unknown
}

/** One live entry: the display projection plus the carrier that answers it. */
interface MirrorEntry {
  wire: WireQuestion
  carrier: MirrorInteractionLike & MirrorCarrierActions
}

/** The structural slice of the official uiSession face this mirror reads. */
export interface UiSessionMirrorFace {
  readonly pendingInteractions: {
    getSnapshot(): ReadonlyMap<string, unknown>
    subscribe(listener: () => void): () => void
  }
}

/** Whether a snapshot entry can settle its own pending request. */
function canAnswer(interaction: unknown): interaction is MirrorInteractionLike & MirrorCarrierActions {
  if (typeof interaction !== 'object' || interaction === null) return false
  const carrier = interaction as MirrorCarrierActions
  return typeof carrier.answer === 'function' && typeof carrier.cancel === 'function'
}

/** The one reader of the official carrier shape (structural, never instanceof). */
function wireQuestionOf(sessionId: string, mapKey: string, interaction: unknown): WireQuestion | undefined {
  if (typeof interaction !== 'object' || interaction === null) return undefined
  const carrier = interaction as MirrorInteractionLike
  if (carrier.kind !== 'question' && carrier.kind !== 'plan-review') return undefined
  if (carrier.sessionId !== sessionId) return undefined
  const questions = mirrorQuestionsOf(carrier.questions)
  if (questions === undefined) return undefined
  const rawKey = carrier.key
  return {
    rpcId: typeof rawKey === 'string' && rawKey !== '' ? rawKey : mapKey,
    sessionId,
    questions,
    isPlanReview: carrier.kind === 'plan-review',
  }
}

/** In-place answering over the official pending snapshot (see module doc). */
export class PendingMirror implements QuestionRpcFace {
  constructor(private readonly uiSession: UiSessionMirrorFace | undefined) {}

  /**
   * The current projection, DERIVED on every read from the official snapshot
   * — there is no cached copy that a missed notification could leave stale,
   * so "what the card shows" and "what an answer settles" are always the same
   * generation of the snapshot.
   */
  private get entries(): ReadonlyMap<string, MirrorEntry> {
    return reduceSnapshot(this.uiSession?.pendingInteractions.getSnapshot())
  }

  pendingOf(sessionId: string | undefined): WireQuestion | undefined {
    if (sessionId === undefined) return undefined
    return this.entries.get(sessionId)?.wire
  }

  /**
   * Whether ANY live interaction can be settled from here. Read fresh by the
   * card on every render: a data-only snapshot entry (no `answer`/`cancel`)
   * keeps the read-only navigate shell, so "can answer" is never claimed for
   * a carrier that cannot.
   */
  get answerInPlace(): boolean {
    for (const entry of this.entries.values()) {
      if (canAnswer(entry.carrier)) return true
    }
    return false
  }

  subscribe(listener: () => void): () => void {
    const source = this.uiSession?.pendingInteractions
    if (source === undefined) return () => {}
    return source.subscribe(listener)
  }

  /**
   * Settle the session's live request with the whole answer batch. The
   * identity guard is the contract: the answered carrier must be the SAME
   * object (key and identity) the official snapshot publishes RIGHT NOW — a
   * request answered or cancelled elsewhere, or replaced by a newer one,
   * rejects instead of settling something stale. False = not accepted; the
   * card keeps itself open and reports it.
   */
  async answer(rpcId: string, sessionId: string, answers: readonly QuestionAnswerEntry[]): Promise<boolean> {
    const carrier = liveCarrierOf(this.entries, rpcId, sessionId)
    if (carrier === undefined) return false
    try {
      await carrier.answer({ answers: [...answers] })
      return true
    } catch (error) {
      console.error('[dsh-task-board] answering the pending question failed', error)
      return false
    }
  }

  /** Reject the whole ask (the tool call settles as cancelled, like the native ×). */
  async cancel(rpcId: string): Promise<boolean> {
    const entries = this.entries
    for (const [sessionId, entry] of entries) {
      if (entry.wire.rpcId !== rpcId) continue
      const carrier = liveCarrierOf(entries, rpcId, sessionId)
      if (carrier === undefined) return false
      try {
        await carrier.cancel()
        return true
      } catch (error) {
        console.error('[dsh-task-board] cancelling the pending question failed', error)
        return false
      }
    }
    return false
  }
}

/**
 * The live carrier behind one displayed card, or undefined when it went
 * stale. The displayed rpcId is the INTERACTION's own key (the snapshot is
 * keyed by it, never by session), so this compares both the projection's
 * newest-wins entry and the carrier's identity: a newer interaction replaced
 * the card the user is looking at, and the answer is refused rather than
 * delivered to whatever came after it.
 */
function liveCarrierOf(
  entries: ReadonlyMap<string, MirrorEntry>,
  rpcId: string,
  sessionId: string | undefined,
): (MirrorInteractionLike & MirrorCarrierActions) | undefined {
  if (sessionId === undefined) return undefined
  const entry = entries.get(sessionId)
  if (entry === undefined) return undefined
  if (entry.wire.rpcId !== rpcId) return undefined
  return canAnswer(entry.carrier) ? entry.carrier : undefined
}

/** Project the whole official snapshot into per-session newest-wins entries. */
function reduceSnapshot(snapshot: ReadonlyMap<string, unknown> | undefined): ReadonlyMap<string, MirrorEntry> {
  const next = new Map<string, MirrorEntry>()
  if (snapshot === undefined) return next
  // Iteration order decides "newest wins" for a repeated session, exactly as
  // before; the carrier rides its own entry so answering reads the SAME
  // object the snapshot published.
  for (const [mapKey, interaction] of snapshot) {
    const carrier = interaction as MirrorInteractionLike | undefined
    const sessionId = carrier?.sessionId
    if (typeof sessionId !== 'string' || sessionId === '') continue
    const wire = wireQuestionOf(sessionId, mapKey, interaction)
    if (wire === undefined) continue
    next.set(sessionId, { wire, carrier: interaction as MirrorInteractionLike & MirrorCarrierActions })
  }
  return next
}

export type { MirrorSnapshotLike }
