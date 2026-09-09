/**
 * Board sync client (browser half): makes this tab an optimistic replica of
 * the host-owned board document.
 *
 * Responsibilities (and nothing else):
 * - boot: fetch the authoritative document (a few retries; persistent
 *   failure or an unavailable host yields `unavailable` — the wiring then
 *   keeps the plain localStorage mode, so the board never depends on this
 *   path to exist);
 * - migration: an empty host document plus a non-empty local ledger uploads
 *   the ledger once (bootstrap); a non-empty host with a diverging local
 *   ledger keeps the host truth and hands the local copy to the backup sink
 *   (nothing is ever silently dropped);
 * - commit: every local change marks the view dirty and a debounced,
 *   serialized lane posts the full view + observed deletions; the response
 *   is the authoritative document, so every replica converges on it (the
 *   merge grammar lives in board-doc.ts, not here);
 * - watch: the SSE change stream drives coalesced resyncs, lease events
 *   drive engine state, command frames reach the engine only; a slow poll
 *   and every stream reopen resync as the safety net (SSE loss — proxies,
 *   mobile backgrounding — degrades latency, never correctness);
 * - lease: one heartbeat renews (or takes) the engine lease; `onEngine`
 *   tells the wiring when to start/stop the scheduler and gate the pump.
 *
 * Framework-free: all transport, clocks and timers are injected faces, so
 * tests drive every path without a browser or a server.
 */
import type { BoardDoc, BoardView } from './board-doc.ts'
import { boardViewOf, changedIdsOf, diffDeletions, emptyBoardDoc, normalizeWipLimits, DEFAULT_CRUISE_VALUE } from './board-doc.ts'
import type {
  BoardCommit,
  BoardCommand,
  BoardEvent,
  BoardSection,
  CruiseValue,
  LeaseWire,
} from './board-doc.ts'
import type { RunPresetStore, RunPresetsDocument } from './run-presets.ts'
import type { PresetStore, SchedulePreset } from './presets.ts'
import type { TaskRecord } from './tasks.ts'
import type { TaskStore } from './store.ts'

/** The fetch/commit answer shape the transport surfaces from the board route. */
export interface SyncFetchResult {
  available: boolean
  revision: number
  doc?: BoardDoc
  unchanged?: boolean
}

/** The board-route transport (the wiring implements it with fetch + EventSource). */
export interface BoardSyncTransport {
  fetch(clientId: string, since: number | undefined): Promise<SyncFetchResult | undefined>
  commit(commit: BoardCommit): Promise<SyncFetchResult | undefined>
  lease(clientId: string, options: { ttlMs?: number; release?: boolean; active?: boolean }): Promise<LeaseWire | undefined>
  command(clientId: string, command: BoardCommand): Promise<void>
  /** Open the SSE change stream for this replica; the returned disposer closes it. */
  openStream(clientId: string, handlers: {
    onEvent(event: BoardEvent): void
    onOpen(): void
  }): () => void
}

export type SyncMode = 'synced' | 'unavailable'

/** Everything injectable (tests drive all of it with fakes). */
export interface BoardSyncDeps {
  transport: BoardSyncTransport
  /** Cancelling deferrer (the wiring: setTimeout/clearTimeout). */
  defer(fn: () => void, ms: number): () => void
  now?: () => number
  uuid?: () => string
  /** Commit coalescing window. */
  commitDebounceMs?: number
  /** Engine-lease TTL and renewal cadence. */
  leaseTtlMs?: number
  leaseRenewMs?: number
  /** Safety-net resync cadence (SSE is the fast path). */
  pollMs?: number
  /** Remote-change coalescing before a resync fetch. */
  resyncCoalesceMs?: number
  /** Tab visibility (the browser wiring): drives the engine-lease `active`
   *  flag and an immediate resync/lease-take when the tab returns to the
   *  foreground (a woken viewer becomes the engine at once, a woken engine
   *  catches up on turns recorded while it was frozen). Absent = always
   *  visible (tests, non-browser hosts). */
  visibility?: {
    is(): boolean
    onVisible(cb: () => void): () => void
    onHidden(cb: () => void): () => void
  }
  log?: (message: string, error?: unknown) => void
}

