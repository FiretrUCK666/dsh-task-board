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
export interface TranscriptReaderDeps<T> {
    /** The raw read (the host history RPC). May reject or hang. */
    read(sessionId: string): Promise<T | undefined>;
    /** Cancelling deferrer (the wiring: setTimeout/clearTimeout). */
    defer(fn: () => void, ms: number): () => void;
    now?: () => number;
    /** A settled value younger than this is served straight from cache. */
    ttlMs?: number;
    /** A read older than this resolves undefined (the caller shows + retries). */
    timeoutMs?: number;
}
export declare const TRANSCRIPT_TTL_MS = 1200;
export declare const TRANSCRIPT_TIMEOUT_MS = 8000;
/**
 * Build a single-flight, TTL-cached, timeout-bounded reader keyed by session
 * id. The returned function never rejects: it resolves the value or undefined.
 */
export declare function createTranscriptReader<T>(deps: TranscriptReaderDeps<T>): (sessionId: string) => Promise<T | undefined>;
