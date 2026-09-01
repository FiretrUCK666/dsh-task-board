/**
 * QuestionTracker wire contract: one mux stream, replay-on-reconnect, and the
 * self-healing rule — a stream that fails or closes must never wedge the live
 * pending map, because a subscribed surface (an interaction card) would keep
 * showing a stale question. Tests drive the wire with a hand-controlled fake
 * (queue + failure switch + stream counter), no real network.
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

describe('QuestionTracker', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('reconnects the mux stream after a transient failure', async () => {
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
})
