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
import type { BoardDoc, BoardView } from './board-doc.ts';
import type { BoardCommit, BoardCommand, BoardEvent, CruiseValue, LeaseWire } from './board-doc.ts';
import type { ItemsCommit, ItemsDoc } from './items-doc.ts';
import type { ItemRecord } from './item.ts';
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
/** The same envelope for the SECOND document (the checklist), whose body is
 *  an `ItemsDoc` rather than a `BoardDoc`. Two shapes, one envelope — the
 *  route answers both tails with `{ ok, value }`. */
export interface ItemsSyncFetchResult {
    available: boolean;
    revision: number;
    doc?: ItemsDoc;
    unchanged?: boolean;
}
/** The board-route transport (the wiring implements it with fetch + EventSource). */
export interface BoardSyncTransport {
    fetch(clientId: string, since: number | undefined): Promise<SyncFetchResult | undefined>;
    commit(commit: BoardCommit): Promise<SyncFetchResult | undefined>;
    /** The checklist's read end. Absent on a host that predates the second
     *  document: the session treats it exactly like an unreachable host for
     *  that document alone — the board keeps syncing untouched. */
    itemsFetch?(clientId: string, since: number | undefined): Promise<ItemsSyncFetchResult | undefined>;
    /** The checklist's write end (absent together with {@link itemsFetch}). */
    itemsCommit?(commit: ItemsCommit): Promise<ItemsSyncFetchResult | undefined>;
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
    /** The checklist's offline mirror (the wiring: a localStorage key). Also the
     *  evidence that lets the replica say "the host cannot read it" instead of
     *  rendering an empty list as if the person had written nothing. */
    checklistMirror?: ChecklistMirrorFace;
    log?: (message: string, error?: unknown) => void;
}
export declare class BoardSyncClient {
    private readonly deps;
    /** Identity of this tab for lease/relay purposes (stable per instance). */
    readonly clientId: string;
    /** The SECOND document's replica, owned outright by this session. It rides
     *  the same loops, the same SSE stream and the same lease; what it does NOT
     *  share is a single byte of replica state with the board. */
    private readonly checklist;
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
    /** The checklist's replica — the wiring mounts the panel on it. */
    checklistReplica(): ChecklistReplica;
    onChecklistRemote(listener: (items: readonly ItemRecord[], revision: number) => void): void;
    onChecklistBackup(listener: (items: readonly ItemRecord[]) => void): void;
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
/** The offline mirror for the checklist (the wiring backs it with a
 *  localStorage key). Reads feed first paint before adoption; writes keep the
 *  key warm AND are the evidence that a non-empty host view is suspicious. */
export interface ChecklistMirrorFace {
    load(): ItemRecord[];
    save(items: readonly ItemRecord[]): void;
    clear(): void;
}
/** Everything the replica needs from the session, injected so tests drive it
 *  without a browser or a server. */
export interface ChecklistReplicaDeps {
    clientId: string;
    transport: BoardSyncTransport;
    defer(fn: () => void, ms: number): () => void;
    now?: () => number;
    commitDebounceMs?: number;
    /** Remote-change coalescing before a resync fetch (same default as the session). */
    resyncCoalesceMs?: number;
    mirror?: ChecklistMirrorFace;
    log?: (message: string, error?: unknown) => void;
}
/** The checklist as one browser-side replica of the host's second document. */
export declare class ChecklistReplica {
    private readonly deps;
    private doc;
    /** Un-acked rows (undefined = identical to the baseline). */
    private dirty;
    /** The exact array in flight, identity-compared on ack. */
    private inFlight;
    private readonly claims;
    private deleted;
    private refire;
    private commitAttempts;
    private commitCancel;
    private backoffCancel;
    private resyncCancel;
    private disposed;
    /** Set once the host has answered for this document at least once. */
    private reachable;
    private readonly now;
    private readonly defer;
    private readonly commitDebounceMs;
    private readonly resyncCoalesceMs;
    private readonly log;
    private remoteListener;
    private backupListener;
    constructor(deps: ChecklistReplicaDeps);
    /** Adopt the host's first view and run the same migration probe the board
     *  runs: an empty host document plus a non-empty local mirror uploads once. */
    start(): Promise<void>;
    /** Whether the host truth is adopted for the checklist. */
    isSynced(): boolean;
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
    hostLostItems(): boolean;
    /** The effective local view: baseline overlaid with un-acked rows, with
     *  accrued deletions excluded on both sides (same law as the board's rows —
     *  the dirty array keeps its order, baseline-only rows append read-only). */
    view(): readonly ItemRecord[];
    baselineRevision(): number;
    /** Mark the checklist dirty and queue a commit. */
    setItems(items: readonly ItemRecord[]): void;
    onRemote(listener: (items: readonly ItemRecord[], revision: number) => void): void;
    onBackup(listener: (items: readonly ItemRecord[]) => void): void;
    /** A remote checklist frame: own commits arrive via the response, remote ones
     *  need a resync. This is what keeps a phone-side note from resyncing the
     *  whole board. */
    onRemoteFrame(clientId: string): void;
    dispose(): void;
    private scheduleCommit;
    /** Send the current dirty view (one in flight at a time, trailing refire). */
    flush(): Promise<void>;
    /** Adopt an authoritative checklist (never backwards) and notify the replica. */
    private adopt;
    private scheduleResync;
    /** Fetch only when the host's checklist revision moved past the baseline. */
    poll(): Promise<void>;
    private fetchDoc;
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
 * The cruise offline mirror: the local cruise key in the browser (`read` feeds
 * first paint before adoption, `write` keeps the key warm). Structurally the
 * controller's CruiseStorageFace, declared here so this adapter never imports
 * the controller.
 */
export interface CruiseMirrorFace {
    read(): Partial<CruiseValue> | undefined;
    write(state: CruiseValue): void;
}
/**
 * A cruise-state store over the synced cruise section (the controller's
 * CruiseStorageFace: read returns the current value, write marks it dirty).
 * The mirror serves reads until the host truth is adopted — the same
 * offline-first discipline as the other synced stores — so a reload
 * first-paints the cruise the user last set instead of the empty document's
 * enabled:false default, and the local key stays the fallback-mode truth.
 */
export declare class SyncedCruiseStore {
    private readonly sync;
    private readonly mirror?;
    constructor(sync: SyncLedger, mirror?: CruiseMirrorFace | undefined);
    read(): Partial<CruiseValue> | undefined;
    write(state: CruiseValue): void;
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
export declare class SyncedItemsStore {
    private readonly replica;
    private readonly mirror?;
    constructor(replica: ChecklistReplica, mirror?: ChecklistMirrorFace | undefined);
    load(): readonly ItemRecord[];
    save(items: readonly ItemRecord[]): void;
    clear(): void;
    /** Whether the host is answering but its checklist reads empty while the
     *  mirror still holds rows — a damaged document, which must be SAID, never
     *  rendered as "you have nothing". */
    hostLostItems(): boolean;
}
