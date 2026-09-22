/**
 * Shared HTTP envelope helpers for this plugin's host routes: read a JSON
 * request body with a bounded size, and write a JSON response.
 *
 * Both live here because every route uses the same wire discipline — one
 * envelope shape, one size cap, one content type — so no route can drift into
 * its own dialect. The readers are split from the handlers that use them so the
 * response logic stays unit-testable without a live server.
 * @module dsh-task-board/host/http-json
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
/** Success envelope carrying a route's value. */
export interface RouteOk<T> {
    ok: true;
    value: T;
}
/** Failure envelope carrying a stable business error code. */
export interface RouteFail {
    ok: false;
    error: {
        code: string;
        message: string;
    };
}
/** Route envelope: ok carries a value, fail carries an error, both over HTTP 200. */
export type RouteEnvelope<T = unknown> = RouteOk<T> | RouteFail;
/**
 * Read a JSON request body into an unknown value; null when unparseable.
 * @param req - the incoming request stream.
 * @param maxBytes - size cap (beyond it the body is rejected as null). The
 *   board routes raise it for whole-document commits.
 * @returns the parsed body, or null.
 */
export declare function readJsonBody(req: IncomingMessage, maxBytes?: number): Promise<unknown>;
/**
 * A JSON body read that DISTINGUISHES why it failed — oversized (the caller
 * should answer 413) vs malformed/empty (400). The board's attachment bridge
 * needs the difference so a too-large picture is never reported as a broken
 * request.
 * @param req - the incoming request stream.
 * @param maxBytes - size cap in bytes.
 * @returns the parsed value, or the reason it was refused.
 */
export declare function readJsonBodyDetailed(req: IncomingMessage, maxBytes: number): Promise<{
    ok: true;
    value: unknown;
} | {
    ok: false;
    reason: 'oversize' | 'malformed' | 'empty';
}>;
/** Write one JSON envelope response. */
export declare function json(res: ServerResponse, envelope: RouteEnvelope<unknown>, status?: number): void;
