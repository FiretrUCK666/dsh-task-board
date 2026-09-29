/**
 * Board data service (host half): the authoritative documents every browser
 * replica syncs against — today the board and the checklist — plus the two
 * arbitrations multi-device correctness needs: the engine lease and the
 * launch-command relay.
 *
 * The documents persist through the platform storage hub's `json` backend.
 * The unit is opened in the `per-record` layout, so everything this plugin
 * owns lives in ONE directory under the harness home's storage root with one
 * human-readable JSON document per data kind — today the board and the
 * checklist, and any later data kind beside them without disturbing them. The
 * hub owns the root, the naming rules and the atomic publish; this plugin only
 * names its unit and its documents.
 *
 * ONE unit carries both documents and ONE service holds the single live handle
 * that name allows — the backend gives a unit exactly one live handle, so
 * "a service per document" is not a choice the medium permits. That is also
 * what keeps every mutation to every document on one write lane.
 *
 * The hub is read structurally (`ctx.get('storage')`) exactly like
 * every other host route reads its service: when the deployment composes no
 * storage hub, or the medium fails to open, the service reports `available:false`
 * and the browser half falls back to its localStorage mode — a degraded board,
 * never a broken one.
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
import { join } from 'node:path'
import { applyCommit, emptyBoardDoc, normalizeBoardDoc } from '../core/board-doc.ts'
import type { BoardCommand, BoardCommit, BoardDoc, BoardEvent, LeaseState } from '../core/board-doc.ts'
import { applyItemsCommit, deletedItemsOf, emptyItemsDoc, normalizeItemsDoc, restoredItemOf } from '../core/items-doc.ts'
import type { ItemsCommit, ItemsDoc } from '../core/items-doc.ts'
import type { ItemRecord } from '../core/item.ts'
// Types only, and the reason is that a restore is addressed by TWO names: the
// wire shape and the row it names are one decision, and a service that declared
// its own copy of the address would be free to disagree with the route about
// which name a caller is allowed to send. The module is erased at build time, so
// this costs no runtime edge.
import type { RestoreAddress } from './board-route.ts'
import { retireLegacyUnitFile, unitDirectoryPath, type RetireOptions, type RetireOutcome } from './data-root.ts'

// The wire types live in the shared core (the client sync layer reads the
// same shapes); re-exported here so host callers keep one import surface.
export type { BoardCommand, BoardEvent, LeaseState } from '../core/board-doc.ts'
export type { ItemsCommit, ItemsDoc } from '../core/items-doc.ts'

/** Structural face of the storage hub's opened KV unit (no SDK import).
 *
 *  The real unit is `table + key` plus a DECLARED global slot, not a key-value
 *  pair store: `loadAll` returns every table's records plus the global, and a
 *  write is addressed by table and key. This unit declares no global, so the
 *  board is one record in one table and `setGlobal` is deliberately absent —
 *  the backend throws for that call on a unit without the global slot. */
export interface KvUnitLike {
  loadAll(): Promise<{ tables?: Record<string, Record<string, unknown>>; global?: unknown }>
  putRecord(table: string, key: string, value: unknown): Promise<void>
  close(): Promise<void>
}

/** The unit descriptor the hub's `kv.open` takes (structural, no SDK import). */
export interface BoardUnitDescriptor {
  readonly name: string
  readonly version: number
  readonly tables: readonly string[]
  readonly hasGlobal: boolean
  readonly layout?: 'single' | 'per-record'
}

/** Opens one unit over the platform storage hub; undefined = no hub.
 *
 *  The descriptor is a parameter so the one-time layout migration can open the
 *  old whole-unit shape and the new document tree in sequence: the backend
 *  allows exactly one live handle per unit NAME, so those two opens can never
 *  overlap and the descriptor is the only thing that says which is which. */
export type KvUnitOpener = (descriptor: BoardUnitDescriptor) => Promise<KvUnitLike | undefined>

