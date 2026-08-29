/**
 * Board data service (host half): the ONE authoritative board document every
 * browser replica syncs against, plus the two arbitrations multi-device
 * correctness needs — the engine lease and the launch-command relay.
 *
 * The document persists through the platform storage hub's `json` backend
 * (one human-readable file under the harness home's storage root, atomic
 * whole-file rewrites, durable before ack). The hub is read structurally
 * (`ctx.get('storage')`) exactly like every other host route reads its
 * service: when the deployment composes no storage hub, or the medium fails
 * to open, the service reports `available:false` and the browser half falls
 * back to its localStorage mode — a degraded board, never a broken one.
 *
 * The engine lease: exactly one browser drives time-based automation
 * (scheduler ticks, the dispatch pump, reconciliation, external-turn
 * recording). Any board API call from the current holder renews the lease
 * (background-tab timer throttling cannot starve a live holder), a dropped
 * SSE connection shortens it to a grace window, and expiry lets any other
 * replica take over within seconds.
 *
 * The command relay: a non-engine replica's user-initiated run travels to
 * the engine (one pump = one concurrency budget = no double launches). With
 * no live engine the request parks in a small deduped queue and replays when
 * the next lease is granted.
 */
import { applyCommit, emptyBoardDoc, normalizeBoardDoc } from '../core/board-doc.ts'
import type { BoardCommand, BoardCommit, BoardDoc, BoardEvent, LeaseState } from '../core/board-doc.ts'

// The wire types live in the shared core (the client sync layer reads the
// same shapes); re-exported here so host callers keep one import surface.
export type { BoardCommand, BoardEvent, LeaseState } from '../core/board-doc.ts'

/** Structural face of the storage hub's opened KV unit (no SDK import). */
export interface KvUnitLike {
  loadAll(): Promise<{ global: unknown }>
  setGlobal(value: unknown): Promise<void>
  close(): Promise<void>
}

/** Opens the board unit over the platform storage hub; undefined = no hub. */
export type KvUnitOpener = () => Promise<KvUnitLike | undefined>

/** The unit identity stamped on the medium (name must be file-safe: the
 * platform's UNIT_NAME_RE is `^[a-z][a-z0-9_]*$` — underscores, not hyphens). */
export const BOARD_UNIT_NAME = 'dsh_task_board'
/** The document grammar version this build reads and writes. */
export const BOARD_UNIT_VERSION = 1

/** Lease tuning: the client renews well inside the TTL; a dropped stream
 *  shortens the holder's lease to the grace window. */
export const LEASE_DEFAULT_TTL_MS = 20_000
export const LEASE_MIN_TTL_MS = 10_000
export const LEASE_MAX_TTL_MS = 60_000
export const LEASE_DISCONNECT_GRACE_MS = 5_000

/** The cap on parked launch commands (newest-per-task dedup keeps this small). */
export const PENDING_COMMAND_LIMIT = 20

/** One relayed user action lives in the shared core (see BoardCommand). */

/** Injectable seams (tests drive the service with fakes). */
export interface BoardServiceDeps {
  /** Clock; defaults to Date.now. */
  now?: () => number
  /** Opens the persistence unit; absent = persistence unavailable (fallback mode). */
  openUnit?: KvUnitOpener
  /** Diagnostic sink; defaults to console. */
  log?: (message: string, error?: unknown) => void
}

/**
 * The host-side board truth: document + lease + relay. Every mutation runs
 * on one serialized write lane (the storage domain's single-write-chain
 * discipline), so commits from many replicas interleave in arrival order and
 * the merge grammar resolves them.
 */
export class BoardDataService {
  private doc: BoardDoc = emptyBoardDoc(0)
  private unit: KvUnitLike | undefined
  private lease: { clientId: string; expiresAt: number; ttl: number } | undefined
  /** Live SSE connections per clientId. An open stream is the holder's
   *  liveness proof: unlike client timers it survives background-tab timer
   *  throttling, so the engine lease never flaps while its stream is up. */
  private readonly streams = new Map<string, number>()
  private pendingCommands = new Map<string, BoardCommand>()
  private readonly listeners = new Set<(event: BoardEvent) => void>()
  private lane: Promise<void> = Promise.resolve()
  private started = false
  private initPromise: Promise<void> | undefined
  private disposed = false

  /** Whether the board API serves synced documents (false = replica fallback). */
  available = false

  private readonly now: () => number
  private readonly log: (message: string, error?: unknown) => void

  constructor(private readonly deps: BoardServiceDeps = {}) {
    this.now = deps.now ?? (() => Date.now())
    this.log = deps.log ?? ((message, error) => (error === undefined ? console.error(message) : console.error(message, error)))
  }