/** The dirty sections of the local view (absent = identical to baseline). */
interface DirtyState {
  tasks?: readonly TaskRecord[]
  cruise?: BoardSection<CruiseValue>
  schedulePresets?: BoardSection<SchedulePreset[]>
  runPresets?: BoardSection<RunPresetsDocument>
}

/** Default empty document for a client that never synced (fallback mode). */
function emptyBaseline(now: number): BoardDoc {
  return emptyBoardDoc(now)
}

/** Whether a legacy view carries anything worth migrating (defaults alone do not).
 *  WIP rides the same normalization as reads, so a meaningless empty object
 *  never counts as content (no phantom bootstrap). The cruise default rides
 *  THE shared default value, never a retyped literal. */
function hasLegacyContent(view: BoardView): boolean {
  return view.tasks.length > 0
    || view.cruise.enabled === true
    || view.cruise.manual !== undefined
    || view.cruise.schedule.length > 0
    || view.cruise.limit !== DEFAULT_CRUISE_VALUE.limit
    || normalizeWipLimits(view.cruise.wip) !== undefined
    || view.schedulePresets.length > 0
    || view.runPresets.presets.length > 0
    || view.runPresets.defaultId !== undefined
}

export class BoardSyncClient {
  /** Identity of this tab for lease/relay purposes (stable per instance). */
  readonly clientId: string

  private mode: SyncMode = 'unavailable'
  private baseline: BoardDoc
  private dirty: DirtyState = {}
  /** The snapshot currently in flight (identity-compared on ack). */
  private inFlight: DirtyState | undefined
  /** Authorship claims accrued since the last fully-acked commit (see setTasks). */
  private readonly claims = new Set<string>()
  private refire = false
  /** The host's lease protocol version. undefined = this replica has NEVER
   *  read a lease — "no evidence yet" must never be reported as "old host"
   *  (a failed first probe would otherwise flash a false stale banner). */
  private hostLeaseProto: number | undefined = undefined
  /** When the answering host process booted (undefined = never read). */
  private hostBoot: number | undefined = undefined
  private engine = false
  private disposed = false
  private commitCancel: (() => void) | undefined
  private resyncCancel: (() => void) | undefined
  private readonly loopCancels: Array<() => void> = []
  private remoteListener: ((view: BoardView, revision: number) => void) | undefined
  private engineListener: ((held: boolean) => void) | undefined
  private commandListener: ((command: BoardCommand) => void) | undefined
  private backupListener: ((view: BoardView) => void) | undefined

  private readonly now: () => number
  private readonly defer: (fn: () => void, ms: number) => () => void
  private readonly commitDebounceMs: number
  private readonly leaseTtlMs: number
  private readonly leaseRenewMs: number
  private readonly pollMs: number
  private readonly resyncCoalesceMs: number
  private readonly log: (message: string, error?: unknown) => void

  constructor(private readonly deps: BoardSyncDeps) {
    this.now = deps.now ?? (() => Date.now())
    this.defer = deps.defer
    this.clientId = deps.uuid?.() ?? `tab-${Math.random().toString(36).slice(2, 12)}`
    this.commitDebounceMs = deps.commitDebounceMs ?? 250
    this.leaseTtlMs = deps.leaseTtlMs ?? 20_000
    this.leaseRenewMs = deps.leaseRenewMs ?? 7_000
    this.pollMs = deps.pollMs ?? 30_000
    this.resyncCoalesceMs = deps.resyncCoalesceMs ?? 120
    this.log = deps.log ?? ((message, error) => (error === undefined ? console.error(message) : console.error(message, error)))
    this.baseline = emptyBaseline(this.now())
  }