/** The unit identity stamped on the medium (name must be file-safe: the
 * platform's UNIT_NAME_RE is `^[a-z][a-z0-9_]*$` — underscores, not hyphens). */
export const BOARD_UNIT_NAME = 'dsh_task_board'
/** The unit format version this build writes: 2 is the document tree. */
export const BOARD_UNIT_VERSION = 2
/** The unit version the pre-tree whole-unit file carried. Read once by the
 *  one-time migration, and never looked for again after that. */
export const LEGACY_UNIT_VERSION = 1
/** The one declared table; every document this plugin owns is a record in it. */
export const BOARD_UNIT_TABLE = 'documents'
/** The document name holding the board truth. */
export const BOARD_DOCUMENT = 'board'
/** The document name holding the checklist truth — the second synced document,
 *  a sibling of the board rather than a view over it (its own revision, its own
 *  short-number counter). */
export const ITEMS_DOCUMENT = 'items'
/** The document name holding migration bookkeeping — the marker that lets a
 *  boot know it must never go looking for the legacy file again. */
export const META_DOCUMENT = 'meta'
/** The document tree this build opens. In the `per-record` layout the unit
 *  NAME is also its directory name, which is why this plugin's data root reads
 *  `dsh_task_board` and can never be a hyphenated directory: UNIT_NAME_RE. */
export const BOARD_UNIT_DESCRIPTOR: BoardUnitDescriptor = {
  name: BOARD_UNIT_NAME,
  version: BOARD_UNIT_VERSION,
  tables: [BOARD_UNIT_TABLE],
  hasGlobal: false,
  layout: 'per-record',
}
/** The pre-tree whole-unit shape, opened only while migrating. */
export const LEGACY_UNIT_DESCRIPTOR: BoardUnitDescriptor = {
  name: BOARD_UNIT_NAME,
  version: LEGACY_UNIT_VERSION,
  tables: [],
  hasGlobal: true,
  layout: 'single',
}

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
  readonly unit: KvUnitLike
  /** Every record the declared table holds, by document name. */
  readonly documents: Record<string, unknown>
  /** Present only on the boot that ran the layout migration. */
  readonly retired?: RetireOutcome
}

