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
export type BundleFreshness = 'unknown' | 'current' | 'stale'

/** The freshness view the board renders (stable object per state change). */
export interface BundleFreshnessView {
  /** The decision (see module doc). */
  state: BundleFreshness
  /** The version baked into the running bundle. */
  bundled: string
  /** The version the host reports (absent while unreadable). */
  host?: string
  /** True when a cache-busting reload was already attempted for this pair. */
  retried: boolean
}

/**
 * Decide freshness from the two version strings.
 * An unknown or empty host reading is never evidence — it reads as `unknown`
 * so a broken route can never trigger a reload loop or a false warning.
 * @param bundled - the version baked into the running bundle.
 * @param host - the version the host reports, when readable.
 * @returns the freshness decision.
 */
export function freshnessOf(bundled: string, host: string | undefined): BundleFreshness {
  if (host === undefined || host === '') return 'unknown'
  if (bundled === '' || bundled === 'unknown') return 'unknown'
  return host === bundled ? 'current' : 'stale'
}

/** The minimal storage face the reload guard needs (sessionStorage). */
export interface GuardStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Runtime seams (all injectable; the plugin passes the real ones). */
export interface BundleFreshnessDeps {
  /** The version baked into this bundle (package.json at build time). */
  bundled: string
  /** Read the host's served version; any failure resolves to undefined. */
  readHostVersion: () => Promise<string | undefined>
  /** Re-enter the boot graph with a cache-busting URL. */
  reload: () => void
  /** Per-tab guard storage (absent = the reload is never attempted twice). */
  storage?: GuardStorage
  /** Guard key prefix; the pair is appended so a NEW host version may retry. */
  guardPrefix?: string
}

/** The default guard prefix (one per plugin, never shared with other keys). */
const DEFAULT_GUARD_PREFIX = 'dsh.taskBoard.bundleReload.v1'

/**
 * The ONE way to re-enter the boot graph: navigate to the same document with a
 * cache-busting query parameter. The boot document carries the artifact
 * revision the browser then requests, so re-fetching the document (not merely
 * reloading a cached one) is what actually picks up a new bundle. The extra
 * parameter is inert for the shell's own auth (it reads `token`, and an
 * already-authenticated request is served straight from the cookie).
 */
export function reloadForFreshBundle(): void {
  const url = new URL(window.location.href)
  url.searchParams.set('_', String(Date.now()))
  window.location.replace(url.toString())
}

/**
 * The freshness state: probe once at boot, hold the verdict, reload at most
 * once per (bundled, host) pair, and let the board subscribe for display.
 */
export class BundleFreshnessState {
  private state: BundleFreshness = 'unknown'
  private host: string | undefined
  private retried = false
  private readonly listeners = new Set<() => void>()
  private readonly deps: BundleFreshnessDeps

  constructor(deps: BundleFreshnessDeps) {
    this.deps = deps
  }

  /** The current view (a fresh object every call — safe for React state). */
  snapshot(): BundleFreshnessView {
    return {
      state: this.state,
      bundled: this.deps.bundled,
      ...this.host !== undefined ? { host: this.host } : {},
      retried: this.retried,
    }
  }

  /** Subscribe to view changes; returns the disposer. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** The guard key for one pair (a new host version is allowed one retry). */
  private guardKey(): string {
    const prefix = this.deps.guardPrefix ?? DEFAULT_GUARD_PREFIX
    return `${prefix}:${this.deps.bundled}->${this.host ?? ''}`
  }

  /** Whether this pair already consumed its one reload. */
  private guarded(): boolean {
    const storage = this.deps.storage
    if (storage === undefined) return false
    try {
      return storage.getItem(this.guardKey()) === '1'
    } catch {
      // A storage-less or throwing tab simply loses the guard; the version
      // pair itself still bounds the behaviour (see probe()).
      return false
    }
  }

  /** Mark the pair as retried (best effort — the display never depends on it). */
  private markGuarded(): void {
    const storage = this.deps.storage
    if (storage === undefined) return
    try {
      storage.setItem(this.guardKey(), '1')
    } catch {
      // Ignore: persistence is an optimisation, not the policy.
    }
  }

  /**
   * Read the host's version once and act on the verdict. Never throws: an
   * unreadable route leaves the state `unknown` (the board then says nothing).
   * @returns the resulting view.
   */
  async probe(): Promise<BundleFreshnessView> {
    let host: string | undefined
    try {
      host = await this.deps.readHostVersion()
    } catch {
      host = undefined
    }
    this.host = host
    this.state = freshnessOf(this.deps.bundled, host)
    this.retried = this.state === 'stale' && this.guarded()
    this.emit()
    if (this.state === 'stale' && !this.retried) {
      this.markGuarded()
      this.retried = true
      this.emit()
      try {
        this.deps.reload()
      } catch {
        // A refused navigation (sandboxed frame, unloaded document) leaves the
        // warning on screen — the honest end state.
      }
    }
    return this.snapshot()
  }

  /** Notify subscribers (one tick, never re-entrant work). */
  private emit(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch (error) {
        console.error('[dsh-task-board] freshness listener failed', error)
      }
    }
  }
}
