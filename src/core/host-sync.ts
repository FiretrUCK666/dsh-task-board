/**
 * The browser half of sync: makes this tab an optimistic replica of the
 * host-owned documents.
 *
 * A SESSION holds N document replicas. Today that is two — the board ledger
 * and the checklist — and the split is structural, not cosmetic:
 *
 * - SESSION-SCOPED (shared, because they are about this TAB, not about any one
 *   document): the client id, the mode, the loops, the SSE stream, the poll,
 *   tab visibility, and the ENGINE LEASE. The seat answers "which device is
 *   driving the engine", so it belongs to the tab and to no document; two
 *   replicas must never compete for it, and nothing here may be generalized
 *   into a per-document count.
 * - REPLICA-SCOPED (one set per document, and the two sets share NOTHING):
 *   baseline, dirty state, the in-flight snapshot, authorship claims, accrued
 *   deletions, the debounce lane, the backoff lane and the retry budget. The
 *   ack clears a replica's claims when THAT replica's rows came back clean and
 *   for no other reason — a shared pair would be emptied by the other
 *   document's ack the moment it went quiet, and the quieter document's
 *   un-acked edits would demote themselves to plain LWW and be overwritten.
 *   A replica losing its queue in silence is the exact failure the accrual
 *   discipline exists to prevent, so the isolation is the design, not a
 *   precaution.
 *
 * Responsibilities of the session (and nothing else):
 * - boot: fetch the authoritative documents (a few retries; persistent
 *   failure or an unavailable host yields `unavailable` — the wiring then
 *   keeps the plain localStorage mode, so the board never depends on this
 *   path to exist). A host that does not serve a document at all leaves THAT
 *   replica mirroring locally and says so; the others are untouched;
 * - migration, per document: an empty host document plus a non-empty local
 *   copy uploads it once (bootstrap); a non-empty host with a diverging local
 *   copy keeps the host truth and hands the local copy to the backup sink
 *   (nothing is ever silently dropped);
 * - commit, per document: every local change marks that document's view
 *   dirty and its own debounced, serialized lane posts the full view +
 *   observed deletions; the response is the authoritative document, so every
 *   replica converges on it (the merge grammars live in board-doc.ts and
 *   items-doc.ts, not here);
 * - watch: the SSE change stream drives coalesced resyncs ROUTED BY THE
 *   DOCUMENT THE FRAME NAMES — a note typed on a phone must not make every
 *   device re-pull the whole ledger; lease events drive engine state, command
 *   frames reach the engine only; a slow poll and every stream reopen resync
 *   as the safety net (SSE loss — proxies, mobile backgrounding — degrades
 *   latency, never correctness);
 * - lease: one heartbeat renews (or takes) the engine lease; `onEngine` tells
 *   the wiring when to start/stop the scheduler and gate the pump.
 *
 * Framework-free: all transport, clocks and timers are injected faces, so
 * tests drive every path without a browser or a server.
 *
 * KNOWN DEBT (do not mistake it for a finished design): the board replica's
 * state is still inline in `BoardSyncClient` rather than routed through the
 * same shape the checklist replica uses. Correctness does not depend on that
 * split — the two hold disjoint state either way, and both behaviours are
 * pinned by falsified tests — but the shape is duplicated. Collect it when it
 * actually becomes a burden, not before.
 */
import type { BoardDoc, BoardView } from './board-doc.ts'
import { boardViewOf, changedIdsOf, emptyBoardDoc, DEFAULT_CRUISE_VALUE } from './board-doc.ts'
import type {
  BoardCommit,
  BoardCommand,
  BoardEvent,
  BoardSection,
  CruiseValue,
  LeaseWire,
} from './board-doc.ts'
import { emptyItemsDoc, ITEM_ROW_OPS } from './items-doc.ts'
import type { ItemsCommit, ItemsDoc } from './items-doc.ts'
import type { ItemRecord } from './item.ts'
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

/** The same envelope for the SECOND document (the checklist), whose body is
 *  an `ItemsDoc` rather than a `BoardDoc`. Two shapes, one envelope — the
 *  route answers both tails with `{ ok, value }`. */
export interface ItemsSyncFetchResult {
  available: boolean
  revision: number
  doc?: ItemsDoc
  unchanged?: boolean
}