/** The records of the declared table, or an empty view when it holds none. */
function documentsOf(snapshot: { tables?: Record<string, Record<string, unknown>> }): Record<string, unknown> {
  const table = snapshot.tables?.[BOARD_UNIT_TABLE]
  return typeof table === 'object' && table !== null ? table : {}
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
export async function openBoardUnit(
  openUnit: KvUnitOpener,
  now: number,
  log: (message: string, error?: unknown) => void,
  retire: (options: RetireOptions) => Promise<RetireOutcome> = retireLegacyUnitFile,
): Promise<OpenedDocuments | undefined> {
  let unit = await openUnit(BOARD_UNIT_DESCRIPTOR)
  if (unit === undefined) return undefined
  let documents = documentsOf(await unit.loadAll())
  if (Object.keys(documents).length > 0) return { unit, documents }

  // ── one-time layout migration ───────────────────────────────────────────
  await unit.close()
  const legacy = await openUnit(LEGACY_UNIT_DESCRIPTOR)
  let legacyBoard: unknown
  try {
    legacyBoard = legacy === undefined ? undefined : (await legacy.loadAll()).global
  } finally {
    await legacy?.close()
  }
  unit = await openUnit(BOARD_UNIT_DESCRIPTOR)
  if (unit === undefined) return undefined

  const imported = legacyBoard !== undefined && legacyBoard !== null
  if (imported) {
    await unit.putRecord(BOARD_UNIT_TABLE, BOARD_DOCUMENT, legacyBoard)
  }
  await unit.putRecord(BOARD_UNIT_TABLE, META_DOCUMENT, {
    schemaVersion: BOARD_UNIT_VERSION,
    legacyImported: imported,
    legacyProbedAt: now,
  })
  documents = documentsOf(await unit.loadAll())
  if (!imported) return { unit, documents }

  const retired = await retire({
    unitName: BOARD_UNIT_NAME,
    legacyVersion: LEGACY_UNIT_VERSION,
    migratedPath: join(unitDirectoryPath(BOARD_UNIT_NAME), BOARD_UNIT_TABLE, `${BOARD_DOCUMENT}.json`),
    now,
    log,
  })
  if (retired.status === 'retired') {
    log(`[dsh-task-board] layout migration: legacy unit document moved to ${retired.retiredPath}`)
  }
  return { unit, documents, retired }
}

/** Lease tuning: the client renews well inside the TTL; a dropped stream
 *  shortens the holder's lease to the grace window. */
export const LEASE_DEFAULT_TTL_MS = 20_000
export const LEASE_MIN_TTL_MS = 10_000
export const LEASE_MAX_TTL_MS = 60_000
export const LEASE_DISCONNECT_GRACE_MS = 5_000
/** How long an open SSE stream alone may keep a holder alive WITHOUT any API
 *  touch. A frozen/hibernating tab's socket stays half-open, so stream liveness
 *  is bounded by real HTTP touches — otherwise a zombie holder can never be
 *  preempted and the whole fleet starves (nobody pumps, nobody records turns). */
export const STREAM_ALIVE_MAX_MS = 4 * LEASE_DEFAULT_TTL_MS
/** The engine-lease protocol version. A client that predates the visibility
 *  flag never sends `active`; a client that sees NO version in the response
 *  knows the host is stale (pre-preemption) and can say so on the board —
 *  the "修了但没生效" mystery made visible. */
export const LEASE_PROTOCOL_ACTIVE = 2

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
/**
 * The dedup key of a parked command: its carrier plus whatever it targets.
 *
 * This deliberately does NOT narrow on `command.type`, and does not know which
 * carriers exist: it derives an IDENTITY, not a route. Narrowing here would put
 * a list of carriers into the service, and a carrier added to the union later
 * would need this file edited to keep its own commands from colliding. Reading
 * whichever id the command carries keeps this correct for carriers that do not
 * exist yet.
 */
function commandKeyOf(command: BoardCommand): string {
  return 'taskId' in command
    ? `${command.type}:${command.taskId}`
    : `${command.type}:${command.sessionId}`
}

export class DocumentService {
  private doc: BoardDoc = emptyBoardDoc(0)
  private items: ItemsDoc = emptyItemsDoc(0)
  private unit: KvUnitLike | undefined
  private lease: { clientId: string; expiresAt: number; ttl: number; active: boolean; lastTouchAt: number } | undefined
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
  /** When THIS host process started serving the board (carried on every lease
   *  answer). The board's stale-host dialog shows it: "我明明重启了它还这么
   * 显示" has exactly two answers — this process really is the old one, or the
   *  address is talking to a different instance — and a real clock reading
   *  settles it on the spot instead of leaving the user to guess. */
  readonly bootedAt: number

  constructor(private readonly deps: BoardServiceDeps = {}) {
    this.now = deps.now ?? (() => Date.now())
    this.log = deps.log ?? ((message, error) => (error === undefined ? console.error(message) : console.error(message, error)))
    this.bootedAt = this.now()
  }

  /**
   * Open the persistence unit and load every document it holds, running the
   * one-time layout migration when the data root has never been written.
   * Failure to open or read leaves the service unavailable (replicas fall
   * back); a corrupt medium is normalized per document, never fatal.
   */
  async init(): Promise<void> {
    if (this.started) return
    this.started = true
    if (this.deps.openUnit === undefined) {
      this.log('[dsh-task-board] board storage unavailable: no persistence opener wired')
      return
    }
    try {
      const opened = await openBoardUnit(this.deps.openUnit, this.now(), this.log)
      if (opened === undefined) {
        this.log('[dsh-task-board] board storage unavailable: no json backend on the storage hub')
        return
      }
      this.unit = opened.unit
      this.doc = normalizeBoardDoc(opened.documents[BOARD_DOCUMENT], this.now())
      this.items = normalizeItemsDoc(opened.documents[ITEMS_DOCUMENT], this.now())
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

  /** The current authoritative checklist — the second document, with its own
   *  revision and its own short-number counter (detached reads are the
   *  caller's job). */
  getItemsDoc(): ItemsDoc {
    return this.items
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
      /* PERSIST FIRST, PUBLISH SECOND, AND DO NOT SWALLOW THE FAILURE.
       *
       * The order was the opposite of what the comment above this method claimed,
       * and that claim is the whole defect. `this.doc = next` ran BEFORE
       * `putRecord`, so the in-memory revision advanced on every write; the put
       * was then wrapped in a catch that logged and continued. A full disk
       * therefore produced: a resolved promise, a revision that had moved, a
       * `200 {ok:true}` from the route, and — because every later `?since=N`
       * short-circuits on that revision — no replica ever asked for the write
       * again. Restart, and it was gone, with the ledger claiming a revision that
       * had never existed on the medium.
       *
       * The trade the old comment named ("the next commit persists both") only
       * holds if a later commit arrives. If none does, the gap is permanent, and
       * 「serving a revision the medium has never seen」 is a lost write wearing the
       * costume of a latency trade. So the put now happens before anything
       * observable moves, and a failure REJECTS: memory keeps the last good
       * document, the revision does not advance, the caller is not told it
       * landed, and the next commit — or the next restart — still sees a
       * consistent truth.
       *
       * The caller is the route, which turns a rejection into this prefix's own
       * `BoardRouteFail` — a 200 carrying `{ok:false,error:{code:'persist_failed'}}`,
       * which is what `/items/restore` already answers for the same class of
       * problem. */
      if (this.unit !== undefined) {
        await this.unit.putRecord(BOARD_UNIT_TABLE, BOARD_DOCUMENT, next)
      }
      this.doc = next
      this.broadcast({ type: 'commit', document: BOARD_DOCUMENT, revision: next.revision, clientId: commit.clientId })
      return next
    })
  }

  /**
   * Apply one replica commit to the CHECKLIST through its own merge grammar —
   * the same lane, the same durability-before-ack order, the same no-op rule,
   * and its own document file. A checklist change does not touch the board's
   * revision or the board's record: two documents, two revisions, and one
   * write lane.
   *
   * IT BROADCASTS, under the document's own name. A `commit` frame carries the
   * document it moved and the consumer routes on that (`host-sync.ts` sends an
   * `items` frame to the checklist replica and leaves the board asleep), so
   * announcing a checklist write wakes exactly the replica that needs it and
   * nobody else. Without the frame, a note written on one device is invisible
   * everywhere else until some unrelated change happens to resync — which is
   * the same fact stated the other way round: the write was durable and
   * durable-before-ack, only the announcement was missing.
   * @returns the authoritative checklist after the commit.
   */
  commitItems(commit: ItemsCommit): Promise<ItemsDoc> {
    return this.enqueue(async () => {
      const next = applyItemsCommit(this.items, commit, this.now())
      if (next === this.items) return this.items
      /* The same order, and for the same reason, as `commit`: nothing observable
       * moves until the medium has taken it. A note the reader is told is saved,
       * that exists only in this process's heap, is the one loss on this surface
       * that is both silent and permanent — a checklist row is often the only
       * record of an idea, and the window where it can vanish is exactly the
       * window where the disk is full. */
      if (this.unit !== undefined) {
        await this.unit.putRecord(BOARD_UNIT_TABLE, ITEMS_DOCUMENT, next)
      }
      this.items = next
      this.broadcast({ type: 'commit', document: ITEMS_DOCUMENT, revision: next.revision, clientId: commit.clientId })
      return next
    })
  }

  /**
   * Bring one deleted checklist row back, by identity or by short number.
   *
   * WHY THIS IS A SERVICE OPERATION AND NOT A CLIENT COMMIT. A tombstone is
   * stamped one millisecond ABOVE the row it removed, so re-submitting that row
   * untouched is exactly the stale copy the tombstone exists to swallow: the
   * commit would be accepted, nothing would change, and the caller would be
   * told it worked. Only the host knows the stamp, so only the host can write
   * the one value that has to be greater — {@link restoredItemOf} does that and
   * nothing else, and the row then rides the ordinary commit path, so restore
   * is a put like any other and needs no second merge rule.
   *
   * THE TWO ADDRESSES DIFFER ONLY IN HOW THE ROW IS FOUND, never in what is
   * written. By `id` there is no lookup at all: the tombstones are keyed by
   * identity, so the caller's uuid IS the key — which is what makes a row that
   * the document has not numbered yet (`ref === 0`) restorable at all, and an
   * undo gesture cannot know a number nobody has been shown. By `ref` the number
   * is a NAME, so it has to be looked up among the deletions first. Both end in
   * the same {@link restoredItemOf}, so the stamp that beats the tombstone is
   * written by one piece of code.
   *
   * An address that matches no tombstone is `undefined`, never a silent
   * success: the row is either still in the document (nothing to do), never
   * numbered, or past the tombstone's life — and in all three cases "restoring"
   * it would be a second row with a second number.
   *
   * @param of - which row, named by identity or by short number.
   * @param clientId - who asked, for the broadcast and the activity note.
   * @returns the restored row, or `undefined` when no tombstone holds that row.
   */
  async restoreItem(of: RestoreAddress, clientId: string): Promise<ItemRecord | undefined> {
    const id = of.kind === 'id'
      ? of.id
      : deletedItemsOf(this.items).find(item => item.ref === of.ref)?.id
    if (id === undefined) return undefined
    const restored = restoredItemOf(this.items, id, this.now())
    if (restored === undefined) return undefined
    await this.commitItems({ clientId, items: [restored], changed: [restored.id], deleted: [] })
    return restored
  }

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
  acquireLease(clientId: string, ttlMs?: number, active = true): LeaseState {
    const now = this.now()
    const ttl = clampLeaseTtl(ttlMs)
    const current = this.leaseState(now)
    if (current.held && current.holder !== clientId) {
      const holderLease = this.lease
      const holderActive = holderLease !== undefined && holderLease.clientId === current.holder
        ? holderLease.active
        : true
      if (!(active && holderActive === false)) {
        // Held (live stream or unexpired) by someone else: the caller is NOT
        // the engine. The SAME authoritative view with only the caller-relative
        // `held` flag flipped — never a re-typed object literal (that is how
        // `proto` went missing and the stale-host banner started lying).
        return { ...current, held: false }
      }
      // Preemption: a visible device takes the seat from a hidden holder.
      this.lease = { clientId, expiresAt: now + ttl, ttl, active, lastTouchAt: now }
      this.broadcast({ type: 'lease', holder: clientId, expiresAt: this.lease.expiresAt })
      this.drainPendingCommands()
      return this.leaseState(this.now())
    }
    const renewing = current.held && current.holder === clientId
    this.lease = { clientId, expiresAt: now + ttl, ttl, active, lastTouchAt: now }
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
    const now = this.now()
    this.lease = { ...this.lease, expiresAt: now + this.lease.ttl, lastTouchAt: now }
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
   *  through noteDisconnect); an expired lease reads as free, holderless.
   *
   *  THE one construction site of a LeaseState: every lease answer the route
   *  can ever send (granted / renewing / rejected / released) is derived from
   *  this object, so no branch can ship a seat view that forgets `proto` or
   *  `bootedAt`. A missing `proto` read as "old host", which made the
   *  "服务端未重启" banner stand forever on every non-engine device — the
   *  rejected branch used to hand-build `{ held, holder, expiresAt }` and
   *  nothing else. */
  leaseState(now = this.now()): LeaseState {
    if (this.lease === undefined) {
      return { held: false, holder: undefined, expiresAt: undefined, proto: LEASE_PROTOCOL_ACTIVE, bootedAt: this.bootedAt }
    }
    // Stream-alive renewal keeps a THROTTLED background tab (whose timers
    // crawl but whose JS still runs) in the seat it legitimately holds — but
    // only while it still TOUCHES the API. A half-open socket from a frozen
    // or hibernating tab proves nothing about the tab being alive; without
    // this bound a zombie holder could never be preempted by anyone.
    if ((this.streams.get(this.lease.clientId) ?? 0) > 0
      && this.lease.lastTouchAt + STREAM_ALIVE_MAX_MS > now) {
      // Stream-alive renewal: push the deadline out so a throttled background
      // tab keeps the seat it legitimately holds.
      if (this.lease.expiresAt < now + this.lease.ttl) {
        this.lease = { ...this.lease, expiresAt: now + this.lease.ttl }
      }
      return { held: true, holder: this.lease.clientId, expiresAt: this.lease.expiresAt, proto: LEASE_PROTOCOL_ACTIVE, bootedAt: this.bootedAt }
    }
    if (this.lease.expiresAt <= now) {
      return { held: false, holder: undefined, expiresAt: undefined, proto: LEASE_PROTOCOL_ACTIVE, bootedAt: this.bootedAt }
    }
    return { held: true, holder: this.lease.clientId, expiresAt: this.lease.expiresAt, proto: LEASE_PROTOCOL_ACTIVE, bootedAt: this.bootedAt }
  }

  /** An SSE connection for `clientId` opened (route layer, stream accepted). */
  noteStreamOpen(clientId: string | undefined): void {
    if (clientId === undefined || clientId === '') return
    this.streams.set(clientId, (this.streams.get(clientId) ?? 0) + 1)
  }

  /**
   * Relay one user-initiated launch to the engine. With a LIVE engine the
   * command broadcasts immediately; otherwise it parks (newest per task) and
   * replays when the next lease is granted.
   *
   * `held` ALONE IS NOT ENOUGH, and the two states it conflates are the whole
   * defect. `held` is true for any unexpired lease object, and a replica that
   * took the seat and went away — a closed tab, a hibernated machine with a
   * half-open socket — still holds one. So the command was broadcast to nobody who
   * can act on it: `host-sync` drops a `command` frame unless THAT replica
   * believes it is the engine, and every live replica reads the seat as
   * unheld. Nothing was parked, so `drainPendingCommands` had nothing to replay
   * and the launch was gone for good — while the caller was told
   * `queued: false`, which the agent's tool renders as 「已交给引擎执行一次」.
   *
   * So the question is not 「is the seat claimed」 but 「can the holder act」, and
   * that is `streams.get(holder) > 0`. The trade is stated rather than hidden: an
   * engine whose stream is momentarily down now parks instead of broadcasting, and
   * the receipt becomes the honest `queued: true` — 「已受理，引擎当前不在线」.
   * Parking is the recoverable branch, and these two states are
   * indistinguishable from here, so the recoverable one is the right default.
   */
  submitCommand(command: BoardCommand): { queued: boolean } {
    const now = this.now()
    const state = this.leaseState(now)
    const holder = state.held ? this.lease?.clientId : undefined
    const holderIsListening = holder !== undefined && (this.streams.get(holder) ?? 0) > 0
    if (!state.held || !holderIsListening) {
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
    this.pendingCommands.set(commandKeyOf(command), command)
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
 * Process-wide acquisition of the board's truth.
 *
 * THE PLATFORM GIVES A UNIT EXACTLY ONE LIVE HANDLE, and this plugin now
 * occupies more than one loader row: the package row serves the browser routes
 * while the agent row serves the model tools, and both need the SAME
 * DocumentService. Two `new DocumentService` calls open the unit twice; the
 * second open throws "already open", and whichever row lost the race serves
 * fallback mode — the board looks alive while the host truth sits in the other
 * row. So no row constructs the service any more: each ACQUIRES it here and
 * RELEASES it on unload, and the last release closes the unit.
 *
 * WHY THE REGISTRY LIVES ON globalThis RATHER THAN IN MODULE STATE. The rows
 * build as separate bundles, and separate bundles may each carry their own
 * copy of this module — a module-level `Map` would then be two maps, and the
 * sharing would be a fiction no test could catch (tests run one copy).
 * globalThis is one per process, and the platform's constraint is per process,
 * so the registry mirrors the platform truth instead of the bundler's
 * accident.
 */
interface BoardServiceHandle {
  service: DocumentService
  owners: number
}

const BOARD_SERVICE_REGISTRY_KEY = '__dshTaskBoardUnits'

function boardServiceRegistry(): Map<string, BoardServiceHandle> {
  const scope = globalThis as unknown as Record<string, unknown>
  const existing = scope[BOARD_SERVICE_REGISTRY_KEY]
  if (existing instanceof Map) return existing as Map<string, BoardServiceHandle>
  const fresh = new Map<string, BoardServiceHandle>()
  scope[BOARD_SERVICE_REGISTRY_KEY] = fresh
  return fresh
}

function releaseOf(registry: Map<string, BoardServiceHandle>, handle: BoardServiceHandle): () => void {
  let released = false
  return () => {
    if (released) return
    released = true
    handle.owners -= 1
    if (handle.owners > 0) return
    if (registry.get(BOARD_UNIT_NAME) === handle) registry.delete(BOARD_UNIT_NAME)
    void handle.service.dispose()
  }
}

/**
 * Borrow the process's one DocumentService for the board unit.
 *
 * The first acquirer creates it and kicks off init; later acquirers share it,
 * so the routes and the model tools always read and write through the same
 * handle, the same lease and the same write lane. Each `release` gives up one
 * ownership; the last one closes the unit — unloading the agent row never
 * starves the board row, and unloading the board row never strands the tools.
 * @param openUnit - the hub opener, used only by the acquisition that creates.
 * @returns the shared service plus the one ownership this caller must release.
 */
export function acquireBoardService(openUnit: KvUnitOpener): { service: DocumentService; release: () => void } {
  const registry = boardServiceRegistry()
  const held = registry.get(BOARD_UNIT_NAME)
  if (held !== undefined) {
    held.owners += 1
    return { service: held.service, release: releaseOf(registry, held) }
  }
  const service = new DocumentService({ openUnit })
  void service.ensureInit()
  const handle: BoardServiceHandle = { service, owners: 1 }
  registry.set(BOARD_UNIT_NAME, handle)
  return { service, release: releaseOf(registry, handle) }
}

/**
 * Wire the service onto the platform storage hub: resolve `ctx.storage` at
 * open time (boot settlement has passed by the first browser request), take
 * the `json` backend's KV facet, and open the unit the descriptor names. A
 * missing hub or backend yields undefined (the service then reports
 * unavailable — fallback mode, never a throw).
 */
export function storageHubOpener(storage: () => unknown): KvUnitOpener {
  return async (descriptor: BoardUnitDescriptor) => {
    const hub = storage() as {
      backend?: { get?: (name: string) => { kv?: { open?: (descriptor: unknown) => Promise<KvUnitLike> } } | undefined }
    } | undefined
    const backend = hub?.backend?.get?.('json')
    const kv = backend?.kv
    if (kv?.open === undefined) return undefined
    return kv.open(descriptor)
  }
}