  // --- lifecycle -------------------------------------------------------------

  /**
   * Fetch the authoritative document (bounded retries), run the migration
   * probe, then wire the watch/lease/poll loops.
   * @param legacy - reads the pre-sync local view (localStorage); when the
   *   host document is still empty it is uploaded as the initial commit,
   *   otherwise the host truth wins and the local copy goes to `onBackup`.
   * @returns the mode this client settled into.
   */
  async start(legacy?: () => BoardView | undefined): Promise<SyncMode> {
    for (let attempt = 0; attempt < 3 && this.mode !== 'synced'; attempt++) {
      const result = await this.deps.transport.fetch(this.clientId, undefined).catch(() => undefined)
      if (result !== undefined && result.available && result.doc !== undefined) {
        this.baseline = result.doc
        this.mode = 'synced'
        break
      }
      if (attempt < 2) await new Promise<void>(resolve => this.defer(resolve, 400))
    }
    // fetch settled: the mode this client settled into
    if (this.mode !== 'synced') return 'unavailable'
    if (this.disposed) return this.mode
    const legacyView = legacy?.()
    if (legacyView !== undefined && hasLegacyContent(legacyView)) {
      // One-time migration of a pre-sync local ledger into the shared truth.
      // Tasks UNION (per-record LWW): a device's locally-created records join
      // the host even when another device bootstrapped first — nothing a user
      // ever made is hidden behind "first origin wins". Absence is never a
      // delete, so host rows a replica lacks always survive. Shared sections
      // (cruise/presets) belong to the FIRST writer (config is single-valued;
      // a late device's stale defaults must not stomp a live setup), and the
      // full local view is parked to the backup sink for forensics whenever
      // it actually diverged.
      const at = this.now()
      const hostIds = new Map(this.baseline.tasks.map(task => [task.id, task]))
      const tasksIdentical = legacyView.tasks.length === this.baseline.tasks.length
        && legacyView.tasks.every(task => hostIds.get(task.id)?.updatedAt === task.updatedAt)
      // Sections are single-valued: any local non-default that differs from
      // the host is a divergence worth backing up (the old probe only looked
      // at tasks, so a late device's edited cruise/presets vanished silently).
      const hostView = boardViewOf(this.baseline)
      const sectionsIdentical = JSON.stringify({
        cruise: legacyView.cruise,
        schedulePresets: legacyView.schedulePresets,
        runPresets: legacyView.runPresets,
      }) === JSON.stringify({
        cruise: hostView.cruise,
        schedulePresets: hostView.schedulePresets,
        runPresets: hostView.runPresets,
      })
      const identical = tasksIdentical && sectionsIdentical
      if (!identical) {
        if (this.baseline.revision === 0) {
          this.dirty = {
            tasks: legacyView.tasks,
            cruise: { value: legacyView.cruise, at },
            schedulePresets: { value: legacyView.schedulePresets, at },
            runPresets: { value: legacyView.runPresets, at },
          }
        } else {
          const merged = new Map(hostIds)
          for (const task of legacyView.tasks) {
            const host = merged.get(task.id)
            if (host === undefined || task.updatedAt > host.updatedAt) merged.set(task.id, task)
          }
          this.dirty = { tasks: [...merged.values()] }
          this.backupListener?.(legacyView)
        }
        await this.flush()
      }
    }
    this.loopCancels.push(this.deps.transport.openStream(this.clientId, {
      onEvent: event => this.onStreamEvent(event),
      onOpen: () => {
        this.streamOpens += 1
        this.lastFrameAt = this.now()
        this.log(`[dsh-task-board] stream open #${this.streamOpens}`)
        this.scheduleResync()
        void this.renewLease()
      },
    }))
    this.loopCancels.push(this.every(this.leaseRenewMs, () => this.renewLease()))
    this.loopCancels.push(this.every(this.pollMs, () => this.poll()))
    // Foreground/background transitions act IMMEDIATELY in both directions:
    // - visible: take/keep the seat and catch up NOW (the heartbeat/poll
    //   cadences would otherwise leave a woken tab staring at a stale board —
    //   the "点了没反应，刷新才好" stall);
    // - hidden: hand the active flag over at once. A frozen tab cannot renew
    //   anything, so without this the host keeps a last-known-active:true
    //   holder that no visible replica may preempt — the "行亮着、卡片永远不
    //   动、排队永远不发" zombie-seat machine.
    if (this.deps.visibility !== undefined) {
      const visibility = this.deps.visibility
      this.loopCancels.push(visibility.onVisible(() => {
        void this.renewLease()
        void this.poll()
      }))
      this.loopCancels.push(visibility.onHidden(() => {
        void this.deps.transport.lease(this.clientId, { ttlMs: this.leaseTtlMs, active: false }).catch(() => undefined)
      }))
    }
    // The first lease probe is part of starting: by the time the wiring is
    // told "synced", the engine state of this tab is already known.
    await this.renewLease()
    return this.mode
  }