  /**
   * Open the persistence unit and load the document. Failure to open or read
   * leaves the service unavailable (replicas fall back); a corrupt medium is
   * normalized, never fatal.
   */
  async init(): Promise<void> {
    if (this.started) return
    this.started = true
    if (this.deps.openUnit === undefined) {
      this.log('[dsh-task-board] board storage unavailable: no persistence opener wired')
      return
    }
    try {
      const unit = await this.deps.openUnit()
      if (unit === undefined) {
        this.log('[dsh-task-board] board storage unavailable: no json backend on the storage hub')
        return
      }
      this.unit = unit
      const snapshot = await unit.loadAll()
      this.doc = normalizeBoardDoc(snapshot.global, this.now())
      this.available = true
    } catch (error) {
      this.unit = undefined
      this.available = false
      this.log('[dsh-task-board] board storage open failed; replicas fall back to local mode', error)
    }
  }

  /**
   * The one-started gate every route call passes through: the storage hub is
   * resolved lazily (the opener reads `ctx.get('storage')` at call time), so
   * the first browser request — always after boot settlement — initializes
   * the unit, and every later call rides the settled result.
   */
  ensureInit(): Promise<void> {
    this.initPromise ??= this.init()
    return this.initPromise
  }

  /** The current authoritative document (detached reads are the caller's job). */
  getDoc(): BoardDoc {
    return this.doc
  }

  /**
   * Apply one replica commit through the merge grammar. The write lane
   * serializes commits; persistence completes before the response resolves
   * (durability before ack). A no-op commit never persists nor broadcasts.
   * @returns the authoritative document after the commit.
   */
  commit(commit: BoardCommit): Promise<BoardDoc> {
    return this.enqueue(async () => {
      const next = applyCommit(this.doc, commit, this.now())
      if (next === this.doc) return this.doc
      this.doc = next
      if (this.unit !== undefined) {
        try {
          await this.unit.setGlobal(next)
        } catch (error) {
          // Memory moved; the medium lags one commit. The board stays live
          // (the next commit persists both), and a restart replays from the
          // medium — the same durability trade the localStorage mode made.
          this.log('[dsh-task-board] board document persist failed (memory keeps serving)', error)
        }
      }
      this.broadcast({ type: 'commit', revision: next.revision, clientId: commit.clientId })
      return next
    })
  }

  /**
   * Acquire or renew the engine lease. Liveness is the leaseState view (an
   * open SSE stream or any board API call keeps the holder alive); a free or
   * expired lease is granted to the caller.
   */
  acquireLease(clientId: string, ttlMs?: number): LeaseState {
    const now = this.now()
    const ttl = clampLeaseTtl(ttlMs)
    const current = this.leaseState(now)
    if (current.held && current.holder !== clientId) {
      // Held (live stream or unexpired) by someone else: the caller is NOT the engine.
      return { held: false, holder: current.holder, expiresAt: current.expiresAt }
    }
    const renewing = current.held && current.holder === clientId
    this.lease = { clientId, expiresAt: now + ttl, ttl }
    if (!renewing) this.broadcast({ type: 'lease', holder: clientId, expiresAt: this.lease.expiresAt })
    this.drainPendingCommands()
    return this.leaseState(this.now())
  }

  /** Voluntary release (page teardown): frees the seat immediately. */
  releaseLease(clientId: string): LeaseState {
    if (this.lease?.clientId === clientId) {
      this.lease = undefined
      this.broadcast({ type: 'lease', holder: undefined, expiresAt: undefined })
    }
    return this.leaseState(this.now())
  }

  /** Any API touch from the holder renews the lease for its granted TTL
   *  (throttle-proof: every commit/get/lease call refreshes the seat). */
  noteActivity(clientId: string | undefined): void {
    if (clientId === undefined || this.lease === undefined || this.lease.clientId !== clientId) return
    this.lease = { ...this.lease, expiresAt: this.now() + this.lease.ttl }
  }

  /** An SSE connection dropped: retire its count; when the holder's last
   *  stream goes, shorten its lease to the grace window (a reload reopens the
   *  stream and keeps the seat; a closed tab yields it fast). */
  noteDisconnect(clientId: string | undefined): void {
    if (clientId === undefined || clientId === '') return
    const live = (this.streams.get(clientId) ?? 0) - 1
    if (live > 0) this.streams.set(clientId, live)
    else this.streams.delete(clientId)
    if (this.lease === undefined || this.lease.clientId !== clientId) return
    const graceUntil = this.now() + LEASE_DISCONNECT_GRACE_MS
    if (this.lease.expiresAt > graceUntil) {
      this.lease = { ...this.lease, expiresAt: graceUntil }
    }
  }

