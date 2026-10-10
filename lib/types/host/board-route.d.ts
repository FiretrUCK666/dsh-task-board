/**
 * Board route layer for the task-board plugin: the HTTP + SSE surface that
 * serves the host-owned board document to every browser replica.
 *
 *   GET  /api/<ns>/board            → { available, revision, doc?, lease? }
 *                                     (?since=N answers unchanged for N >= revision)
 *   POST /api/<ns>/board            → commit {clientId, tasks, deleted, sections}
 *                                     → the authoritative document after the merge
 *   GET  /api/<ns>/board/items      → the checklist document + its own revision
 *                                     (?since=N answers unchanged for N >= revision)
 *   POST /api/<ns>/board/items      → ItemsCommit {clientId, items, changed, deleted}
 *                                     → the authoritative checklist after the merge
 *   POST /api/<ns>/board/items/restore → {of:{id|ref}, clientId} → bring a
 *                                     deleted row back (a host operation)
 *   POST /api/<ns>/board/items/purge   → {of:{id|ref}, clientId} → erase a
 *                                     deleted row's text for good (also a host
 *                                     operation; idempotent)
 *   POST /api/<ns>/board/lease      → {clientId, ttlMs?, release?} → lease state
 *   POST /api/<ns>/board/command    → relay one user launch to the engine
 *   GET  /api/<ns>/board/surfaces   → which of this plugin's rows are on
 *   GET  /api/<ns>/board/events     → SSE: commit / lease / command frames
 *
 * ONE route file, ONE envelope discipline, ONE CSRF guard: every POST tail
 * passes the same `application/json` check before its body is even read, and a
 * second document is a second TAIL of the same prefix — not a second handler,
 * a second envelope, or a second content-type rule.
 *
 * The handler is a pure function over an injected service face, so the whole
 * protocol is unit-testable without a live server; `registerBoardRoute` wires
 * the real services and owns the service lifecycle (init on register, dispose
 * on unload).
 * @module dsh-task-board/host/board-route
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import type { BoardCommit, BoardDoc } from '../core/board-doc.ts';
import { type ItemPurge, type ItemsCommit, type ItemsDoc } from '../core/items-doc.ts';
import type { ItemRecord } from '../core/item.ts';
import { type BoardCommand, type BoardEvent, type LeaseState } from './board-service.ts';
/** The commit body size cap: the whole ledger travels per commit. */
export declare const BOARD_BODY_LIMIT_BYTES: number;
/** The SSE keep-alive cadence (below common proxy idle timeouts). */
export declare const BOARD_SSE_KEEPALIVE_MS = 25000;
/** The board view the GET/commit responses carry. */
export interface BoardRouteView {
    /** False while the host serves no synced board (replicas fall back). */
    available: boolean;
    revision: number;
    /** The authoritative document (absent on `unchanged` probes). */
    doc?: BoardDoc;
    /** True when `since` already covers the current revision. */
    unchanged?: boolean;
    /** The current engine-lease state (replicas bootstrap from it). */
    lease?: LeaseState;
    /** The relay receipt for a submitted command. */
    command?: {
        queued: boolean;
    };
}
/** The checklist view — the same envelope, a document of its own.
 *
 *  `revision` is the CHECKLIST's revision, never the board's: a replica that
 *  polls this tail watches a counter that only item writes move, so writing an
 *  item never makes every device resync a board that did not change. */
export interface ItemsRouteView {
    /** False while the host serves no synced documents (replicas fall back). */
    available: boolean;
    revision: number;
    /** The authoritative checklist (absent on `unchanged` probes). */
    doc?: ItemsDoc;
    /** True when `since` already covers the current revision. */
    unchanged?: boolean;
    /**
     * The rows a tombstone is still holding, and ONLY when the caller asked:
     * `GET /board/items?includeDeleted=1`.
     *
     * It is opt-in because the common reader has no use for it and pays for it
     * on every poll — and because a list that answers "here is everything you
     * deleted" unasked is a list that invites a surface built for a question
     * nobody asked. A delete bumps the checklist's revision like any other
     * write, so `since` already covers when this list changed.
     */
    deleted?: ItemRecord[];
}
/** Success envelope carrying a route's value. */
export interface RouteOk<T> {
    ok: true;
    value: T;
}
/** Success envelope carrying a board view. */
export type BoardRouteOk = RouteOk<BoardRouteView>;
/** Success envelope carrying a checklist view. */
export type ItemsRouteOk = RouteOk<ItemsRouteView>;
/** Failure envelope carrying a stable business error code. */
export interface BoardRouteFail {
    ok: false;
    error: {
        code: string;
        message: string;
    };
}
export type BoardRouteEnvelope = BoardRouteOk | BoardRouteFail;
export type ItemsRouteEnvelope = ItemsRouteOk | BoardRouteFail;
/** The service face the route needs (the real service or a test fake).
 *
 *  `itemsDoc` / `commitItems` are the SECOND document's two ends, beside the
 *  board's two. The lease and the relay are UNIT-level and stay single. */