  /** Stop every loop, close the stream, release the lease best-effort. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.commitCancel?.()
    this.resyncCancel?.()
    for (const cancel of this.loopCancels.splice(0)) cancel()
    if (this.mode === 'synced') {
      void this.deps.transport.lease(this.clientId, { release: true }).catch(() => undefined)
    }
    this.remoteListener = undefined
    this.engineListener = undefined
    this.commandListener = undefined
    this.backupListener = undefined
  }

  getMode(): SyncMode {
    return this.mode
  }

  /** Whether the host truth is adopted (false before/during boot and in
   *  fallback mode). Store seams read the offline mirror while false, so the
   *  board mounts on local data instantly and converges when the line allows —
   *  the entry never waits on the network. */
  isSynced(): boolean {
    return this.mode === 'synced'
  }

  isEngine(): boolean {
    return this.engine
  }

  // --- replica reads -----------------------------------------------------------

  /** The effective local view: baseline overlaid with un-acked dirty state. */
  view(): BoardView {
    const base = boardViewOf(this.baseline)
    if (this.dirty.tasks === undefined && this.dirty.cruise === undefined
      && this.dirty.schedulePresets === undefined && this.dirty.runPresets === undefined) {
      return base
    }
    return {
      tasks: (this.dirty.tasks ?? base.tasks) as TaskRecord[],
      cruise: this.dirty.cruise?.value ?? base.cruise,
      schedulePresets: this.dirty.schedulePresets?.value ?? base.schedulePresets,
      runPresets: this.dirty.runPresets?.value ?? base.runPresets,
    }
  }

  baselineRevision(): number {
    return this.baseline.revision
  }

  // --- replica writes (the store seams call these) ------------------------------

  setTasks(tasks: readonly TaskRecord[]): void {
    if (this.dirty.tasks === tasks) return
    // Authorship accrual: claim exactly the rows THIS edit moved against the
    // view the replica was serving (its own controller's ledger source), not
    // against a baseline remote frames may have advanced since — a
    // remote-updated row an untouched snapshot still carries is never claimed,
    // so a stale full array can never clobber a newer remote edit (the
    // claim-then-revert trap). Dropped rows shed their claim (they become
    // deletions, carried by the explicit deleted list).
    const previous = this.view().tasks
    for (const id of changedIdsOf(previous, tasks)) this.claims.add(id)
    const kept = new Set(tasks.map(task => task.id))
    for (const id of [...this.claims]) {
      if (!kept.has(id)) this.claims.delete(id)
    }
    this.dirty.tasks = tasks
    this.scheduleCommit()
  }

  setCruise(value: CruiseValue): void {
    this.dirty.cruise = { value, at: this.now() }
    this.scheduleCommit()
  }