  /** The current lease state. A holder with a live SSE stream never expires
   *  (the stream is refreshed by the keep-alive writes; a dead one surfaces
   *  through noteDisconnect); an expired lease reads as free, holderless. */
  leaseState(now = this.now()): LeaseState {
    if (this.lease === undefined) {
      return { held: false, holder: undefined, expiresAt: undefined }
    }
    if ((this.streams.get(this.lease.clientId) ?? 0) > 0) {
      // Stream-alive renewal: push the deadline out so a throttled background
      // tab keeps the seat it legitimately holds.
      if (this.lease.expiresAt < now + this.lease.ttl) {
        this.lease = { ...this.lease, expiresAt: now + this.lease.ttl }
      }
      return { held: true, holder: this.lease.clientId, expiresAt: this.lease.expiresAt }
    }
    if (this.lease.expiresAt <= now) {
      return { held: false, holder: undefined, expiresAt: undefined }
    }
    return { held: true, holder: this.lease.clientId, expiresAt: this.lease.expiresAt }
  }

  /** An SSE connection for `clientId` opened (route layer, stream accepted). */
  noteStreamOpen(clientId: string | undefined): void {
    if (clientId === undefined || clientId === '') return
    this.streams.set(clientId, (this.streams.get(clientId) ?? 0) + 1)
  }

  /**
   * Relay one user-initiated launch to the engine. With a live engine the
   * command broadcasts immediately; otherwise it parks (newest per task) and
   * replays when the next lease is granted.
   */
  submitCommand(command: BoardCommand): { queued: boolean } {
    const now = this.now()
    const state = this.leaseState(now)
    if (!state.held) {
      this.parkCommand(command)
      return { queued: true }
    }
    this.broadcast({ type: 'command', command })
    return { queued: false }
  }

  /** Subscribe to board events (the SSE layer). @returns the disposer. */
  subscribe(listener: (event: BoardEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Drain the unit and stop serving. */
  async dispose(): Promise<void> {
    this.disposed = true
    this.listeners.clear()
    const unit = this.unit
    this.unit = undefined
    this.available = false
    if (unit !== undefined) {
      try {
        await unit.close()
      } catch (error) {
        this.log('[dsh-task-board] board storage close failed', error)
      }
    }
  }

  private parkCommand(command: BoardCommand): void {
    if (this.pendingCommands.size >= PENDING_COMMAND_LIMIT) {
      // Drop the oldest parked request (Map keeps insertion order).
      const oldest = this.pendingCommands.keys().next()
      if (!oldest.done) this.pendingCommands.delete(oldest.value)
    }
    this.pendingCommands.set(`${command.type}:${command.taskId}`, command)
  }

  private drainPendingCommands(): void {
    if (this.pendingCommands.size === 0) return
    const commands = [...this.pendingCommands.values()]
    this.pendingCommands.clear()
    for (const command of commands) this.broadcast({ type: 'command', command })
  }

  private broadcast(event: BoardEvent): void {
    if (this.disposed) return
    for (const listener of [...this.listeners]) {
      try {
        listener(event)
      } catch (error) {
        this.log('[dsh-task-board] board event listener failed', error)
      }
    }
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.lane.then(task)
    this.lane = run.then(() => undefined, () => undefined)
    return run
  }
}

/** Clamp the requested TTL into the safe band. */
export function clampLeaseTtl(ttlMs: number | undefined): number {
  if (typeof ttlMs !== 'number' || !Number.isFinite(ttlMs)) return LEASE_DEFAULT_TTL_MS
  return Math.min(LEASE_MAX_TTL_MS, Math.max(LEASE_MIN_TTL_MS, Math.floor(ttlMs)))
}

/**
 * Wire the service onto the platform storage hub: resolve `ctx.storage` at
 * open time (boot settlement has passed by the first browser request), take
 * the `json` backend's KV facet, and open the board unit. A missing hub or
 * backend yields undefined (the service then reports unavailable — fallback
 * mode, never a throw).
 */
export function storageHubOpener(storage: () => unknown): KvUnitOpener {
  return async () => {
    const hub = storage() as {
      backend?: { get?: (name: string) => { kv?: { open?: (descriptor: unknown) => Promise<KvUnitLike> } } | undefined }
    } | undefined
    const backend = hub?.backend?.get?.('json')
    const kv = backend?.kv
    if (kv?.open === undefined) return undefined
    return kv.open({ name: BOARD_UNIT_NAME, version: BOARD_UNIT_VERSION, tables: [], hasGlobal: true })
  }
}
