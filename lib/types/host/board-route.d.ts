/**
 * Board route layer for the task-board plugin: the HTTP + SSE surface that
 * serves the host-owned board document to every browser replica.
 *
 *   GET  /api/<ns>/board            → { available, revision, doc?, lease? }
 *                                     (?since=N answers unchanged for N >= revision)
 *   POST /api/<ns>/board            → commit {clientId, tasks, deleted, sections}
 *                                     → the authoritative document after the merge
 *   POST /api/<ns>/board/lease      → {clientId, ttlMs?, release?} → lease state
 *   POST /api/<ns>/board/command    → relay one user launch to the engine
 *   GET  /api/<ns>/board/events     → SSE: commit / lease / command frames
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
/** Success envelope carrying a board view. */
export interface BoardRouteOk {
    ok: true;
    value: BoardRouteView;
}
/** Failure envelope carrying a stable business error code. */
export interface BoardRouteFail {
    ok: false;
    error: {
        code: string;
        message: string;
    };
}
export type BoardRouteEnvelope = BoardRouteOk | BoardRouteFail;
/** The service face the route needs (the real service or a test fake). */
export interface BoardRouteDeps {
    /** Settle the one-time storage init before any read/write. */
    ready(): Promise<void>;
    available(): boolean;
    doc(): BoardDoc;
    commit(commit: BoardCommit): Promise<BoardDoc>;
    acquireLease(clientId: string, ttlMs?: number, active?: boolean): LeaseState;
    releaseLease(clientId: string): LeaseState;
    noteActivity(clientId: string | undefined): void;
    noteStreamOpen(clientId: string | undefined): void;
    noteDisconnect(clientId: string | undefined): void;
    submitCommand(command: BoardCommand): {
        queued: boolean;
    };
    subscribe(listener: (event: BoardEvent) => void): () => void;
}
/** Extract a commit from an untrusted body; undefined when unusable. The
 *  merge grammar normalizes every row/section, so this only checks the
 *  envelope shape (arrays/strings), never the data. */
export declare function parseBoardCommit(body: unknown): BoardCommit | undefined;
/** The pure request processor (one prefix route, dispatched by path tail). */
export declare function createBoardHandler(deps: BoardRouteDeps, base: string): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
/**
 * Register the board route (prefix) and own the service lifecycle: open the
 * persistence unit through the platform storage hub, serve once initialized,
 * dispose the unit on unload.
 * @param ctx - context carrying the webServer and storage services.
 * @param ns - the plugin namespace this route serves.
 * @returns the disposer removing the route and closing the service.
 */
export declare function registerBoardRoute(ctx: Context, ns: string): () => void;
