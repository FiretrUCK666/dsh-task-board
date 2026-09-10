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
import type { BoardDoc, BoardView } from './board-doc.ts';
import type { BoardCommit, BoardCommand, BoardEvent, CruiseValue, LeaseWire } from './board-doc.ts';
import type { RunPresetStore, RunPresetsDocument } from './run-presets.ts';
import type { PresetStore, SchedulePreset } from './presets.ts';
import type { TaskRecord } from './tasks.ts';
import type { TaskStore } from './store.ts';
/** The fetch/commit answer shape the transport surfaces from the board route. */
export interface SyncFetchResult {
    available: boolean;
    revision: number;
    doc?: BoardDoc;
    unchanged?: boolean;
}
/** The board-route transport (the wiring implements it with fetch + EventSource). */
export interface BoardSyncTransport {
    fetch(clientId: string, since: number | undefined): Promise<SyncFetchResult | undefined>;
    commit(commit: BoardCommit): Promise<SyncFetchResult | undefined>;
    lease(clientId: string, options: {
        ttlMs?: number;
        release?: boolean;
        active?: boolean;
    }): Promise<LeaseWire | undefined>;
    command(clientId: string, command: BoardCommand): Promise<void>;
    /** Open the SSE change stream for this replica; the returned disposer closes it. */
    openStream(clientId: string, handlers: {
        onEvent(event: BoardEvent): void;
        onOpen(): void;
    }): () => void;
}
export type SyncMode = 'synced' | 'unavailable';
/** Everything injectable (tests drive all of it with fakes). */
export interface BoardSyncDeps {
    transport: BoardSyncTransport;
    /** Cancelling deferrer (the wiring: setTimeout/clearTimeout). */
    defer(fn: () => void, ms: number): () => void;
    now?: () => number;
    uuid?: () => string;
    /** Commit coalescing window. */
    commitDebounceMs?: number;
    /** Engine-lease TTL and renewal cadence. */
    leaseTtlMs?: number;
    leaseRenewMs?: number;
    /** Safety-net resync cadence (SSE is the fast path). */
    pollMs?: number;
    /** Remote-change coalescing before a resync fetch. */
    resyncCoalesceMs?: number;
    /** Tab visibility (the browser wiring): drives the engine-lease `active`
     *  flag and an immediate resync/lease-take when the tab returns to the
     *  foreground (a woken viewer becomes the engine at once, a woken engine
     *  catches up on turns recorded while it was frozen). Absent = always
     *  visible (tests, non-browser hosts). */
    visibility?: {
        is(): boolean;
        onVisible(cb: () => void): () => void;
        onHidden(cb: () => void): () => void;
    };
    log?: (message: string, error?: unknown) => void;
}
export declare class BoardSyncClient {
    private readonly deps;
    /** Identity of this tab for lease/relay purposes (stable per instance). */
    readonly clientId: string;
    private mode;
    private baseline;
    private dirty;
    /** The snapshot currently in flight (identity-compared on ack). */
    private inFlight;
    /** Authorship claims accrued since the last fully-acked commit (see setTasks). */
    private readonly claims;
    private refire;
    /** The host's lease protocol version. undefined = this replica has NEVER
     *  read a lease — "no evidence yet" must never be reported as "old host"
     *  (a failed first probe would otherwise flash a false stale banner). */
    private hostLeaseProto;
    /** When the answering host process booted (undefined = never read). */
    private hostBoot;
    private engine;
    private disposed;
    private commitCancel;
    /** Backoff-retry timer (separate from the debounce above: a fresh write
     *  reschedules the debounce but never cancels a pending backoff — the two
     *  lanes have different owners and must never overwrite each other). */
    private backoffCancel;
    /** User-intended deletions accrued at edit time (see setTasks) — flushed
     *  verbatim, never recomputed against a newer baseline. */
    private deleted;
    /** Consecutive un-acked commits (reset on ack and on every fresh local
     *  write — a user acting reopens the cycle because they are watching). */
    private commitAttempts;
    private resyncCancel;
    private readonly loopCancels;
    private remoteListener;
    private engineListener;
    private commandListener;
    private backupListener;
    private readonly now;
    private readonly defer;
    private readonly commitDebounceMs;
    private readonly leaseTtlMs;
    private readonly leaseRenewMs;
    private readonly pollMs;
    private readonly resyncCoalesceMs;
    private readonly log;
    constructor(deps: BoardSyncDeps);
    /**
     * Fetch the authoritative document (bounded retries), run the migration
     * probe, then wire the watch/lease/poll loops.
     * @param legacy - reads the pre-sync local view (localStorage); when the
     *   host document is still empty it is uploaded as the initial commit,
     *   otherwise the host truth wins and the local copy goes to `onBackup`.
     * @returns the mode this client settled into.
     */
    start(legacy?: () => BoardView | undefined): Promise<SyncMode>;
    /** Stop every loop, close the stream, release the lease best-effort. */
    dispose(): void;
    getMode(): SyncMode;
    /** Whether the host truth is adopted (false before/during boot and in
     *  fallback mode). Store seams read the offline mirror while false, so the
     *  board mounts on local data instantly and converges when the line allows —
     *  the entry never waits on the network. */
    isSynced(): boolean;
    isEngine(): boolean;
    /** The effective local view: baseline overlaid with un-acked dirty state.
     *  Tasks merge by id (never whole-array overlay): the dirty array keeps its
     *  order, and baseline-only rows (remote arrivals during a parked spell)
     *  append read-only — a parked replica keeps READING convergence even
     *  though its writes wait. Accrued deletions stay excluded on both sides. */
    view(): BoardView;
    baselineRevision(): number;
    setTasks(tasks: readonly TaskRecord[]): void;
    setCruise(value: CruiseValue): void;
    setSchedulePresets(value: SchedulePreset[]): void;
    setRunPresets(value: RunPresetsDocument): void;
    /** Relay one user-initiated launch to the engine (non-engine replicas). */
    requestLaunch(taskId: string, trigger: 'manual' | 'schedule' | 'chain'): void;
    onRemote(listener: (view: BoardView, revision: number) => void): void;
    /** Fires whenever the SEAT changes — either half of it: which replica
     *  holds the engine, or the host's lease protocol version (a host restart
     *  flips the protocol without flipping the seat; the listener re-reads
     *  `hostProtoVersion()` alongside the held flag). */
    onEngine(listener: (held: boolean) => void): void;
    onCommand(listener: (command: BoardCommand) => void): void;
    onBackup(listener: (view: BoardView) => void): void;
    /** Stream health (diagnostic only): opens, remote frames, last frame time.
     *  A stream that opened but never delivers is the classic tunnel/proxy kill
     *  — the poll loop below calls it out instead of letting "no sync" stay a
     *  mystery. */
    private streamOpens;
    private streamFrames;
    private lastFrameAt;
    private streamDeathNoted;
    private onStreamEvent;
    private scheduleCommit;
    /** Send the current dirty view (one in flight at a time, trailing refire). */
    flush(): Promise<void>;
    /** Adopt an authoritative document (never backwards) and notify the replica. */
    private adopt;
    /** Coalesced resync after a remote-change frame. */
    private scheduleResync;
    /** Self-heal a parked writer: when a read proves the host reachable again
     *  (successful poll, reopened stream, foreground return) and dirty state
     *  waits with no timer driving it, probe once through the single funnel.
     *  The probe is BUDGET-NEUTRAL (it never restarts the retry cycle — a
     *  failed probe falls straight back into silence, a success resets the
     *  counter): otherwise every poll would reopen a full backoff chain and
     *  parking would never hold. Only a real user write reopens the budget. */
    private probeParked;
    /** Fetch only when the host revision moved past the baseline. */
    poll(): Promise<void>;
    /** Renew (or take) the engine lease; publish SEAT changes (held AND the
     *  host's protocol version — a host restart changes only the latter). The
     *  request carries this tab's VISIBILITY — the host lets a visible replica
     *  preempt a hidden holder, so the engine always sits where the user is. */
    renewLease(): Promise<void>;
    /** The host's engine-lease protocol (1 = pre-visibility, 2 = preemption);
     *  undefined until the first lease read — "not yet known" is not "old". */
    hostProtoVersion(): number | undefined;
    /** When the answering host process booted; undefined until the first lease
     *  read. The stale-host dialog shows it so "我明明重启了" is settled by a
     *  clock reading (old process vs. a different instance behind the URL). */
    hostBootTime(): number | undefined;
    /** Yield the seat on a lease frame (the protocol cannot change there —
     *  only the held flag is announced). */
    private setEngine;
    /** A self-rescheduling loop (first step after `ms`; cancel stops it). */
    private every;
}
/** The slice of the sync client the adapters use (easy to fake in tests). */
export interface SyncLedger {
    /** Whether the host truth is adopted (see {@link BoardSyncClient.isSynced}). */
    isSynced(): boolean;
    view(): BoardView;
    setTasks(tasks: readonly TaskRecord[]): void;
    setCruise(value: CruiseValue): void;
    setSchedulePresets(value: SchedulePreset[]): void;
    setRunPresets(value: RunPresetsDocument): void;
}
/** TaskStore over the synced document (+ optional warm mirror). Reads take
 *  the offline mirror until the host truth is adopted, so first paint never
 *  waits on the network; writes always warm the mirror AND mark the synced
 *  view dirty (a pre-sync write rides the boot migration via the mirror). */
