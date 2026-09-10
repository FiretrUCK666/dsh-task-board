/**
 * Update-source route layer for the task-board plugin: the read-only surface
 * the header's check-for-updates button reads before comparing against the
 * published latest.
 *
 * GET /api/<ns>/update → {ok:true, value:{packageName, version, spec?,
 *                         mode, githubSpec?, git?}}
 *
 * `spec` is the raw profile-manifest declaration (the install-mode ground
 * truth); `mode` classifies it through the shared core grammar. `git` is
 * present only for `link:` checkouts and is gathered on demand per request —
 * never at plugin startup — through read-only git commands (`rev-parse`,
 * `status --porcelain`, `ls-remote`); any failure degrades to an absent
 * field, never an error. The handler is split from the pure processing
 * function (`createUpdateHandler`) so the response logic is unit-testable
 * without a live server.
 * @module dsh-task-board/host/update-route
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import { type UpdateGitStatus, type UpdateInstallMode } from '../core/update-check.ts';
/** The update-source view served to the browser half. */
export interface UpdateSourceView {
    /** Package name (the npm update command's subject). */
    packageName: string;
    /** The running copy's version (the comparison baseline). */
    version: string;
    /** Raw profile-manifest declaration (absent when the manifest is unreadable). */
    spec?: string;
    /** Classified install mode. */
    mode: UpdateInstallMode;
    /** The `github:` install spec (absent when the repo URL is not GitHub). */
    githubSpec?: string;
    /** Local-checkout git state (only for `local` installs). */
    git?: UpdateGitStatus;
}
/** Success envelope carrying the update-source view. */
export interface UpdateRouteOk {
    ok: true;
    value: UpdateSourceView;
}
/** Failure envelope carrying a stable business error code. */
export interface UpdateRouteFail {
    ok: false;
    error: {
        code: string;
        message: string;
    };
}
export type UpdateRouteEnvelope = UpdateRouteOk | UpdateRouteFail;
/** The service face the pure handler needs (real readers or fakes). */
export interface UpdateRouteDeps {
    /** Read the current update-source view. */
    read(): UpdateSourceView;
}
/**
 * Build the pure update-source route processor.
 * @param deps - the view face (real or fake).
 * @returns an HTTP handler for GET on the update route.
 */
export declare function createUpdateHandler(deps: UpdateRouteDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
/**
 * Register the update-source route on the host web server.
 * @param ctx - context carrying the webServer service.
 * @param ns - the plugin namespace (route path prefix).
 * @returns the route disposer, or a no-op when the web server is absent.
 */
export declare function registerUpdateRoute(ctx: Context, ns: string): () => void;
