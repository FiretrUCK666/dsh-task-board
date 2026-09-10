/**
 * Settings route layer for the task-board plugin: the minimal HTTP surface
 * that exposes one registered settings namespace to the browser half through
 * the host web server. The route handler is split from the pure processing
 * function (`createSettingsHandler`) so the response logic is unit-testable
 * without a live server.
 *
 * GET  /api/<ns>/settings  → one namespace's current view, or available:false.
 * POST /api/<ns>/settings  → body {ops, expectedRevision?} applies path edits
 *                            and returns the fresh view; business errors land
 *                            in the {ok:false, error} envelope (HTTP 200).
 * @module dsh-task-board/host/settings-route
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import type { SettingsDescriptor } from '@deepseek-ai/dsh-settings';
/** One settings namespace's JSON view, as the client scope snapshots it. */
export interface SettingsRouteView {
    /** False when the host serves no settings service or the namespace is unregistered. */
    available: boolean;
    /** Schema-resolved section value. */
    value?: unknown;
    /** Composition `base` layer, when the namespace registered one. */
    base?: unknown;
    /** Raw user section, when one exists and is well-formed. */
    user?: unknown;
    /** Whether the host document accepts writes. */
    writable?: boolean;
    /** Namespace revision fencing the next write. */
    revision?: number;
}
/** One path edit the POST handler applies. */
export type SettingsRouteOp = {
    op: 'set';
    path: string[];
    value?: unknown;
} | {
    op: 'unset';
    path: string[];
    value?: never;
};
/** Success envelope carrying a namespace view. */
export interface RouteOk {
    ok: true;
    value: SettingsRouteView;
}
/** Failure envelope carrying a stable business error code. */
export interface RouteFail {
    ok: false;
    error: {
        code: string;
        message: string;
    };
}
/** Route envelope: ok carries a view, fail carries an error, both over HTTP 200. */
export type RouteEnvelope = RouteOk | RouteFail;
/**
 * Read a JSON request body into an unknown value; null when unparseable.
 * @param req - the incoming request stream.
 * @param maxBytes - size cap (beyond it the body is rejected as null). The
 *   board routes raise it for whole-document commits; settings patches keep
 *   the default.
 * @returns the parsed body, or null.
 */
export declare function readJsonBody(req: IncomingMessage, maxBytes?: number): Promise<unknown>;
/** A JSON body read that DISTINGUISHES why it failed — oversized (the caller
 *  should answer 413) vs malformed/empty (400). The board's attachment bridge
 *  needs the difference so a too-large picture is never reported as a broken
 *  request. */
export declare function readJsonBodyDetailed(req: IncomingMessage, maxBytes: number): Promise<{
    ok: true;
    value: unknown;
} | {
    ok: false;
    reason: 'oversize' | 'malformed' | 'empty';
}>;
/** Write one JSON envelope response. */
export declare function json(res: ServerResponse, envelope: RouteEnvelope, status?: number): void;
/**
 * The service face the settings route needs: describe namespaces and apply
 * path edits. Supplied by the real host settings service at registration; a
 * fake in tests.
 */
export interface SettingsRouteDeps {
    /** Describe every registered namespace (empty when no settings service). */
    describe(): SettingsDescriptor[];
    /** Apply path edits to one namespace and settle after the commit. */
    mutate(ns: string, ops: unknown[], expectedRevision?: number): Promise<unknown>;
    /** Whether the host settings document accepts writes. */
    writable: boolean;
}
/**
 * Build the pure settings-route processor. The returned handler translates an
 * HTTP request into a settings envelope without touching the server.
 * @param deps - the describe/mutate service face.
 * @param ns - the settings namespace this route serves.
 * @returns an HTTP handler for GET and POST on the namespace route.
 */
export declare function createSettingsHandler(deps: SettingsRouteDeps, ns: string): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
/**
 * Register the settings route for one namespace on the host web server, wiring
 * the real host settings service into the pure handler.
 * @param ctx - context carrying the webServer and settings services.
 * @param ns - the settings namespace this route serves.
 * @returns the route disposer, or a no-op when either service is absent.
 */
export declare function registerSettingsRoute(ctx: Context, ns: string): () => void;