  setSchedulePresets(value: SchedulePreset[]): void {
    this.dirty.schedulePresets = { value, at: this.now() }
    this.scheduleCommit()
  }

  setRunPresets(value: RunPresetsDocument): void {
    this.dirty.runPresets = { value, at: this.now() }
    this.scheduleCommit()
  }

  /** Relay one user-initiated launch to the engine (non-engine replicas). */
  requestLaunch(taskId: string, trigger: 'manual' | 'schedule' | 'chain'): void {
    void this.deps.transport
      .command(this.clientId, { type: 'run', taskId, trigger, clientId: this.clientId })
      .catch(error => this.log('[dsh-task-board] launch relay failed', error))
  }

  // --- listeners (one each; the wiring owns fan-out) ----------------------------

  onRemote(listener: (view: BoardView, revision: number) => void): void {
    this.remoteListener = listener
  }

  /** Fires whenever the SEAT changes — either half of it: which replica
   *  holds the engine, or the host's lease protocol version (a host restart
   *  flips the protocol without flipping the seat; the listener re-reads
   *  `hostProtoVersion()` alongside the held flag). */
  onEngine(listener: (held: boolean) => void): void {
    this.engineListener = listener
  }

  onCommand(listener: (command: BoardCommand) => void): void {
    this.commandListener = listener
  }

  onBackup(listener: (view: BoardView) => void): void {
    this.backupListener = listener
  }

  // --- internals ------------------------------------------------------------

  /** Stream health (diagnostic only): opens, remote frames, last frame time.
   *  A stream that opened but never delivers is the classic tunnel/proxy kill
   *  — the poll loop below calls it out instead of letting "no sync" stay a
   *  mystery. */
  private streamOpens = 0
  private streamFrames = 0
  private lastFrameAt = 0
  private streamDeathNoted = false

  private onStreamEvent(event: BoardEvent): void {
    if (this.disposed) return
    this.streamFrames += 1
    this.lastFrameAt = this.now()
    this.streamDeathNoted = false
    if (event.type === 'commit') {
      // Own commits arrive via the response; remote ones need a resync.
      if (event.clientId !== this.clientId) this.scheduleResync()
      return
    }
    if (event.type === 'lease') {
      if (event.holder === undefined) {
        void this.renewLease() // the seat is free: take it now, not next heartbeat
      } else if (event.holder !== this.clientId) {
        this.setEngine(false)
      }
      return
    }
    if (event.type === 'command') {
      if (this.engine) this.commandListener?.(event.command)
    }
  }

  private scheduleCommit(): void {
    if (this.mode !== 'synced' || this.disposed) return
    this.commitCancel?.()
    this.commitCancel = this.defer(() => {
      this.commitCancel = undefined
      void this.flush()
    }, this.commitDebounceMs)
  }

