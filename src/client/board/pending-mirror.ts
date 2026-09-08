/**
 * Official pending-interaction mirror: the 0.1.5 question face.
 *
 * The waterfall is a claim chain (first answer wins), so the board never
 * registers its own listener and never answers — it only SUBSCRIBES to the
 * official uiSession `pendingInteractions` snapshot the host already
 * projects (the same source the native sidebar and composer read). Answers
 * stay in the native session; the board navigates there.
 *
 * The controller keeps consuming the historical `QuestionRpcFace`
 * (WireQuestion), so this adapter normalizes the official carrier into that
 * shape: `key` becomes the display rpcId (never echoed to any wire — there
 * is no respond path), and `answer`/`cancel` always report false so the card
 * degrades to its navigate affordance. One instance per board mount.
 */
import type { QuestionAnswerEntry, QuestionRpcFace, WireQuestion } from '../../core/question-rpc.ts'
import {
  mirrorQuestionsOf,
  type MirrorInteractionLike,
  type MirrorSnapshotLike,
} from '../../core/question-mirror.ts'

/** The structural slice of the official uiSession face this mirror reads. */
export interface UiSessionMirrorFace {
  readonly pendingInteractions: {
    getSnapshot(): ReadonlyMap<string, unknown>
    subscribe(listener: () => void): () => void
  }
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

/** Read-only QuestionRpcFace over the official pending snapshot. */
export class PendingMirror implements QuestionRpcFace {
  /** The board never answers in place on 0.1.5 (navigate to answer). */
  readonly answerInPlace = false as const
  private pending: ReadonlyMap<string, WireQuestion> = new Map()

  constructor(private readonly uiSession: UiSessionMirrorFace | undefined) {
    this.refresh()
  }

  /** Re-read the official snapshot (call on every subscribe notification). */
  refresh(): void {
    this.pending = reduceSnapshot(this.uiSession?.pendingInteractions.getSnapshot())
  }

  pendingOf(sessionId: string | undefined): WireQuestion | undefined {
    if (sessionId === undefined) return undefined
    return this.pending.get(sessionId)
  }

  subscribe(listener: () => void): () => void {
    const source = this.uiSession?.pendingInteractions
    if (source === undefined) return () => {}
    return source.subscribe(() => {
      this.refresh()
      listener()
    })
  }

  async answer(_rpcId: string, _sessionId: string, _answers: readonly QuestionAnswerEntry[]): Promise<boolean> {
    return false
  }

  async cancel(_rpcId: string): Promise<boolean> {
    return false
  }
}

/** Project the whole official snapshot into per-session newest-wins rows. */
function reduceSnapshot(snapshot: ReadonlyMap<string, unknown> | undefined): ReadonlyMap<string, WireQuestion> {
  const next = new Map<string, WireQuestion>()
  if (snapshot === undefined) return next
  for (const [mapKey, interaction] of snapshot) {
    const carrier = interaction as MirrorInteractionLike | undefined
    const sessionId = carrier?.sessionId
    if (typeof sessionId !== 'string' || sessionId === '') continue
    const question = wireQuestionOf(sessionId, mapKey, interaction)
    if (question !== undefined) next.set(sessionId, question)
  }
  return next
}

export type { MirrorSnapshotLike }
