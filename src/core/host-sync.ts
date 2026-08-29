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
import { boardViewOf, diffDeletions } from './board-doc.ts'
import type {
  BoardCommit,
  BoardCommand,
  BoardEvent,
  BoardSection,
  CruiseValue,
  LeaseState,
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
  lease(clientId: string, options: { ttlMs?: number; release?: boolean }): Promise<LeaseState | undefined>
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
  return {
    revision: 0,
    tasks: [],
    cruise: { value: { enabled: false, limit: 5, schedule: [] }, at: now },
    schedulePresets: { value: [], at: now },
    runPresets: { value: { presets: [] }, at: now },
    tombstones: {},
    bornAt: now,
  }
}

/** Whether a legacy view carries anything worth migrating (defaults alone do not). */
function hasLegacyContent(view: BoardView): boolean {
  return view.tasks.length > 0
    || view.cruise.enabled === true
    || view.cruise.manual !== undefined
    || view.cruise.schedule.length > 0
    || view.cruise.limit !== 5
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
  private refire = false
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
    if (this.mode !== 'synced') return 'unavailable'
    if (this.disposed) return this.mode

    const legacyView = legacy?.()
    if (legacyView !== undefined) {
      if (this.baseline.revision === 0 && this.baseline.tasks.length === 0 && Object.keys(this.baseline.tombstones).length === 0) {
        if (hasLegacyContent(legacyView)) {
          // Bootstrap: upload the local ledger as the first commit.
          const at = this.now()
          this.dirty = {
            tasks: legacyView.tasks,
            cruise: { value: legacyView.cruise, at },
            schedulePresets: { value: legacyView.schedulePresets, at },
            runPresets: { value: legacyView.runPresets, at },
          }
          await this.flush()
        }
      } else if (legacyView.tasks.length > 0
        && JSON.stringify(legacyView.tasks) !== JSON.stringify(this.baseline.tasks)) {
        // Host truth wins; the diverging local copy is handed to the backup
        // sink (the wiring parks it under a dedicated key, never dropped).
        this.backupListener?.(legacyView)
      }
    }

    this.loopCancels.push(this.deps.transport.openStream(this.clientId, {
      onEvent: event => this.onStreamEvent(event),
      onOpen: () => {
        this.scheduleResync()
        void this.renewLease()
      },
    }))
    this.loopCancels.push(this.every(this.leaseRenewMs, () => this.renewLease()))
    this.loopCancels.push(this.every(this.pollMs, () => this.poll()))
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

  private onStreamEvent(event: BoardEvent): void {
    if (this.disposed) return
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
      deleted: diffDeletions(this.baseline.tasks, tasks),
      cruise: this.dirty.cruise ?? this.baseline.cruise,
      schedulePresets: this.dirty.schedulePresets ?? this.baseline.schedulePresets,
      runPresets: this.dirty.runPresets ?? this.baseline.runPresets,
    }
    this.inFlight = snapshot
    const result = await this.deps.transport.commit(commit).catch(() => undefined)
    this.inFlight = undefined
    if (result === undefined || !result.available || result.doc === undefined) {
      // Keep the dirty state; retry once after a beat (the poll/SSE are the
      // backstop, so a lost retry only delays convergence).
      this.commitCancel = this.defer(() => {
        this.commitCancel = undefined
        void this.flush()
      }, 2_000)
      return
    }
    this.adopt(result.doc)
    if (snapshot.tasks !== undefined && this.dirty.tasks === snapshot.tasks) delete this.dirty.tasks
    if (snapshot.cruise !== undefined && this.dirty.cruise === snapshot.cruise) delete this.dirty.cruise
    if (snapshot.schedulePresets !== undefined && this.dirty.schedulePresets === snapshot.schedulePresets) delete this.dirty.schedulePresets
    if (snapshot.runPresets !== undefined && this.dirty.runPresets === snapshot.runPresets) delete this.dirty.runPresets
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
    const result = await this.deps.transport.fetch(this.clientId, this.baseline.revision).catch(() => undefined)
    if (result === undefined) {
      this.log('[dsh-task-board] board resync failed (keeping the last known truth)')
      return
    }
    if (!result.available || result.unchanged || result.doc === undefined) return
    this.adopt(result.doc)
  }

  /** Renew (or take) the engine lease; publish engine-state changes. */
  async renewLease(): Promise<void> {
    if (this.mode !== 'synced' || this.disposed) return
    const state = await this.deps.transport.lease(this.clientId, { ttlMs: this.leaseTtlMs }).catch(() => undefined)
    if (state === undefined) return
    this.setEngine(state.held)
  }

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
  view(): BoardView
  setTasks(tasks: readonly TaskRecord[]): void
  setCruise(value: CruiseValue): void
  setSchedulePresets(value: SchedulePreset[]): void
  setRunPresets(value: RunPresetsDocument): void
}

/** TaskStore over the synced document (+ optional warm mirror). */
export class SyncedTaskStore implements TaskStore {
  constructor(
    private readonly sync: SyncLedger,
    private readonly mirror?: TaskStore,
  ) {}

  load(): TaskRecord[] {
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
 *  write-only (offline bootstrap for fallback mode); reads always take the
 *  synced view, which is the freshest truth in synced mode. */
export class SyncedPresetStore implements PresetStore {
  constructor(
    private readonly sync: SyncLedger,
    private readonly mirror?: PresetStore,
  ) {}

  load(): SchedulePreset[] {
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
 */
export class SyncedCruiseStore {
  constructor(private readonly sync: SyncLedger) {}

  read(): CruiseValue | undefined {
    return this.sync.view().cruise
  }

  write(state: CruiseValue): void {
    this.sync.setCruise(state)
  }
}