  /** Send the current dirty view (one in flight at a time, trailing refire). */
  async flush(): Promise<void> {
    if (this.mode !== 'synced' || this.disposed) return
    if (this.inFlight !== undefined) {
      this.refire = true
      return
    }
    const tasks = this.dirty.tasks ?? this.baseline.tasks
    const snapshot: DirtyState = {}
    if (this.dirty.tasks !== undefined) snapshot.tasks = this.dirty.tasks
    if (this.dirty.cruise !== undefined) snapshot.cruise = this.dirty.cruise
    if (this.dirty.schedulePresets !== undefined) snapshot.schedulePresets = this.dirty.schedulePresets
    if (this.dirty.runPresets !== undefined) snapshot.runPresets = this.dirty.runPresets
    const commit: BoardCommit = {
      clientId: this.clientId,
      tasks,
      // The accrued authorship claims (see setTasks): the host takes these
      // unconditionally (its serial order decides — client clocks are
      // irrelevant); everything else in the array merges under LWW.
      changed: [...this.claims],
      // Section authorship: only the sections this replica edited ride the
      // commit as claims (host-clock accepted); the baseline copies carried
      // below are then SKIPPED by the merge, never clobber a newer write.
      sectionClaims: [
        ...this.dirty.cruise !== undefined ? ['cruise' as const] : [],
        ...this.dirty.schedulePresets !== undefined ? ['schedulePresets' as const] : [],
        ...this.dirty.runPresets !== undefined ? ['runPresets' as const] : [],
      ],
      deleted: diffDeletions(this.baseline.tasks, tasks),
      cruise: this.dirty.cruise ?? this.baseline.cruise,
      schedulePresets: this.dirty.schedulePresets ?? this.baseline.schedulePresets,
      runPresets: this.dirty.runPresets ?? this.baseline.runPresets,
    }
    this.inFlight = snapshot
    // Named commit diagnostics (permanent): every "toggled but nothing
    // happened / refresh reverted" dispute ends here — what rode the commit,
    // how big it was, and whether the host acked. Failures keep the
    // retry-once discipline below; they just stop being silent.
    const sectionNames = [
      ...snapshot.tasks !== undefined ? ['tasks'] : [],
      ...snapshot.cruise !== undefined ? ['cruise'] : [],
      ...snapshot.schedulePresets !== undefined ? ['schedulePresets'] : [],
      ...snapshot.runPresets !== undefined ? ['runPresets'] : [],
    ]
    let commitBytes = 0
    try {
      commitBytes = JSON.stringify(commit).length
    } catch {
      commitBytes = -1
    }
    this.log(`[dsh-task-board] commit send sections=${sectionNames.join(',') || 'none'} bytes=${commitBytes}`)
    const result = await this.deps.transport.commit(commit).catch((error: unknown) => {
      this.log('[dsh-task-board] commit transport failed', error)
      return undefined
    })
    this.inFlight = undefined
    if (result === undefined || !result.available || result.doc === undefined) {
      this.log('[dsh-task-board] commit not acked (keeping dirty state, one retry scheduled)')
      // Keep the dirty state; retry once after a beat (the poll/SSE are the
      // backstop, so a lost retry only delays convergence).
      this.commitCancel = this.defer(() => {
        this.commitCancel = undefined
        void this.flush()
      }, 2_000)
      return
    }
    this.log(`[dsh-task-board] commit acked revision=${result.doc.revision}`)
    this.adopt(result.doc)
    if (snapshot.tasks !== undefined && this.dirty.tasks === snapshot.tasks) delete this.dirty.tasks
    if (snapshot.cruise !== undefined && this.dirty.cruise === snapshot.cruise) delete this.dirty.cruise
    if (snapshot.schedulePresets !== undefined && this.dirty.schedulePresets === snapshot.schedulePresets) delete this.dirty.schedulePresets
    if (snapshot.runPresets !== undefined && this.dirty.runPresets === snapshot.runPresets) delete this.dirty.runPresets
    // The ledger layer is fully acknowledged: the host has every claim it was
    // sent, so authorship state resets (the next claim accrues from here).
    if (this.dirty.tasks === undefined) this.claims.clear()
    const refire = this.refire
    this.refire = false
    if (refire || this.dirty.tasks !== undefined || this.dirty.cruise !== undefined
      || this.dirty.schedulePresets !== undefined || this.dirty.runPresets !== undefined) {
      this.scheduleCommit()
    }
  }

  /** Adopt an authoritative document (never backwards) and notify the replica. */
  private adopt(doc: BoardDoc): void {
    if (doc.revision < this.baseline.revision) return
    if (doc === this.baseline) return
    this.baseline = doc
    this.remoteListener?.(this.view(), doc.revision)
  }

  /** Coalesced resync after a remote-change frame. */
  private scheduleResync(): void {
    if (this.resyncCancel !== undefined) return
    this.resyncCancel = this.defer(() => {
      this.resyncCancel = undefined
      void this.poll()
    }, this.resyncCoalesceMs)
  }

