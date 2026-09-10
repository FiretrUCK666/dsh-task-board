import type { BoardCommand, BoardCommit, BoardDoc, BoardEvent, LeaseState } from '../core/board-doc.ts';
export type { BoardCommand, BoardEvent, LeaseState } from '../core/board-doc.ts';
/** Structural face of the storage hub's opened KV unit (no SDK import). */
export interface KvUnitLike {
    loadAll(): Promise<{
        global: unknown;
    }>;
    setGlobal(value: unknown): Promise<void>;
    close(): Promise<void>;
}
/** Opens the board unit over the platform storage hub; undefined = no hub. */
export type KvUnitOpener = () => Promise<KvUnitLike | undefined>;
/** The unit identity stamped on the medium (name must be file-safe: the
 * platform's UNIT_NAME_RE is `^[a-z][a-z0-9_]*$` — underscores, not hyphens). */
export declare const BOARD_UNIT_NAME = "dsh_task_board";
/** The document grammar version this build reads and writes. */
export declare const BOARD_UNIT_VERSION = 1;
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
 * The host-side board truth: document + lease + relay. Every mutation runs
 * on one serialized write lane (the storage domain's single-write-chain
 * discipline), so commits from many replicas interleave in arrival order and
 * the merge grammar resolves them.
 */
export declare class BoardDataService {
    private readonly deps;
    private doc;
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
     * Open the persistence unit and load the document. Failure to open or read
     * leaves the service unavailable (replicas fall back); a corrupt medium is
     * normalized, never fatal.
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
    /**
     * Apply one replica commit through the merge grammar. The write lane
     * serializes commits; persistence completes before the response resolves
     * (durability before ack). A no-op commit never persists nor broadcasts.
     * @returns the authoritative document after the commit.
     */
    commit(commit: BoardCommit): Promise<BoardDoc>;
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
 * the `json` backend's KV facet, and open the board unit. A missing hub or
 * backend yields undefined (the service then reports unavailable — fallback
 * mode, never a throw).
 */
export declare function storageHubOpener(storage: () => unknown): KvUnitOpener;
