/**
 * Live mux tracker for pending native questions: opens one `events.mux`
 * stream (the host replays every still-pending question frame on a new
 * stream, then pushes live frames), reduces them into the pure pending map,
 * and answers/cancels through the same `respond` wire call the native
 * composer uses. One instance per board mount — every surface (review page,
 * session panel, refine panel) reads the same projection by session id, so
 * answering on one surface is instantly reflected everywhere, and the card
 * disappears when the host resolves the call (question/resolved frame).
 */
import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client'
import type { ClientResponse, RpcError, RpcId } from '@deepseek-ai/dsh-client-connection/client'
import {
  pendingQuestionOf,
  reduceQuestionFrames,
  type QuestionAnswerEntry,
  type QuestionRpcFace,
  type WireQuestion,
} from '../../core/question-rpc.ts'

/** Open lazily on first reader; frames flow only while someone consumes. */
export class QuestionTracker implements QuestionRpcFace {
  private pending: ReadonlyMap<string, WireQuestion> = new Map()
  private readonly listeners = new Set<() => void>()
  private controller: AbortController | undefined
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly api: IApiClient) {}

  /** Start the mux stream once (idempotent); aborts on teardown. */
  start(): void {
    if (this.controller !== undefined || this.reconnectTimer !== undefined) return
    const controller = new AbortController()
    this.controller = controller
    void this.pump(controller)
  }

  /** Close the stream and clear all listeners (plugin teardown). */
  dispose(): void {
    this.controller?.abort()
    this.controller = undefined
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    this.listeners.clear()
    this.pending = new Map()
  }

  private async pump(controller: AbortController): Promise<void> {
    try {
      for await (const envelope of this.api.events.mux({}, controller.signal)) {
        const frame = envelope.payload
        if (frame.type === 'question/requested') {
          this.apply({ type: 'question/requested', rpcId: envelope.rpcId, sessionId: frame.sessionId, questions: frame.questions })
        } else if (frame.type === 'question/resolved') {
          this.apply({ type: 'question/resolved', questionRpcId: frame.questionRpcId })
        }
      }
    } catch {
      // Transient stream failure — the reconnect below repairs it.
    }
    // Self-healing stream: a dead mux (host restart, network blip, error
    // frame, plain close) must never wedge the tracker, because a subscribed
    // reader would show a stale question card forever. Release the slot and
    // reopen shortly — the host replays every still-pending frame on a new
    // stream, so nothing is lost. A real teardown already cleared the slot
    // (dispose) and the guard below stops the restart.
    if (this.controller !== controller) return
    this.controller = undefined
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      this.start()
    }, 1_000)
  }

  private apply(frame: { type: 'question/requested'; rpcId: string; sessionId: string; questions: unknown }
    | { type: 'question/resolved'; questionRpcId: string }): void {
    const next = reduceQuestionFrames(this.pending, frame)
    if (next === this.pending) return
    this.pending = next
    for (const listener of [...this.listeners]) listener()
  }

  pendingOf(sessionId: string | undefined): WireQuestion | undefined {
    this.start()
    return pendingQuestionOf(this.pending, sessionId)
  }

  subscribe(listener: () => void): () => void {
    this.start()
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  async answer(rpcId: string, sessionId: string, answers: readonly QuestionAnswerEntry[]): Promise<boolean> {
    this.start()
    return this.respond({
      type: 'client-response',
      rpcId: rpcId as unknown as RpcId,
      result: { ok: true, value: { sessionId, answer: { answers: [...answers] } } },
    })
  }

  async cancel(rpcId: string): Promise<boolean> {
    this.start()
    return this.respond({
      type: 'client-response',
      rpcId: rpcId as unknown as RpcId,
      result: {
        ok: false,
        error: { code: 'cancelled', message: 'the user closed this question request', details: {} } as RpcError,
      },
    })
  }

  /** The one wire boundary: POST /api/respond with the client-response form. */
  private async respond(message: ClientResponse): Promise<boolean> {
    try {
      const receipt = await this.api.respond(message)
      return receipt.accepted
    } catch {
      return false
    }
  }
}