export interface BoardRouteDeps {
    /** Settle the one-time storage init before any read/write. */
    ready(): Promise<void>;
    available(): boolean;
    doc(): BoardDoc;
    commit(commit: BoardCommit): Promise<BoardDoc>;
    itemsDoc(): ItemsDoc;
    commitItems(commit: ItemsCommit): Promise<ItemsDoc>;
    acquireLease(clientId: string, ttlMs?: number, active?: boolean): LeaseState;
    releaseLease(clientId: string): LeaseState;
    noteActivity(clientId: string | undefined): void;
    noteStreamOpen(clientId: string | undefined): void;
    noteDisconnect(clientId: string | undefined): void;
    submitCommand(command: BoardCommand): {
        queued: boolean;
    };
    /**
     * Bring one deleted checklist row back, by whichever name the caller holds.
     *
     * A SERVICE operation and not a client commit: a tombstone is stamped one
     * millisecond above the row it removed, so re-submitting that row untouched
     * is exactly the stale copy the tombstone exists to swallow — the commit
     * would be accepted, nothing would change, and the caller would be told it
     * worked. `undefined` means no tombstone holds that row, and that is never
     * dressed up as a success.
     */
    restoreItem(of: ItemAddress, clientId: string): Promise<ItemRecord | undefined>;
    /**
     * Take the text out of one tombstone, by whichever name the caller holds.
     *
     * A SERVICE operation for the opposite reason the restore is one, and the
     * reason is the same fact read from the other side: a tombstone's payload is
     * a field of this host's own tombstone map, and a client commit carries rows
     * and deletions — it has no move that says 「stop keeping this text」. So the
     * merge path cannot express a purge at all, and only the host may write it.
     *
     * It never refuses for want of a tombstone: a row whose text is already gone
     * answers as a success, because the callers click what they are reading and a
     * retry must not be reported as a failure about work that is finished.
     */
    purgeItem(of: ItemAddress, clientId: string): Promise<ItemPurge>;
    subscribe(listener: (event: BoardEvent) => void): () => void;
}
/**
 * WHICH ROW an operation on a DELETED row names. Two NAMED addresses, never one
 * falling back to the other.
 *
 * Both a restore and a purge are addressed this way, and they are addressed
 * this way for one reason: a tombstone is filed under the row's uuid, and the
 * two callers hold different names for the same row. The panel's drawer has the
 * uuid and often no number at all (a row it just deleted still carries the
 * document's 「not numbered yet」 zero), while the model's `item.restore` /
 * `item.purge` say 「#12」 out loud and hold nothing else. So each caller sends
 * the name it actually holds, and neither key is a fallback for the other.
 */
export type ItemAddress = {
    readonly kind: 'id';
    readonly id: string;
} | {
    readonly kind: 'ref';
    readonly ref: number;
};
/** What a restore asks for: which row, and who is asking. */
export interface RestoreRequest {
    readonly of: ItemAddress;
    readonly clientId: string;
}
/**
 * The restore's answer.
 *
 * `restored` is `undefined` for "no tombstone holds that row" AND for "the
 * host is not serving documents" — and the two are told apart by `available`,
 * because they are different facts with different remedies. It is NOT a
 * success with a missing row: the caller is told the row did not come back.
 */
export interface RestoreRouteView {
    readonly available: boolean;
    readonly revision: number;
    readonly restored?: ItemRecord;
}
/**
 * The purge's answer — the restore's shape, because the two operations differ
 * only in what they do to the payload, and a second envelope for the second
 * operation would be a second dialect on one prefix.
 *
 * THE THREE SHAPES, ALL SUCCESSES EXCEPT ONE, and the caller can tell them
 * apart without a code:
 *
 *  - `erased` present: the text is gone as of this revision, and here is the
 *    row it was — the receipt can name what was destroyed.
 *  - neither: there was nothing left to erase (a retry, or a delete that never
 *    kept text). This IS the success, and it is the same answer the drawer needs
 *    when a second click arrives after the first landed.
 *  - `notDeleted`: the name resolved to a row that is STILL IN THE LIST. The
 *    one refusal, and it is reported rather than smoothed into a success — a
 *    「已彻底删除」 about a row the reader can scroll up and see is the one lie
 *    this route must not tell.
 */
export interface PurgeRouteView {
    readonly available: boolean;
    readonly revision: number;
    /** The row whose text is gone, when there was one to name. */
    readonly erased?: ItemRecord;
    /** The name resolved to a live row: nothing was purged. */
    readonly notDeleted?: true;
}
/** Extract a commit from an untrusted body; undefined when unusable. The
 *  merge grammar normalizes every row/section, so this only checks the
 *  envelope shape (arrays/strings), never the data. */
export declare function parseBoardCommit(body: unknown): BoardCommit | undefined;
/** Extract a checklist commit from an untrusted body; undefined when unusable.
 *
 *  This document has NO sections — the checklist carries none — so its commit
 *  is rows + claims + deletions and nothing else. Lifting the board's three
 *  section fields onto it would be inventing state the document does not have,
 *  and the same envelope rule (clientId, claims, deletes) is what both parsers
 *  share above. */
export declare function parseItemsCommit(body: unknown): ItemsCommit | undefined;
/** The pure request processor (one prefix route, dispatched by path tail). */
export declare function createBoardHandler(deps: BoardRouteDeps, base: string): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
/**
 * Register the board route (prefix) and own the service lifecycle: open the
 * persistence unit through the platform storage hub, serve once initialized,
 * dispose the unit on unload.
 *
 * ONE service serves the prefix, and it holds BOTH documents — the board at
 * the root tail, the checklist at `/items`. The lease and the command relay
 * ride along because they arbitrate the unit (one engine drives every
 * document), not the board: their answers are carried on the board's view
 * because that is the tail every replica bootstraps from, not because they
 * belong to the board's document.
 * @param ctx - context carrying the webServer and storage services.
 * @param ns - the plugin namespace this route serves.
 * @returns the disposer removing the route and closing the service.
 */
export declare function registerBoardRoute(ctx: Context, ns: string): () => void;
