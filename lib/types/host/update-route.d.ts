/**
 * Update surfaces for the task-board plugin: the read-only view the header's
 * check-for-updates button compares against the published latest, and the
 * action that brings the running copy up to date.
 *
 * GET  /api/<ns>/update → {ok:true, value:{packageName, version, spec?, mode,
 *                           profile?, appManaged, githubSpec?, plan, git?, clients?}}
 * POST /api/<ns>/update → {ok:true, value:UpdateApplyResult}
 *
 * WHICH COPY IS RUNNING is a fact about this process, never a name written
 * here. The profile is read from the host's own profile service (present only
 * in a profile launched by `dsh`), falling back to the launcher's environment;
 * the manifest spec is read from THAT profile's `package.json`, so a desktop
 * install and a `link:` checkout on the same machine each describe themselves
 * correctly. When neither can be read the mode is `unknown` and the view says
 * so — an earlier revision hardcoded the `web` profile, which made every
 * install report the web profile's mode instead of its own.
 *
 * The install mode then selects WHO applies an update (see
 * `core/update-check.ts` for the plan and `update-apply.ts` for the executors):
 * a package install goes through the host's installation service, a `link:`
 * checkout is refreshed in place. A packaged application manages its own
 * profile — its CLI refuses that profile — so no terminal command is offered
 * for it. Nothing is applied from anything the page sends: the request carries
 * no spec, and the route re-derives the plan from the running copy every time.
 *
 * `git` is present only for `link:` checkouts and is gathered on demand per
 * request — never at plugin startup — through read-only git commands
 * (`rev-parse`, `status --porcelain`, `ls-remote`); any failure degrades to an
 * absent field, never an error. The handler is split from the pure processing
 * function (`createUpdateHandler`) so the response logic is unit-testable
 * without a live server.
 * @module dsh-task-board/host/update-route
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import { type UpdateGitStatus, type UpdateInstallMode, type UpdatePlan } from '../core/update-check.ts';
import { type UpdateApplyResult } from './update-apply.ts';
import { type ClientReport } from './client-report-route.ts';
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
    /** The profile carrying this copy (absent when the running profile is unreadable). */
    profile?: string;
    /** The profile belongs to a packaged application, which installs through its own runtime. */
    appManaged: boolean;
    /** The `github:` install spec (absent when the repo URL is not GitHub). */
    githubSpec?: string;
    /** How to update this copy, and who applies it. */
    plan: UpdatePlan;
    /** Local-checkout git state (only for `local` installs). */
    git?: UpdateGitStatus;
    /** Self-reports from the pages that are currently open (newest first). */
    clients?: ClientReport[];
}
/** Success envelope carrying the update-source view or an apply result. */
export interface UpdateRouteOk {
    ok: true;
    value: UpdateSourceView | UpdateApplyResult;
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
    /** Bring the running copy up to date. */
    apply(): Promise<UpdateApplyResult>;
}
/**
 * Build the pure update route processor: GET reads the source view, POST
 * applies the plan that view describes.
 * @param deps - the view and the applier (real or fake).
 * @returns an HTTP handler for the update route.
 */
export declare function createUpdateHandler(deps: UpdateRouteDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
/** The running copy's identity, as this process can observe it. */
export interface RunningCopy {
    /** The profile directory the copy was loaded from (absent when unknown). */
    dir?: string;
    /** The profile's name (absent when unknown). */
    profile?: string;
    /** A packaged application owns this profile and installs through its own runtime. */
    appManaged: boolean;
    /** The profile manifest's declaration of this package (absent when unread). */
    spec?: string;
    /** The classified install mode. */
    mode: UpdateInstallMode;
    /** The checkout a `link:` install points at. */
    checkoutDir?: string;
    /** What an update on this copy runs, and who applies it. */
    plan: UpdatePlan;
}
/**
 * The version of this package as it exists on disk under `dir`: the installed
 * copy inside a profile, or the manifest of a checkout. Read after an update to
 * report what landed, rather than what an update claimed to do.
 * @param dir - a profile directory or a checkout directory.
 * @returns the version, or undefined when neither shape is readable.
 */
export declare function installedVersionIn(dir: string | undefined): string | undefined;
/**
 * Gather the facts every update surface needs, from THIS process. Nothing here
 * assumes a profile name: the profile comes from the host's declaration (or the
 * launcher's environment), and the spec comes from that profile's own manifest.
 * @param ctx - context carrying the host services.
 * @returns the running copy's identity and plan.
 */
export declare function runningCopyOf(ctx: Context): RunningCopy;
/**
 * Register the update route on the host web server: GET reads the view, POST
 * applies the plan.
 * @param ctx - context carrying the webServer service.
 * @param ns - the plugin namespace (route path prefix).
 * @returns the route disposer, or a no-op when the web server is absent.
 */
export declare function registerUpdateRoute(ctx: Context, ns: string): () => void;