  /** Fetch only when the host revision moved past the baseline. */
  async poll(): Promise<void> {
    if (this.mode !== 'synced' || this.disposed) return
    // Stream-death witness: opened but silent far past the poll cadence means
    // the live channel is dead and only this poll converges (note once per
    // silence so the console stays readable; any frame re-arms).
    if (this.streamOpens > 0 && !this.streamDeathNoted
      && this.now() - this.lastFrameAt > Math.max(this.pollMs * 2, 30_000)) {
      this.streamDeathNoted = true
      this.log(`[dsh-task-board] stream suspected dead (opens=${this.streamOpens} frames=${this.streamFrames}, converging by poll)`)
    }
    const result = await this.deps.transport.fetch(this.clientId, this.baseline.revision).catch(() => undefined)
    if (result === undefined) {
      this.log('[dsh-task-board] board resync failed (keeping the last known truth)')
      return
    }
    if (!result.available || result.unchanged || result.doc === undefined) return
    this.adopt(result.doc)
  }

  /** Renew (or take) the engine lease; publish SEAT changes (held AND the
   *  host's protocol version — a host restart changes only the latter). The
   *  request carries this tab's VISIBILITY — the host lets a visible replica
   *  preempt a hidden holder, so the engine always sits where the user is. */
  async renewLease(): Promise<void> {
    if (this.mode !== 'synced' || this.disposed) return
    const state = await this.deps.transport
      .lease(this.clientId, { ttlMs: this.leaseTtlMs, active: this.deps.visibility?.is() ?? true })
      .catch(() => undefined)
    if (state === undefined) return
    // A host without the lease protocol version predates visibility
    // preemption: the seat can be stuck on a frozen device and NO client can
    // take it. Remember that so the board can say so out loud instead of
    // leaving the user to guess why queued work never moves.
    const proto = typeof state.proto === 'number' ? state.proto : 1
    const bootedAt = typeof state.bootedAt === 'number' && Number.isFinite(state.bootedAt) ? state.bootedAt : undefined
    // Announce on ANY half of the seat moving: who holds it, the host's
    // protocol, or which host process is answering. Notifying only on a held
    // change is how a restarted host stayed "stale" on every viewer until a
    // manual refresh — the protocol moved, nobody was told.
    const changed = this.engine !== state.held || this.hostLeaseProto !== proto || this.hostBoot !== bootedAt
    this.hostLeaseProto = proto
    this.hostBoot = bootedAt
    this.engine = state.held
    if (changed) this.engineListener?.(state.held)
  }

  /** The host's engine-lease protocol (1 = pre-visibility, 2 = preemption);
   *  undefined until the first lease read — "not yet known" is not "old". */
  hostProtoVersion(): number | undefined {
    return this.hostLeaseProto
  }

  /** When the answering host process booted; undefined until the first lease
   *  read. The stale-host dialog shows it so "我明明重启了" is settled by a
   *  clock reading (old process vs. a different instance behind the URL). */
  hostBootTime(): number | undefined {
    return this.hostBoot
  }

  /** Yield the seat on a lease frame (the protocol cannot change there —
   *  only the held flag is announced). */
  private setEngine(held: boolean): void {
    if (this.engine === held) return
    this.engine = held
    this.engineListener?.(held)
  }

  /** A self-rescheduling loop (first step after `ms`; cancel stops it). */
  private every(ms: number, step: () => void | Promise<void>): () => void {
    let alive = true
    let cancel: (() => void) | undefined
    const tick = async (): Promise<void> => {
      if (!alive) return
      try {
        await step()
      } catch (error) {
        this.log('[dsh-task-board] board sync loop failed', error)
      }
      if (!alive) return
      cancel = this.defer(() => { void tick() }, ms)
    }
    cancel = this.defer(() => { void tick() }, ms)
    return () => {
      alive = false
      cancel?.()
    }
  }
}