/** The board-route transport (the wiring implements it with fetch + EventSource). */
export interface BoardSyncTransport {
  fetch(clientId: string, since: number | undefined): Promise<SyncFetchResult | undefined>
  commit(commit: BoardCommit): Promise<SyncFetchResult | undefined>
  /** The checklist's read end. Absent on a host that predates the second
   *  document: the session treats it exactly like an unreachable host for
   *  that document alone — the board keeps syncing untouched. */
  itemsFetch?(clientId: string, since: number | undefined): Promise<ItemsSyncFetchResult | undefined>
  /** The checklist's write end (absent together with {@link itemsFetch}). */
  itemsCommit?(commit: ItemsCommit): Promise<ItemsSyncFetchResult | undefined>
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
  /** The checklist's offline mirror (the wiring: a localStorage key). Also the
   *  evidence that lets the replica say "the host cannot read it" instead of
   *  rendering an empty list as if the person had written nothing. */
  checklistMirror?: ChecklistMirrorFace
  log?: (message: string, error?: unknown) => void
}

/** The dirty sections of the local view (absent = identical to baseline). */
interface DirtyState {
  tasks?: readonly TaskRecord[]
  cruise?: BoardSection<CruiseValue>
  schedulePresets?: BoardSection<SchedulePreset[]>
  runPresets?: BoardSection<RunPresetsDocument>
}

/** One user-intended deletion: the row id plus the baseline stamp seen when
 *  the user dropped it (the host's delete guard compares against THIS stamp,
 *  never a recomputed one). */
interface AccruedDeletion {
  id: string
  baseUpdatedAt: number
}

/** Default empty document for a client that never synced (fallback mode). */
function emptyBaseline(now: number): BoardDoc {
  return emptyBoardDoc(now)
}

/** Commit retry budget: five attempts (2s → 4s → 8s → 16s → 30s), then the
 *  dirty state parks until the next local write retries it. An unbounded 2s
 *  loop would spin forever against a dead host (battery/log spam for zero
 *  convergence); the poll/SSE backstop keeps reads converging while parked,
 *  and the next write reopens the cycle because the user is watching then. */
const MAX_COMMIT_ATTEMPTS = 5
const COMMIT_RETRY_BASE_MS = 2_000
const COMMIT_RETRY_CAP_MS = 30_000

/** Whether a legacy view carries anything worth migrating (defaults alone do not).
 *  The cruise default rides THE shared default value, never a retyped literal. */
function hasLegacyContent(view: BoardView): boolean {
  return view.tasks.length > 0
    || view.cruise.enabled === true
    || view.cruise.manual !== undefined
    || view.cruise.schedule.length > 0
    || view.cruise.limit !== DEFAULT_CRUISE_VALUE.limit
    || view.schedulePresets.length > 0
    || view.runPresets.presets.length > 0
    || view.runPresets.defaultId !== undefined
}

export class BoardSyncClient {
  /** Identity of this tab for lease/relay purposes (stable per instance). */
  readonly clientId: string

