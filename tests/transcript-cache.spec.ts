/**
 * The transcript freshness layer: single-flight (concurrent reads share one
 * RPC), short-TTL cache (a just-loaded tail is reused), timeout (a hung read
 * resolves undefined at the deadline, never forever), and failures are never
 * cached (the next read retries). This is the root fix for 「评论区加载很久 /
 * 有时加载不出来」— tested here against a fake raw reader + fake timers.
 */
import { describe, expect, it } from 'vitest'
import { createTranscriptReader } from '../src/client/transcript-cache.ts'

/** A manual fake clock + deferrer (no real timers). */
function makeClock(): { now: () => number; advance: (ms: number) => void; defer: (fn: () => void, ms: number) => () => void } {
  let t = 0
  const pending = new Set<{ fn: () => void; at: number }>()
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms
      for (const job of [...pending]) {
        if (job.at <= t) { pending.delete(job); job.fn() }
      }
    },
    defer: (fn: () => void, ms: number) => {
      const job = { fn, at: t + ms }
      pending.add(job)
      return () => { pending.delete(job) }
    },
  }
}

describe('createTranscriptReader', () => {
  it('serves concurrent reads of one session from a SINGLE flight', async () => {
    const clock = makeClock()
    let calls = 0
    const reader = createTranscriptReader<number>({
      read: () => { calls++; return new Promise(resolve => { setTimeout(() => resolve(42), 0) }) },
      defer: clock.defer,
      now: clock.now,
    })
    const [a, b] = await Promise.all([reader('s1'), reader('s1')])
    expect(a).toBe(42)
    expect(b).toBe(42)
    expect(calls).toBe(1)
  })

  it('reuses a fresh cached value and re-reads once it ages past the TTL', async () => {
    const clock = makeClock()
    let calls = 0
    const reader = createTranscriptReader<number>({
      read: async () => { calls++; return calls },
      defer: clock.defer,
      now: clock.now,
      ttlMs: 1000,
    })
    expect(await reader('s1')).toBe(1)
    expect(await reader('s1')).toBe(1) // cache hit (no new call)
    expect(calls).toBe(1)
    clock.advance(1500) // past the TTL
    expect(await reader('s1')).toBe(2) // refreshed
    expect(calls).toBe(2)
  })

  it('resolves undefined at the deadline when the raw read hangs', async () => {
    const clock = makeClock()
    const reader = createTranscriptReader<number>({
      read: () => new Promise<number>(resolve => { void resolve }), // never settles
      defer: clock.defer,
      now: clock.now,
      timeoutMs: 8000,
    })
    const pending = reader('s1')
    let settled = false
    void pending.then(() => { settled = true })
    clock.advance(7000)
    await Promise.resolve()
    expect(settled).toBe(false) // still in flight before the deadline
    clock.advance(1500) // cross the 8s timeout
    expect(await pending).toBeUndefined()
  })

  it('never caches a failure: the next read retries', async () => {
    const clock = makeClock()
    let calls = 0
    const reader = createTranscriptReader<number>({
      read: async () => { calls++; return calls === 1 ? undefined : 7 },
      defer: clock.defer,
      now: clock.now,
    })
    expect(await reader('s1')).toBeUndefined()
    expect(await reader('s1')).toBe(7) // retried, not a cached failure
    expect(calls).toBe(2)
  })

  it('keys the cache per session (one session never serves another)', async () => {
    const clock = makeClock()
    const reader = createTranscriptReader<string>({
      read: async sessionId => sessionId,
      defer: clock.defer,
      now: clock.now,
    })
    expect(await reader('a')).toBe('a')
    expect(await reader('b')).toBe('b')
  })
})
