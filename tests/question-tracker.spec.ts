/**
 * QuestionTracker wire contract (legacy live stream): one stream,
 * replay-on-reconnect, and the self-healing rule — a stream that fails or
 * closes must never wedge the live pending map, because a subscribed surface
 * (an interaction card) would keep showing a stale question. Tests drive the
 * wire with a hand-controlled fake (queue + failure switch + stream
 * counter), no real network. On 0.1.5 the board renders from the official
 * read-only mirror instead (see pending-mirror.spec.ts); this tracker stays
 * as the fallback while no uiSession face is served.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IApiClient } from '../src/client/platform.ts'
import { QuestionTracker } from '../src/client/board/question-tracker.ts'

interface Envelope {
  rpcId: string
  payload: unknown
}

/**
 * The tracker's wire face: pushed frames are yielded by whatever stream is
 * open; an empty queue parks the stream until the next push or abort;
 * `failNextStream` makes the next open stream throw once (a transient host/
 * network blip). Streams stay open while idle — the real mux does not close
 * between frames, only on failure or teardown.
 */
class FakeApi {
  streams = 0
  failNextStream = false
  private queue: Envelope[] = []
  private waiter: (() => void) | undefined

  push(envelope: Envelope): void {
    this.queue.push(envelope)
    const waiter = this.waiter
    this.waiter = undefined
    waiter?.()
  }

  readonly events = {
    mux: (_input: unknown, signal: AbortSignal): AsyncIterableIterator<Envelope> => this.mux(signal),
  }

  private async *mux(signal: AbortSignal): AsyncIterableIterator<Envelope> {
    this.streams += 1
    while (true) {
      if (signal.aborted) throw new Error('aborted')
      if (this.failNextStream) {
        this.failNextStream = false
        throw new Error('stream failure')
      }
      const frame = this.queue.shift()
      if (frame !== undefined) {
        yield frame
        continue
      }
      await new Promise<void>(resolve => {
        this.waiter = resolve
        signal.addEventListener('abort', () => {
          if (this.waiter === resolve) this.waiter = undefined
          resolve()
        }, { once: true })
      })
    }
  }

  respond = async (): Promise<{ accepted: boolean }> => ({ accepted: true })
}

const requestedFrame = (rpcId: string, sessionId: string): Envelope => ({
  rpcId,
  payload: {
    type: 'question/requested', sessionId,
    questions: [{ id: 'q-1', question: '继续？' }],
  },
})

/** A plan-review ask: intent-tagged, its body carried in `detail` (the official shape). */
const planFrame = (rpcId: string, sessionId: string): Envelope => ({
  rpcId,
  payload: {
    type: 'question/requested', sessionId,
    questions: [{ id: 'p-1', question: '', detail: '## 计划', intent: { kind: 'plan-review', approve: '批准' } }],
  },
})

describe('QuestionTracker', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('reconnects the live stream after a transient failure', async () => {
    const api = new FakeApi()
    const tracker = new QuestionTracker(api as unknown as IApiClient)
    api.failNextStream = true
    tracker.subscribe(() => {})
    await vi.advanceTimersByTimeAsync(0)
    expect(api.streams).toBe(1)
    // The failed stream released its slot; the damped reconnect opens a fresh
    // one (the host replays the pending set on every new stream).
    await vi.advanceTimersByTimeAsync(1_000)
    expect(api.streams).toBe(2)
    tracker.dispose()
  })

  it('delivers question frames once the reconnect resumed the stream', async () => {
    const api = new FakeApi()
    const tracker = new QuestionTracker(api as unknown as IApiClient)
    api.failNextStream = true
    const seen: (string | null)[] = []
    const unsubscribe = tracker.subscribe(() => {
      seen.push(tracker.pendingOf('s-1')?.rpcId ?? null)
    })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(api.streams).toBe(2)
    api.push(requestedFrame('r-1', 's-1'))
    await vi.advanceTimersByTimeAsync(0)
    expect(seen).toContain('r-1')
    expect(tracker.pendingOf('s-1')?.questions[0]?.question).toBe('继续？')
    unsubscribe()
    tracker.dispose()
  })

  it('never reconnects after dispose (failed stream)', async () => {
    const api = new FakeApi()
    const tracker = new QuestionTracker(api as unknown as IApiClient)
    api.failNextStream = true
    tracker.subscribe(() => {})
    await vi.advanceTimersByTimeAsync(0)
    tracker.dispose()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(api.streams).toBe(1)
  })

  it('never reconnects after dispose (live stream)', async () => {
    const api = new FakeApi()
    const tracker = new QuestionTracker(api as unknown as IApiClient)
    tracker.subscribe(() => {})
    expect(api.streams).toBe(1)
    tracker.dispose()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(api.streams).toBe(1)
  })

  it('waitingKindOf derives the legacy waiting kind from pending frames', async () => {
    const api = new FakeApi()
    const tracker = new QuestionTracker(api as unknown as IApiClient)
    tracker.subscribe(() => {})
    expect(tracker.waitingKindOf('s-1')).toBeUndefined()
    // A plain ask reads as question; an intent-tagged plan reads as plan-review.
    api.push(requestedFrame('r-1', 's-1'))
    await vi.advanceTimersByTimeAsync(0)
    expect(tracker.waitingKindOf('s-1')).toBe('question')
    expect(tracker.waitingKindOf('s-2')).toBeUndefined()
    api.push(planFrame('r-2', 's-2'))
    await vi.advanceTimersByTimeAsync(0)
    expect(tracker.waitingKindOf('s-2')).toBe('plan-review')
    // Resolving the ask releases the wait.
    api.push({ rpcId: 'r-1', payload: { type: 'question/resolved', questionRpcId: 'r-1' } })
    await vi.advanceTimersByTimeAsync(0)
    expect(tracker.waitingKindOf('s-1')).toBeUndefined()
    tracker.dispose()
  })
})