export declare class SyncedTaskStore implements TaskStore {
    private readonly sync;
    private readonly mirror?;
    constructor(sync: SyncLedger, mirror?: TaskStore | undefined);
    load(): TaskRecord[];
    save(tasks: readonly TaskRecord[]): void;
    clear(): void;
}
/** PresetStore over the synced schedule-presets section. The mirror is
 *  write-only once synced (the synced view is the freshest truth); before
 *  adoption it is the read source (same offline-first discipline as tasks). */
export declare class SyncedPresetStore implements PresetStore {
    private readonly sync;
    private readonly mirror?;
    constructor(sync: SyncLedger, mirror?: PresetStore | undefined);
    load(): SchedulePreset[];
    save(presets: readonly SchedulePreset[]): void;
    clear(): void;
}
/** RunPresetStore over the synced run-presets section (mirror write-only,
 *  same discipline as SyncedPresetStore). */
export declare class SyncedRunPresetStore implements RunPresetStore {
    private readonly sync;
    private readonly mirror?;
    constructor(sync: SyncLedger, mirror?: RunPresetStore | undefined);
    load(): RunPresetsDocument;
    save(doc: RunPresetsDocument): void;
    clear(): void;
}
/**
 * A cruise-state store over the synced cruise section (the controller's
 * CruiseStorageFace: read returns the current value, write marks it dirty).
 * The offline mirror (write-only, same discipline as the other synced
 * stores) keeps the local cruise key fresh for fallback-mode first paint.
 */
export declare class SyncedCruiseStore {
    private readonly sync;
    private readonly mirror?;
    constructor(sync: SyncLedger, mirror?: {
        write(state: CruiseValue): void;
    } | undefined);
    read(): CruiseValue | undefined;
    write(state: CruiseValue): void;
}