  /** The SECOND document's replica, owned outright by this session. It rides
   *  the same loops, the same SSE stream and the same lease; what it does NOT
   *  share is a single byte of replica state with the board. */
  private readonly checklist: ChecklistReplica

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
  /** Backoff-retry timer (separate from the debounce above: a fresh write
   *  reschedules the debounce but never cancels a pending backoff — the two
   *  lanes have different owners and must never overwrite each other). */
  private backoffCancel: (() => void) | undefined
  /** User-intended deletions accrued at edit time (see setTasks) — flushed
   *  verbatim, never recomputed against a newer baseline. */
  private deleted: AccruedDeletion[] = []
  /** Consecutive un-acked commits (reset on ack and on every fresh local
   *  write — a user acting reopens the cycle because they are watching). */
  private commitAttempts = 0
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
    this.checklist = new ChecklistReplica({
      clientId: this.clientId,
      transport: deps.transport,
      defer: deps.defer,
      now: this.now,
      commitDebounceMs: this.commitDebounceMs,
      resyncCoalesceMs: this.resyncCoalesceMs,
      mirror: deps.checklistMirror,
      log: this.log,
    })
  }

  /** The checklist's replica — the wiring mounts the panel on it. */
  checklistReplica(): ChecklistReplica {
    return this.checklist
  }

  onChecklistRemote(listener: (items: readonly ItemRecord[], revision: number) => void): void {
    this.checklist.onRemote(listener)
  }

  onChecklistBackup(listener: (items: readonly ItemRecord[]) => void): void {
    this.checklist.onBackup(listener)
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
        // Dirty state accrued BEFORE this settle (a write that landed while
        // boot was still fetching) is never replaced: the migration assigns
        // section by section, so a live write keeps its value AND its claim
        // while the snapshot fills in only the untouched sections.
        if (this.baseline.revision === 0) {
          this.dirty.tasks = legacyView.tasks
          this.dirty.cruise ??= { value: legacyView.cruise, at }
          this.dirty.schedulePresets ??= { value: legacyView.schedulePresets, at }
          this.dirty.runPresets ??= { value: legacyView.runPresets, at }
        } else {
          const merged = new Map(hostIds)
          for (const task of legacyView.tasks) {
            const host = merged.get(task.id)
            if (host === undefined || task.updatedAt > host.updatedAt) merged.set(task.id, task)
          }
          this.dirty.tasks = [...merged.values()]
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
        // No direct probe here: the resync poll above carries it (one commit
        // per trigger, never two — poll-then-probe AND direct-probe would
        // double-send on every foreground return and stream reopen).
      },
    }))
    this.loopCancels.push(this.every(this.leaseRenewMs, () => this.renewLease()))
    this.loopCancels.push(this.every(this.pollMs, async () => {
      await this.poll()
      // The checklist polls on the same cadence but on its OWN revision and its
      // OWN fetch — one slow document must not delay the other.
      await this.checklist.poll()
    }))
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
        // The poll below carries the parked-writer probe (same single-send
        // law as stream reopen — never a direct probe alongside it).
        void this.poll()
      }))
      this.loopCancels.push(visibility.onHidden(() => {
        void this.deps.transport.lease(this.clientId, { ttlMs: this.leaseTtlMs, active: false }).catch(() => undefined)
      }))
    }
    // The first lease probe is part of starting: by the time the wiring is
    // told "synced", the engine state of this tab is already known.
    await this.renewLease()
    // The checklist settles on its own: a host without the second document
    // leaves it mirroring locally and says so, and the board is untouched.
    await this.checklist.start()
    return this.mode
  }

  /** Stop every loop, close the stream, release the lease best-effort. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.commitCancel?.()
    this.commitCancel = undefined
    this.backoffCancel?.()
    this.backoffCancel = undefined
    this.resyncCancel?.()
    for (const cancel of this.loopCancels.splice(0)) cancel()
    this.checklist.dispose()
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

  /** The effective local view: baseline overlaid with un-acked dirty state.
   *  Tasks merge by id (never whole-array overlay): the dirty array keeps its
   *  order, and baseline-only rows (remote arrivals during a parked spell)
   *  append read-only — a parked replica keeps READING convergence even
   *  though its writes wait. Accrued deletions stay excluded on both sides. */
  view(): BoardView {
    const base = boardViewOf(this.baseline)
    const deletedIds = new Set(this.deleted.map(entry => entry.id))
    if (this.dirty.tasks === undefined && this.dirty.cruise === undefined
      && this.dirty.schedulePresets === undefined && this.dirty.runPresets === undefined) {
      return deletedIds.size === 0
        ? base
        : { ...base, tasks: base.tasks.filter(task => !deletedIds.has(task.id)) }
    }
    const dirtyIds = new Set((this.dirty.tasks ?? []).map(task => task.id))
    return {
      tasks: [
        ...(this.dirty.tasks ?? base.tasks).filter(task => !deletedIds.has(task.id)),
        ...(this.dirty.tasks === undefined
          ? []
          : base.tasks.filter(task => !dirtyIds.has(task.id) && !deletedIds.has(task.id))),
      ] as TaskRecord[],
      cruise: this.dirty.cruise?.value ?? base.cruise,
      schedulePresets: this.dirty.schedulePresets?.value ?? base.schedulePresets,
      runPresets: this.dirty.runPresets?.value ?? base.runPresets,
    }
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
    // Deletion accrual (THE delete semantics — see the S1 reasoning in the
    // module history): a dropped row is recorded HERE, with the baseline
    // stamp seen at edit time. Recomputing deletions at flush time against a
    // newer baseline turns every park-period remote arrival into a phantom
    // delete (the array lacks it, the fresh stamp waves it through the host
    // guard). Rows the baseline never held need no tombstone (the host never
    // saw them); rows that reappear drop their accrued delete.
    const stamps = new Map(this.baseline.tasks.map(task => [task.id, task.updatedAt]))
    const accrued = new Map(this.deleted.map(entry => [entry.id, entry.baseUpdatedAt]))
    for (const row of previous) {
      if (kept.has(row.id)) continue
      if (accrued.has(row.id)) continue
      const stamp = stamps.get(row.id)
      if (stamp !== undefined) accrued.set(row.id, stamp)
    }
    // Present rows never carry a tombstone — a delete resurrected before its
    // ack (undo, re-add) must not be eaten by its own accrued grave, even
    // when the resurrection bypassed the previous view (the row was already
    // hidden from it).
    for (const id of accrued.keys()) {
      if (kept.has(id)) accrued.delete(id)
    }
    this.deleted = [...accrued].map(([id, baseUpdatedAt]) => ({ id, baseUpdatedAt }))
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
      // THE ROUTING RULE. A commit frame names the document it moved. Routing
      // it to the wrong replica is not a cosmetic waste: the board's resync
      // re-fetches and re-derives the whole ledger, so a note typed on a phone
      // would make every other device re-pull the board on every keystroke's
      // round trip. Each document is woken by its own frames and stays asleep
      // during the other's.
      if (event.clientId === this.clientId) return // own commits arrive via the response
      if (event.document === 'items') this.checklist.onRemoteFrame(event.clientId)
      else this.scheduleResync()
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
    // A fresh local write reopens the retry budget (counter only — the
    // backoff timer lane is never touched here, so an in-flight backoff
    // keeps its cadence while the budget restarts; the two are orthogonal by
    // design). The user is watching, so a fresh cycle is correct, not spam.
    this.commitAttempts = 0
    // Fresh writes reschedule the debounce lane only — a pending backoff
    // retry keeps its own timer and reads the latest dirty state when it
    // fires (two lanes, two timers, never one overwriting the other).
    this.commitCancel?.()
    this.commitCancel = this.defer(() => {
      this.commitCancel = undefined
      void this.flush()
    }, this.commitDebounceMs)
  }

  /** Send the current dirty view (one in flight at a time, trailing refire). */
  async flush(): Promise<void> {
    if (this.mode !== 'synced' || this.disposed) return
    // A flush consumes any pending backoff (this attempt supersedes it —
    // one funnel, never two timers racing to send).
    this.backoffCancel?.()
    this.backoffCancel = undefined
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
      deleted: [...this.deleted],
      cruise: this.dirty.cruise ?? this.baseline.cruise,
      schedulePresets: this.dirty.schedulePresets ?? this.baseline.schedulePresets,
      runPresets: this.dirty.runPresets ?? this.baseline.runPresets,
    }
    this.inFlight = snapshot
    // Named commit diagnostics (permanent): every "toggled but nothing
    // happened / refresh reverted" dispute ends here — what rode the commit,
    // how big it was, and whether the host acked. Failures keep the
    // backoff discipline below; they just stop being silent.
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
    if (this.disposed) return
    if (result === undefined || !result.available || result.doc === undefined) {
      // A pending refire folds into the retry below (the retry re-reads the
      // dirty state, so no boolean patch is needed — "reread dirty" is the
      // only truth, never a flag).
      this.refire = false
      this.commitAttempts += 1
      if (this.commitAttempts > MAX_COMMIT_ATTEMPTS) {
        // Budget spent: park the dirty state (reads keep converging through
        // poll/SSE; a user write or a reachability probe reopens the cycle).
        // No more timers. The transition logs once — budget-neutral probes
        // re-entering here stay silent.
        if (this.commitAttempts === MAX_COMMIT_ATTEMPTS + 1) {
          this.log('[dsh-task-board] commit retry budget spent (keeping dirty state parked)')
        }
        return
      }
      // Backoff retry (2s → 4s → … capped) on its OWN timer lane: the failure
      // keeps its log line, it just stops being silent AND stops spinning at
      // full rate. Fresh writes reschedule the debounce lane, never this one.
      const delay = Math.min(COMMIT_RETRY_BASE_MS * 2 ** (this.commitAttempts - 1), COMMIT_RETRY_CAP_MS)
      this.log(`[dsh-task-board] commit not acked (keeping dirty state, retry ${this.commitAttempts}/${MAX_COMMIT_ATTEMPTS} in ${delay}ms)`)
      // No cancel-before-schedule here: flush() consumed the backoff lane on
      // entry, and the in-flight guard admits only one flusher — no second
      // timer can exist at this point by construction.
      this.backoffCancel = this.defer(() => {
        this.backoffCancel = undefined
        void this.flush()
      }, delay)
      return
    }
    this.commitAttempts = 0
    this.log(`[dsh-task-board] commit acked revision=${result.doc.revision}`)
    this.adopt(result.doc)
    if (snapshot.tasks !== undefined && this.dirty.tasks === snapshot.tasks) delete this.dirty.tasks
    if (snapshot.cruise !== undefined && this.dirty.cruise === snapshot.cruise) delete this.dirty.cruise
    if (snapshot.schedulePresets !== undefined && this.dirty.schedulePresets === snapshot.schedulePresets) delete this.dirty.schedulePresets
    if (snapshot.runPresets !== undefined && this.dirty.runPresets === snapshot.runPresets) delete this.dirty.runPresets
    // The ledger layer is fully acknowledged: the host has every claim it was
    // sent, so authorship state resets (the next claim accrues from here).
    // Accrued deletions clear with the same condition (acked = applied).
    if (this.dirty.tasks === undefined) {
      this.claims.clear()
      this.deleted = []
    }
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

  /** Self-heal a parked writer: when a read proves the host reachable again
   *  (successful poll, reopened stream, foreground return) and dirty state
   *  waits with no timer driving it, probe once through the single funnel.
   *  The probe is BUDGET-NEUTRAL (it never restarts the retry cycle — a
   *  failed probe falls straight back into silence, a success resets the
   *  counter): otherwise every poll would reopen a full backoff chain and
   *  parking would never hold. Only a real user write reopens the budget. */
  private probeParked(): void {
    if (this.mode !== 'synced' || this.disposed || this.inFlight !== undefined) return
    if (this.commitAttempts <= MAX_COMMIT_ATTEMPTS) return
    if (this.commitCancel !== undefined || this.backoffCancel !== undefined) return
    if (this.dirty.tasks === undefined && this.dirty.cruise === undefined
      && this.dirty.schedulePresets === undefined && this.dirty.runPresets === undefined) return
    this.commitAttempts = MAX_COMMIT_ATTEMPTS + 1
    void this.flush()
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
    // Reachability and novelty are separate questions: ANY successful read
    // proves the host is up, so a parked writer probes here — even when the
    // doc is unchanged (a recovered host with no remote writes must still
    // wake a parked writer; quiet idling never overrides self-heal).
    this.probeParked()
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

// --- the checklist replica ------------------------------------------------
//
// The second document's replica. It follows the SAME laws as the board's rows
// (authorship claims, accrued deletions, one in-flight commit, a debounce lane
// and a backoff lane that never overwrite each other, a bounded retry budget
// that parks rather than spins) — and it owns EVERY ONE OF THEM ITSELF.
//
// THAT OWNERSHIP IS THE WHOLE POINT, and it is not stylistic. An ack clears
// this replica's claims only when THIS replica's rows are clean. A shared pair
// would be cleared by the board's ack the moment the board went quiet, so an
// un-acked checklist edit would silently demote itself to plain LWW on a slow
// device and get overwritten — the replica would lose its queue in silence,
// which is the exact failure mode the board's accrual discipline exists to
// prevent. One replica, one queue, one ack.

/** Which rows THIS replica moved, by CONTENT. Read state is not content, and
 *  the fingerprint comes from the items document's own row ops — so `ref`
 *  (the short number) stays out of it exactly as it stays out of a claim there.
 *  A replica that merely renumbered nothing never claims a row. */
function changedItemIds(baseline: readonly ItemRecord[], next: readonly ItemRecord[]): string[] {
  const key = ITEM_ROW_OPS.authorshipKey
  const before = new Map(baseline.map(item => [item.id, key(item)]))
  const changed: string[] = []
  for (const item of next) {
    const previous = before.get(item.id)
    if (previous === undefined || previous !== key(item)) changed.push(item.id)
  }
  return changed
}

/** The offline mirror for the checklist (the wiring backs it with a
 *  localStorage key). Reads feed first paint before adoption; writes keep the
 *  key warm AND are the evidence that a non-empty host view is suspicious. */
export interface ChecklistMirrorFace {
  load(): ItemRecord[]
  save(items: readonly ItemRecord[]): void
  clear(): void
}

/** One user-intended checklist deletion, stamped at edit time exactly as the
 *  board's are (recomputing against a newer baseline turns every park-period
 *  remote arrival into a phantom delete). */
interface ItemDeletion {
  id: string
  baseUpdatedAt: number
}

/** Everything the replica needs from the session, injected so tests drive it
 *  without a browser or a server. */
export interface ChecklistReplicaDeps {
  clientId: string
  transport: BoardSyncTransport
  defer(fn: () => void, ms: number): () => void
  now?: () => number
  commitDebounceMs?: number
  /** Remote-change coalescing before a resync fetch (same default as the session). */
  resyncCoalesceMs?: number
  mirror?: ChecklistMirrorFace
  log?: (message: string, error?: unknown) => void
}

/** The checklist as one browser-side replica of the host's second document. */
export class ChecklistReplica {
  private doc: ItemsDoc
  /** Un-acked rows (undefined = identical to the baseline). */
  private dirty: readonly ItemRecord[] | undefined
  /** The exact array in flight, identity-compared on ack. */
  private inFlight: readonly ItemRecord[] | undefined
  private readonly claims = new Set<string>()
  private deleted: ItemDeletion[] = []
  private refire = false
  private commitAttempts = 0
  private commitCancel: (() => void) | undefined
  private backoffCancel: (() => void) | undefined
  private resyncCancel: (() => void) | undefined
  private disposed = false
  /** Set once the host has answered for this document at least once. */
  private reachable = false

  private readonly now: () => number
  private readonly defer: (fn: () => void, ms: number) => () => void
  private readonly commitDebounceMs: number
  private readonly resyncCoalesceMs: number
  private readonly log: (message: string, error?: unknown) => void

  private remoteListener: ((items: readonly ItemRecord[], revision: number) => void) | undefined
  private backupListener: ((items: readonly ItemRecord[]) => void) | undefined

  constructor(private readonly deps: ChecklistReplicaDeps) {
    this.now = deps.now ?? (() => Date.now())
    this.defer = deps.defer
    this.commitDebounceMs = deps.commitDebounceMs ?? 250
    this.resyncCoalesceMs = deps.resyncCoalesceMs ?? 120
    this.log = deps.log
      ?? ((message, error) => (error === undefined ? console.error(message) : console.error(message, error)))
    this.doc = emptyItemsDoc(this.now())
  }

  /** Adopt the host's first view and run the same migration probe the board
   *  runs: an empty host document plus a non-empty local mirror uploads once. */
  async start(): Promise<void> {
    const result = await this.fetchDoc(undefined).catch(() => undefined)
    if (result === undefined || !result.available || result.doc === undefined) {
      // A host that has no second document (or an unreachable one) leaves this
      // replica on the mirror. The board is untouched by that.
      this.log('[dsh-task-board] checklist document not served (mirroring locally)')
      return
    }
    this.reachable = true
    this.doc = result.doc
    const legacy = this.deps.mirror?.load() ?? []
    if (legacy.length > 0) {
      const hostIds = new Map(result.doc.items.map(item => [item.id, item]))
      const identical = legacy.length === result.doc.items.length
        && legacy.every(item => hostIds.get(item.id)?.updatedAt === item.updatedAt)
      if (!identical) {
        if (result.doc.revision === 0) {
          this.dirty = legacy
        } else {
          // Union per record, host wins ties: nothing a person made is hidden
          // behind "first origin wins". The diverging local copy goes to the
          // backup sink for forensics.
          const merged = new Map(hostIds)
          for (const item of legacy) {
            const host = merged.get(item.id)
            if (host === undefined || item.updatedAt > host.updatedAt) merged.set(item.id, item)
          }
          this.dirty = [...merged.values()]
          this.backupListener?.(legacy)
        }
        await this.flush()
      }
    }
  }

  /** Whether the host truth is adopted for the checklist. */
  isSynced(): boolean {
    return this.reachable
  }

  /**
   * TRUE when the host is answering but reports an empty checklist while the
   * local mirror still holds rows.
   *
   * The platform reads a malformed or stale-versioned per-record document as
   * ABSENT (it never bricks the unit), so a damaged `items.json` restores as an
   * empty checklist — and "the host cannot read it" is indistinguishable from
   * "you have nothing" on the wire. The host deliberately does not guess. This
   * is the exit it left: the replica is the only side that can still see the
   * local evidence, so it is the only side that may say so. A panel rendering
   * this as "你一条都没有" would be telling the user a falsehood about their own
   * data, which is worse than the failure it hides.
   */
  hostLostItems(): boolean {
    return this.reachable && this.doc.items.length === 0 && (this.deps.mirror?.load().length ?? 0) > 0
  }

  /** The effective local view: baseline overlaid with un-acked rows, with
   *  accrued deletions excluded on both sides (same law as the board's rows —
   *  the dirty array keeps its order, baseline-only rows append read-only). */
  view(): readonly ItemRecord[] {
    const base = this.doc.items
    const deletedIds = new Set(this.deleted.map(entry => entry.id))
    if (this.dirty === undefined) {
      return deletedIds.size === 0 ? base : base.filter(item => !deletedIds.has(item.id))
    }
    const dirtyIds = new Set(this.dirty.map(item => item.id))
    return [
      ...this.dirty.filter(item => !deletedIds.has(item.id)),
      ...base.filter(item => !dirtyIds.has(item.id) && !deletedIds.has(item.id)),
    ]
  }

  /**
   * This tab's caller id — the one every write on this prefix carries.
   *
   * Exposed because a write the panel makes DIRECTLY (restoring a deleted row)
   * has to be attributed to the same tab that syncs it, and minting a second id
   * here would put the activity note under a name the reader has never seen.
   */
  clientId(): string {
    return this.deps.clientId
  }

  /** Mark the checklist dirty and queue a commit. */
  setItems(items: readonly ItemRecord[]): void {
    if (this.dirty === items) return
    // Claim exactly the rows THIS edit moved against the view this replica was
    // serving — not against a baseline remote frames may have advanced since.
    const previous = this.view()
    for (const id of changedItemIds(previous, items)) this.claims.add(id)
    const kept = new Set(items.map(item => item.id))
    for (const id of [...this.claims]) {
      if (!kept.has(id)) this.claims.delete(id)
    }
    // Deletion accrual AT EDIT TIME, stamped with the baseline the drop was
    // computed against. Rows the baseline never held need no tombstone; rows
    // that reappear drop their accrued delete.
    const stamps = new Map(this.doc.items.map(item => [item.id, item.updatedAt]))
    const accrued = new Map(this.deleted.map(entry => [entry.id, entry.baseUpdatedAt]))
    for (const row of previous) {
      if (kept.has(row.id)) continue
      if (accrued.has(row.id)) continue
      const stamp = stamps.get(row.id)
      if (stamp !== undefined) accrued.set(row.id, stamp)
    }
    for (const id of accrued.keys()) {
      if (kept.has(id)) accrued.delete(id)
    }
    this.deleted = [...accrued].map(([id, baseUpdatedAt]) => ({ id, baseUpdatedAt }))
    this.dirty = items
    this.scheduleCommit()
  }

  onRemote(listener: (items: readonly ItemRecord[], revision: number) => void): void {
    this.remoteListener = listener
  }

  onBackup(listener: (items: readonly ItemRecord[]) => void): void {
    this.backupListener = listener
  }

  /** A remote checklist frame: own commits arrive via the response, remote ones
   *  need a resync. This is what keeps a phone-side note from resyncing the
   *  whole board. */
  onRemoteFrame(clientId: string): void {
    if (this.disposed) return
    if (clientId === this.deps.clientId) return
    this.scheduleResync()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.commitCancel?.()
    this.commitCancel = undefined
    this.backoffCancel?.()
    this.backoffCancel = undefined
    this.resyncCancel?.()
    this.remoteListener = undefined
    this.backupListener = undefined
  }

  // --- internals ----------------------------------------------------------

  private scheduleCommit(): void {
    if (this.disposed) return
    this.commitAttempts = 0
    this.commitCancel?.()
    this.commitCancel = this.defer(() => {
      this.commitCancel = undefined
      void this.flush()
    }, this.commitDebounceMs)
  }

  /** Send the current dirty view (one in flight at a time, trailing refire). */
  async flush(): Promise<void> {
    if (this.disposed) return
    const send = this.deps.transport.itemsCommit
    if (send === undefined || this.deps.transport.itemsFetch === undefined) return
    this.backoffCancel?.()
    this.backoffCancel = undefined
    if (this.inFlight !== undefined) {
      this.refire = true
      return
    }
    const items = this.dirty ?? this.doc.items
    const snapshot = this.dirty
    this.inFlight = snapshot
    const commit: ItemsCommit = {
      clientId: this.deps.clientId,
      items,
      changed: [...this.claims],
      deleted: this.deleted.map(entry => ({ id: entry.id, baseUpdatedAt: entry.baseUpdatedAt })),
    }
    const result = await send.call(this.deps.transport, commit).catch((error: unknown) => {
      this.log('[dsh-task-board] checklist commit transport failed', error)
      return undefined
    })
    this.inFlight = undefined
    if (this.disposed) return
    if (result === undefined || !result.available || result.doc === undefined) {
      this.refire = false
      this.commitAttempts += 1
      if (this.commitAttempts > MAX_COMMIT_ATTEMPTS) {
        if (this.commitAttempts === MAX_COMMIT_ATTEMPTS + 1) {
          this.log('[dsh-task-board] checklist commit retry budget spent (keeping dirty state parked)')
        }
        return
      }
      const delay = Math.min(COMMIT_RETRY_BASE_MS * 2 ** (this.commitAttempts - 1), COMMIT_RETRY_CAP_MS)
      this.backoffCancel = this.defer(() => {
        this.backoffCancel = undefined
        void this.flush()
      }, delay)
      return
    }
    this.commitAttempts = 0
    this.reachable = true
    this.adopt(result.doc)
    // Cleared ONLY when this replica's own rows came back clean. Nothing about
    // the board's state can reach in here.
    if (snapshot !== undefined && this.dirty === snapshot) this.dirty = undefined
    if (this.dirty === undefined) {
      this.claims.clear()
      this.deleted = []
    }
    const refire = this.refire
    this.refire = false
    if (refire || this.dirty !== undefined) this.scheduleCommit()
  }

  /** Adopt an authoritative checklist (never backwards) and notify the replica. */
  private adopt(doc: ItemsDoc): void {
    if (doc.revision < this.doc.revision) return
    if (doc === this.doc) return
    this.doc = doc
    this.deps.mirror?.save(this.view())
    this.remoteListener?.(this.view(), doc.revision)
  }

  private scheduleResync(): void {
    if (this.resyncCancel !== undefined) return
    this.resyncCancel = this.defer(() => {
      this.resyncCancel = undefined
      void this.poll()
    }, this.resyncCoalesceMs)
  }

  /** Fetch only when the host's checklist revision moved past the baseline. */
  async poll(): Promise<void> {
    if (this.disposed) return
    const result = await this.fetchDoc(this.doc.revision).catch(() => undefined)
    if (result === undefined) {
      this.log('[dsh-task-board] checklist resync failed (keeping the last known truth)')
      return
    }
    if (!result.available || result.unchanged || result.doc === undefined) return
    this.adopt(result.doc)
  }

  private async fetchDoc(since: number | undefined): Promise<ItemsSyncFetchResult | undefined> {
    const fetchDoc = this.deps.transport.itemsFetch
    if (fetchDoc === undefined) return undefined
    return fetchDoc.call(this.deps.transport, this.deps.clientId, since)
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
 * The cruise offline mirror: the local cruise key in the browser (`read` feeds
 * first paint before adoption, `write` keeps the key warm). Structurally the
 * controller's CruiseStorageFace, declared here so this adapter never imports
 * the controller.
 */
export interface CruiseMirrorFace {
  read(): Partial<CruiseValue> | undefined
  write(state: CruiseValue): void
}

/**
 * A cruise-state store over the synced cruise section (the controller's
 * CruiseStorageFace: read returns the current value, write marks it dirty).
 * The mirror serves reads until the host truth is adopted — the same
 * offline-first discipline as the other synced stores — so a reload
 * first-paints the cruise the user last set instead of the empty document's
 * enabled:false default, and the local key stays the fallback-mode truth.
 */
export class SyncedCruiseStore {
  constructor(
    private readonly sync: SyncLedger,
    private readonly mirror?: CruiseMirrorFace,
  ) {}

  read(): Partial<CruiseValue> | undefined {
    if (!this.sync.isSynced()) return this.mirror?.read() ?? this.sync.view().cruise
    return this.sync.view().cruise
  }

  write(state: CruiseValue): void {
    this.mirror?.write(state)
    this.sync.setCruise(state)
  }
}

/** A synchronous checklist store over the synced second document, with the
 *  same offline-first discipline as the task store: reads come from the mirror
 *  until the host truth is adopted (first paint never waits on the network),
 *  writes warm the mirror AND mark the replica dirty.
 *
 *  The mirror's key is the checklist's OWN (`dsh.taskBoard.items.v1`). Hard
 *  rule 5 freezes the existing keys' NAMES; it does not forbid a new document
 *  from carrying its own — and it must, because a shared key would make one
 *  document's mirror overwrite the other's. */
export class SyncedItemsStore {
  constructor(
    private readonly replica: ChecklistReplica,
    private readonly mirror?: ChecklistMirrorFace,
  ) {}

  load(): readonly ItemRecord[] {
    if (!this.replica.isSynced()) return this.mirror?.load() ?? this.replica.view()
    return this.replica.view()
  }

  save(items: readonly ItemRecord[]): void {
    this.mirror?.save(items)
    this.replica.setItems(items)
  }

  clear(): void {
    this.mirror?.clear()
    this.replica.setItems([])
  }

  /** Whether the host is answering but its checklist reads empty while the
   *  mirror still holds rows — a damaged document, which must be SAID, never
   *  rendered as "you have nothing". */
  hostLostItems(): boolean {
    return this.replica.hostLostItems()
  }
}
