/**
 * Stale-bundle detection: the ONE seam that closes the gap between "the host
 * is running the new build" and "the page in front of the user still renders
 * the old one".
 *
 * Why this exists. The browser half is served as an immutable, revisioned
 * artifact (`/plugins/??…&rev=<per-process nonce>`, `cache-control:
 * public, max-age=31536000, immutable`). A document that is already open keeps
 * the revision it booted with, so every rebuild plus host restart can look
 * like "nothing changed" for as long as that document lives — the server is
 * new, the pixels are old, and nothing in the UI ever says so. The host also
 * answers its own package version on an uncached API route, so the page can
 * compare what it is running against what the host is serving.
 *
 * The policy is one honest move, never a loop:
 *   - versions agree            → `current`
 *   - the host is unreadable    → `unknown` (never a false alarm)
 *   - they disagree             → `stale`: re-enter the boot graph ONCE with a
 *     cache-busting URL (the boot document carries the revision, so fetching it
 *     again is what actually picks up the new artifact), and if the same pair
 *     is seen again the guard holds and the board states the mismatch instead
 *     of reloading forever.
 *
 * Pure decision + an injectable runtime, so the whole policy is unit-testable
 * without a DOM.
 * @module dsh-task-board/client/bundle-freshness
 */
/** What the running page knows about its own freshness. */
export type BundleFreshness = 'unknown' | 'current' | 'stale';
/** The freshness view the board renders (stable object per state change). */
export interface BundleFreshnessView {
    /** The decision (see module doc). */
    state: BundleFreshness;
    /** The version baked into the running bundle. */
    bundled: string;
    /** The version the host reports (absent while unreadable). */
    host?: string;
    /** True when a cache-busting reload was already attempted for this pair. */
    retried: boolean;
}
/**
 * Decide freshness from the two version strings.
 * An unknown or empty host reading is never evidence — it reads as `unknown`
 * so a broken route can never trigger a reload loop or a false warning.
 * @param bundled - the version baked into the running bundle.
 * @param host - the version the host reports, when readable.
 * @returns the freshness decision.
 */
export declare function freshnessOf(bundled: string, host: string | undefined): BundleFreshness;
/** The minimal storage face the reload guard needs (sessionStorage). */
export interface GuardStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}
/** Runtime seams (all injectable; the plugin passes the real ones). */
export interface BundleFreshnessDeps {
    /** The version baked into this bundle (package.json at build time). */
    bundled: string;
    /** Read the host's served version; any failure resolves to undefined. */
    readHostVersion: () => Promise<string | undefined>;
    /** Re-enter the boot graph with a cache-busting URL. */
    reload: () => void;
    /** Per-tab guard storage (absent = the reload is never attempted twice). */
    storage?: GuardStorage;
    /** Guard key prefix; the pair is appended so a NEW host version may retry. */
    guardPrefix?: string;
}
/**
 * The ONE way to re-enter the boot graph: navigate to the same document with a
 * cache-busting query parameter. The boot document carries the artifact
 * revision the browser then requests, so re-fetching the document (not merely
 * reloading a cached one) is what actually picks up a new bundle. The extra
 * parameter is inert for the shell's own auth (it reads `token`, and an
 * already-authenticated request is served straight from the cookie).
 */
export declare function reloadForFreshBundle(): void;
/**
 * The freshness state: probe once at boot, hold the verdict, reload at most
 * once per (bundled, host) pair, and let the board subscribe for display.
 */
export declare class BundleFreshnessState {
    private state;
    private host;
    private retried;
    private readonly listeners;
    private readonly deps;
    constructor(deps: BundleFreshnessDeps);
    /** The current view (a fresh object every call — safe for React state). */
    snapshot(): BundleFreshnessView;
    /** Subscribe to view changes; returns the disposer. */
    subscribe(listener: () => void): () => void;
    /** The guard key for one pair (a new host version is allowed one retry). */
    private guardKey;
    /** Whether this pair already consumed its one reload. */
    private guarded;
    /** Mark the pair as retried (best effort — the display never depends on it). */
    private markGuarded;
    /**
     * Read the host's version once and act on the verdict. Never throws: an
     * unreadable route leaves the state `unknown` (the board then says nothing).
     * @returns the resulting view.
     */
    probe(): Promise<BundleFreshnessView>;
    /** Notify subscribers (one tick, never re-entrant work). */
    private emit;
}
