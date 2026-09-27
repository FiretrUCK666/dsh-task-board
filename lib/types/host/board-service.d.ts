import type { BoardCommand, BoardCommit, BoardDoc, BoardEvent, LeaseState } from '../core/board-doc.ts';
import type { ItemsCommit, ItemsDoc } from '../core/items-doc.ts';
import { type RetireOptions, type RetireOutcome } from './data-root.ts';
export type { BoardCommand, BoardEvent, LeaseState } from '../core/board-doc.ts';
export type { ItemsCommit, ItemsDoc } from '../core/items-doc.ts';
/** Structural face of the storage hub's opened KV unit (no SDK import).
 *
 *  The real unit is `table + key` plus a DECLARED global slot, not a key-value
 *  pair store: `loadAll` returns every table's records plus the global, and a
 *  write is addressed by table and key. This unit declares no global, so the
 *  board is one record in one table and `setGlobal` is deliberately absent —
 *  the backend throws for that call on a unit without the global slot. */
export interface KvUnitLike {
    loadAll(): Promise<{
        tables?: Record<string, Record<string, unknown>>;
        global?: unknown;
    }>;
    putRecord(table: string, key: string, value: unknown): Promise<void>;
    close(): Promise<void>;
}
/** The unit descriptor the hub's `kv.open` takes (structural, no SDK import). */
export interface BoardUnitDescriptor {
    readonly name: string;
    readonly version: number;
    readonly tables: readonly string[];
    readonly hasGlobal: boolean;
    readonly layout?: 'single' | 'per-record';
}
/** Opens one unit over the platform storage hub; undefined = no hub.
 *
 *  The descriptor is a parameter so the one-time layout migration can open the
 *  old whole-unit shape and the new document tree in sequence: the backend
 *  allows exactly one live handle per unit NAME, so those two opens can never
 *  overlap and the descriptor is the only thing that says which is which. */
export type KvUnitOpener = (descriptor: BoardUnitDescriptor) => Promise<KvUnitLike | undefined>;
/** The unit identity stamped on the medium (name must be file-safe: the
 * platform's UNIT_NAME_RE is `^[a-z][a-z0-9_]*$` — underscores, not hyphens). */
export declare const BOARD_UNIT_NAME = "dsh_task_board";
/** The unit format version this build writes: 2 is the document tree. */
export declare const BOARD_UNIT_VERSION = 2;
/** The unit version the pre-tree whole-unit file carried. Read once by the
 *  one-time migration, and never looked for again after that. */
export declare const LEGACY_UNIT_VERSION = 1;
/** The one declared table; every document this plugin owns is a record in it. */
export declare const BOARD_UNIT_TABLE = "documents";
/** The document name holding the board truth. */
export declare const BOARD_DOCUMENT = "board";
/** The document name holding the checklist truth — the second synced document,
 *  a sibling of the board rather than a view over it (its own revision, its own
 *  short-number counter). */
export declare const ITEMS_DOCUMENT = "items";
/** The document name holding migration bookkeeping — the marker that lets a
 *  boot know it must never go looking for the legacy file again. */
export declare const META_DOCUMENT = "meta";
/** The document tree this build opens. In the `per-record` layout the unit
 *  NAME is also its directory name, which is why this plugin's data root reads
 *  `dsh_task_board` and can never be a hyphenated directory: UNIT_NAME_RE. */
export declare const BOARD_UNIT_DESCRIPTOR: BoardUnitDescriptor;
/** The pre-tree whole-unit shape, opened only while migrating. */
export declare const LEGACY_UNIT_DESCRIPTOR: BoardUnitDescriptor;
/** What opening the unit produced.
 *
 *  `documents` is the WHOLE declared table, by document name — not a list of
 *  documents this function knows about. Naming a document here is how that
 *  document used to be dropped: a tree holding `items.json` but no `meta.json`
 *  used to answer with the board alone, and the checklist was gone. So the
 *  value is what the medium holds and the caller picks its own document out of
 *  it; the next document needs a constant, not a change here. */
export interface OpenedDocuments {
    /** The live document-tree handle; every later write goes through it. */
    readonly unit: KvUnitLike;
    /** Every record the declared table holds, by document name. */
    readonly documents: Record<string, unknown>;
    /** Present only on the boot that ran the layout migration. */
    readonly retired?: RetireOutcome;
}
/**
 * Open the unit, migrating the pre-tree whole-unit file exactly once.
 *
 * The migration must SEQUENCE two opens of one unit name, because the backend
 * gives a name exactly one live handle.
 *
 * THE QUESTION THIS ASKS IS "HAS THIS TREE EVER BEEN WRITTEN", NOT "IS THE
 * MARKER THERE" and never "is THIS document there". Those are three different
 * questions, and only the first one is about the unit: a tree holding any
 * record at all is already in the per-record layout, so the pre-tree file is
 * stale by definition and importing it over that tree would overwrite newer
 * data. A question about one document in a table of many is a question the
 * next document silently loses — which is exactly how a checklist could vanish
 * on a boot whose tree was missing nothing but the marker, while its own
 * `items.json` sat right there on disk. So: ANY record ends the probe, and the
 * marker is a record like any other.
 *
 * Deleting the data root is therefore a real reset, and stays one: the tree
 * comes back empty, and the probe has nothing to import because the migration
 * that once read the old file moved it aside (see data-root.ts).
 *
 * The board document is written BEFORE the marker, so a crash mid-migration
 * repeats a probe that is idempotent rather than skipping one that is not. The
 * value handed back is re-read from the medium rather than assembled from what
 * this function remembers writing, so a record it has no name for still comes
 * back.
 * @param openUnit - the hub opener.
 * @param now - clock for the migration stamps.
 * @param log - diagnostic sink.
 * @param retire - the legacy-file retirement step; injected so the migration
 *  is testable without a filesystem, and so the production path stays the only
 *  caller of the real one.
 * @returns the open unit and every document it holds, or undefined when no hub.
 */
