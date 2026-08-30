/**
 * The transcript reader's freshness layer — ONE mechanism that every surface
 * (review page, linked-session panel, refinement panel, the external-round
 * backfill) shares, so a session's history is fetched once and reused, never
 * re-fetched in a burst the moment several panels open or a poll overlaps a
 * reload. This is the root fix for 「评论区加载很久 / 有时加载不出来」:
 *
 *   - SINGLE-FLIGHT: concurrent reads of the same session join ONE in-flight
 *     request (the burst when the review + its rail + the meter all mount).
 *   - SHORT TTL CACHE: a just-loaded tail is served from memory, so the light
 *     3s poll and an open-time reload do not stack duplicate RPCs; a stale
 *     entry is refreshed on the next read (the tail is always converging).
 *   - TIMEOUT: a hung history RPC (a big session over a flaky mobile link)
 *     can never leave a surface spinning forever — it resolves undefined at
 *     the deadline, so the caller shows its honest 「暂不可用 · 重试」 instead.
 *
 * Failures are NEVER cached (the next read retries); successes replace the
 * in-flight slot. The raw reader is injected, so this is pure and unit-tested.
 */

/** A cached entry: the in-flight promise, and the settled value once present. */
interface CacheEntry<T> {
  promise: Promise<T | undefined>
  value?: T
  settledAt: number
}

export interface TranscriptReaderDeps<T> {
  /** The raw read (the host history RPC). May reject or hang. */
  read(sessionId: string): Promise<T | undefined>
  /** Cancelling deferrer (the wiring: setTimeout/clearTimeout). */
  defer(fn: () => void, ms: number): () => void
  now?: () => number
  /** A settled value younger than this is served straight from cache. */
  ttlMs?: number
  /** A read older than this resolves undefined (the caller shows + retries). */
  timeoutMs?: number
}

export const TRANSCRIPT_TTL_MS = 1_200
export const TRANSCRIPT_TIMEOUT_MS = 8_000

/**
 * Build a single-flight, TTL-cached, timeout-bounded reader keyed by session
 * id. The returned function never rejects: it resolves the value or undefined.
 */
export function createTranscriptReader<T>(deps: TranscriptReaderDeps<T>): (sessionId: string) => Promise<T | undefined> {
  const cache = new Map<string, CacheEntry<T>>()
  const now = deps.now ?? ((): number => Date.now())
  const ttlMs = deps.ttlMs ?? TRANSCRIPT_TTL_MS
  const timeoutMs = deps.timeoutMs ?? TRANSCRIPT_TIMEOUT_MS

  return (sessionId: string): Promise<T | undefined> => {
    const existing = cache.get(sessionId)
    if (existing !== undefined) {
      // A fresh settled value is served from memory (no RPC).
      if (existing.value !== undefined && now() - existing.settledAt < ttlMs) {
        return Promise.resolve(existing.value)
      }
      // A load is in flight (no value yet): join it, do not stack a second RPC.
      if (existing.value === undefined) {
        return existing.promise
      }
      // Stale value: fall through and start a fresh flight (the old value stays
      // visible to the caller until this one settles — no flicker to empty).
    }

    let settleTimeout: (() => void) | undefined
    const flight = new Promise<T | undefined>(resolve => {
      let done = false
      const finish = (value: T | undefined): void => {
        if (done) return
        done = true
        settleTimeout?.()
        resolve(value)
      }
      // Bound the raw read by the deadline; a hang resolves undefined (never a
      // forever-spinner), and a rejection degrades to undefined too.
      settleTimeout = deps.defer(() => finish(undefined), timeoutMs)
      void deps.read(sessionId).then(
        value => finish(value),
        () => finish(undefined),
      )
    })

    const entry: CacheEntry<T> = { promise: flight, settledAt: now() }
    cache.set(sessionId, entry)
    void flight.then(value => {
      // Only record into the slot we still own (a newer flight may have
      // replaced it); a failure clears the cache so the next read retries.
      if (cache.get(sessionId) !== entry) return
      if (value === undefined) cache.delete(sessionId)
      else {
        entry.value = value
        entry.settledAt = now()
      }
    })
    return flight
  }
}