// --- store seams over the synced document ---------------------------------
//
// The controller and the preset managers consume synchronous stores (the
// localStorage shape). These adapters keep that contract EXACTLY (load is
// synchronous — it returns the replica's current view; save marks the
// matching section dirty and the debounced commit lane persists) while an
// optional mirror backend keeps the local localStorage keys warm as the
// offline first-paint cache. The keys themselves never change.

/** The slice of the sync client the adapters use (easy to fake in tests). */
export interface SyncLedger {
  /** Whether the host truth is adopted (see {@link BoardSyncClient.isSynced}). */
  isSynced(): boolean
  view(): BoardView
  setTasks(tasks: readonly TaskRecord[]): void
  setCruise(value: CruiseValue): void
  setSchedulePresets(value: SchedulePreset[]): void
  setRunPresets(value: RunPresetsDocument): void
}

/** TaskStore over the synced document (+ optional warm mirror). Reads take
 *  the offline mirror until the host truth is adopted, so first paint never
 *  waits on the network; writes always warm the mirror AND mark the synced
 *  view dirty (a pre-sync write rides the boot migration via the mirror). */
export class SyncedTaskStore implements TaskStore {
  constructor(
    private readonly sync: SyncLedger,
    private readonly mirror?: TaskStore,
  ) {}

  load(): TaskRecord[] {
    if (!this.sync.isSynced()) return this.mirror?.load() ?? this.sync.view().tasks
    return this.sync.view().tasks
  }

  save(tasks: readonly TaskRecord[]): void {
    this.mirror?.save(tasks)
    this.sync.setTasks(tasks)
  }

  clear(): void {
    this.mirror?.clear()
    this.sync.setTasks([])
  }
}

/** PresetStore over the synced schedule-presets section. The mirror is
 *  write-only once synced (the synced view is the freshest truth); before
 *  adoption it is the read source (same offline-first discipline as tasks). */
export class SyncedPresetStore implements PresetStore {
  constructor(
    private readonly sync: SyncLedger,
    private readonly mirror?: PresetStore,
  ) {}

  load(): SchedulePreset[] {
    if (!this.sync.isSynced()) return this.mirror?.load() ?? this.sync.view().schedulePresets
    return this.sync.view().schedulePresets
  }

  save(presets: readonly SchedulePreset[]): void {
    this.mirror?.save(presets)
    this.sync.setSchedulePresets([...presets])
  }

  clear(): void {
    this.mirror?.clear()
    this.sync.setSchedulePresets([])
  }
}

/** RunPresetStore over the synced run-presets section (mirror write-only,
 *  same discipline as SyncedPresetStore). */
export class SyncedRunPresetStore implements RunPresetStore {
  constructor(
    private readonly sync: SyncLedger,
    private readonly mirror?: RunPresetStore,
  ) {}

  load(): RunPresetsDocument {
    if (!this.sync.isSynced()) return this.mirror?.load() ?? this.sync.view().runPresets
    return this.sync.view().runPresets
  }

  save(doc: RunPresetsDocument): void {
    this.mirror?.save(doc)
    this.sync.setRunPresets(doc)
  }

  clear(): void {
    this.mirror?.clear()
    this.sync.setRunPresets({ presets: [] })
  }
}

/**
 * A cruise-state store over the synced cruise section (the controller's
 * CruiseStorageFace: read returns the current value, write marks it dirty).
 * The offline mirror (write-only, same discipline as the other synced
 * stores) keeps the local cruise key fresh for fallback-mode first paint.
 */
export class SyncedCruiseStore {
  constructor(
    private readonly sync: SyncLedger,
    private readonly mirror?: { write(state: CruiseValue): void },
  ) {}

  read(): CruiseValue | undefined {
    return this.sync.view().cruise
  }

  write(state: CruiseValue): void {
    this.mirror?.write(state)
    this.sync.setCruise(state)
  }
}