export declare function openBoardUnit(openUnit: KvUnitOpener, now: number, log: (message: string, error?: unknown) => void, retire?: (options: RetireOptions) => Promise<RetireOutcome>): Promise<OpenedDocuments | undefined>;
/** Lease tuning: the client renews well inside the TTL; a dropped stream
 *  shortens the holder's lease to the grace window. */
export declare const LEASE_DEFAULT_TTL_MS = 20000;
export declare const LEASE_MIN_TTL_MS = 10000;
export declare const LEASE_MAX_TTL_MS = 60000;
export declare const LEASE_DISCONNECT_GRACE_MS = 5000;
/** How long an open SSE stream alone may keep a holder alive WITHOUT any API
 *  touch. A frozen/hibernating tab's socket stays half-open, so stream liveness
 *  is bounded by real HTTP touches — otherwise a zombie holder can never be
 *  preempted and the whole fleet starves (nobody pumps, nobody records turns). */
export declare const STREAM_ALIVE_MAX_MS: number;
/** The engine-lease protocol version. A client that predates the visibility
 *  flag never sends `active`; a client that sees NO version in the response
 *  knows the host is stale (pre-preemption) and can say so on the board —
 *  the "修了但没生效" mystery made visible. */
export declare const LEASE_PROTOCOL_ACTIVE = 2;
/** The cap on parked launch commands (newest-per-task dedup keeps this small). */
export declare const PENDING_COMMAND_LIMIT = 20;
/** One relayed user action lives in the shared core (see BoardCommand). */
/** Injectable seams (tests drive the service with fakes). */
export interface BoardServiceDeps {
    /** Clock; defaults to Date.now. */
    now?: () => number;
    /** Opens the persistence unit; absent = persistence unavailable (fallback mode). */
    openUnit?: KvUnitOpener;
    /** Diagnostic sink; defaults to console. */
    log?: (message: string, error?: unknown) => void;
}
/**
 * The host-side truth: documents + lease + relay. Every mutation to every
 * document runs on ONE serialized write lane (the storage domain's
 * single-write-chain discipline — the unit serializes nothing and says so),
 * so commits from many replicas interleave in arrival order and each
 * document's merge grammar resolves them. One lane, not one per document: the
 * two disciplines it buys are "the merge runs against the newest in-memory
 * document" and "one write in flight at a time", and both are pinned by tests.
 *
 * THE LEASE AND THE RELAY ARE UNIT-LEVEL ARBITRATIONS, not board facts, and
 * they ride in this class because of the one thing they cannot route around:
 * the backend gives a unit exactly one live handle, so everything that
 * arbitrates or moves data in this unit has to be reachable from the one
 * object holding it. Concretely — one engine drives time-based automation over
 * BOTH documents, and a command relayed from a non-engine replica is executed
 * by whichever replica holds the seat, whoever wrote the row. Reading the
 * lease as "the board's lease" is the mistake this paragraph exists to
 * prevent: it is the seat for the unit, and its state never mentions a
 * document.
 */
export declare class DocumentService {
    private readonly deps;
    private doc;
    private items;
    private unit;
    private lease;
    /** Live SSE connections per clientId. An open stream is the holder's
     *  liveness proof: unlike client timers it survives background-tab timer
     *  throttling, so the engine lease never flaps while its stream is up. */
    private readonly streams;
    private pendingCommands;
    private readonly listeners;
    private lane;
    private started;
    private initPromise;
    private disposed;
    /** Whether the board API serves synced documents (false = replica fallback). */
    available: boolean;
    private readonly now;
    private readonly log;
    /** When THIS host process started serving the board (carried on every lease
     *  answer). The board's stale-host dialog shows it: "我明明重启了它还这么
     * 显示" has exactly two answers — this process really is the old one, or the
     *  address is talking to a different instance — and a real clock reading
     *  settles it on the spot instead of leaving the user to guess. */
    readonly bootedAt: number;
    constructor(deps?: BoardServiceDeps);
    /**
     * Open the persistence unit and load every document it holds, running the
     * one-time layout migration when the data root has never been written.
     * Failure to open or read leaves the service unavailable (replicas fall
     * back); a corrupt medium is normalized per document, never fatal.
     */
    init(): Promise<void>;
    /**
     * The one-started gate every route call passes through: the storage hub is
     * resolved lazily (the opener reads `ctx.get('storage')` at call time), so
     * the first browser request — always after boot settlement — initializes
     * the unit, and every later call rides the settled result.
     */
    ensureInit(): Promise<void>;
    /** The current authoritative document (detached reads are the caller's job). */
    getDoc(): BoardDoc;
    /** The current authoritative checklist — the second document, with its own
     *  revision and its own short-number counter (detached reads are the
     *  caller's job). */
    getItemsDoc(): ItemsDoc;
    /**
     * Apply one replica commit through the merge grammar. The write lane
     * serializes commits; persistence completes before the response resolves
     * (durability before ack). A no-op commit never persists nor broadcasts.
     * @returns the authoritative document after the commit.
     */
    commit(commit: BoardCommit): Promise<BoardDoc>;
    /**
     * Apply one replica commit to the CHECKLIST through its own merge grammar —
     * the same lane, the same durability-before-ack order, the same no-op rule,
     * and its own document file. A checklist change does not touch the board's
     * revision or the board's record: two documents, two revisions, and one
     * write lane.
     *
     * IT BROADCASTS NOTHING, and the reason is the CONSUMER, not the frame: a
     * `commit` frame now names its document, so announcing a checklist write is
     * a well-formed frame — but every stream consumer still reads a commit as
     * "the board moved" and schedules a board resync (see
     * `BoardSyncClient.onStreamEvent`). Announcing item writes before the
     * consumers sort the two documents apart would make one checklist edit
     * resync the board on every device, which is the exact thing the second
     * document's own revision exists to prevent. The write is durable and
     * durable-before-ack either way; only the announcement waits.
     * @returns the authoritative checklist after the commit.
     */
    commitItems(commit: ItemsCommit): Promise<ItemsDoc>;
    /**
     * Acquire or renew the engine lease. Liveness is the leaseState view (an
     * open SSE stream or any board API call keeps the holder alive); a free or
     * expired lease is granted to the caller.
     *
     * VISIBILITY PREEMPTION: every request carries `active` (the tab is
     * visible). A VISIBLE requester takes the seat from an INACTIVE holder —
     * the engine must sit where the user is looking, or native-turn recording
     * and dispatch stall on a frozen background tab (the "手机点开始没反应、
     * 电脑端才动" class). Two visible replicas never flip-flop: first-held
     * keeps the seat while it renews; an all-hidden fleet keeps the last holder
     * (scheduled automation survives nobody-looking).
     */
    acquireLease(clientId: string, ttlMs?: number, active?: boolean): LeaseState;
    /** Voluntary release (page teardown): frees the seat immediately. */
    releaseLease(clientId: string): LeaseState;
    /** Any API touch from the holder renews the lease for its granted TTL
     *  (throttle-proof: every commit/get/lease call refreshes the seat). */
    noteActivity(clientId: string | undefined): void;
    /** An SSE connection dropped: retire its count; when the holder's last
     *  stream goes, shorten its lease to the grace window (a reload reopens the
     *  stream and keeps the seat; a closed tab yields it fast). */
    noteDisconnect(clientId: string | undefined): void;
    /** The current lease state. A holder with a live SSE stream never expires
     *  (the stream is refreshed by the keep-alive writes; a dead one surfaces
     *  through noteDisconnect); an expired lease reads as free, holderless.
     *
     *  THE one construction site of a LeaseState: every lease answer the route
     *  can ever send (granted / renewing / rejected / released) is derived from
     *  this object, so no branch can ship a seat view that forgets `proto` or
     *  `bootedAt`. A missing `proto` read as "old host", which made the
     *  "服务端未重启" banner stand forever on every non-engine device — the
     *  rejected branch used to hand-build `{ held, holder, expiresAt }` and
     *  nothing else. */
    leaseState(now?: number): LeaseState;
    /** An SSE connection for `clientId` opened (route layer, stream accepted). */
    noteStreamOpen(clientId: string | undefined): void;
    /**
     * Relay one user-initiated launch to the engine. With a live engine the
     * command broadcasts immediately; otherwise it parks (newest per task) and
     * replays when the next lease is granted.
     */
    submitCommand(command: BoardCommand): {
        queued: boolean;
    };
    /** Subscribe to board events (the SSE layer). @returns the disposer. */
    subscribe(listener: (event: BoardEvent) => void): () => void;
    /** Drain the unit and stop serving. */
    dispose(): Promise<void>;
    private parkCommand;
    private drainPendingCommands;
    private broadcast;
    private enqueue;
}
/** Clamp the requested TTL into the safe band. */
export declare function clampLeaseTtl(ttlMs: number | undefined): number;
/**
 * Wire the service onto the platform storage hub: resolve `ctx.storage` at
 * open time (boot settlement has passed by the first browser request), take
 * the `json` backend's KV facet, and open the unit the descriptor names. A
 * missing hub or backend yields undefined (the service then reports
 * unavailable — fallback mode, never a throw).
 */
export declare function storageHubOpener(storage: () => unknown): KvUnitOpener;
