/**
 * Update surfaces for the task-board plugin: the read-only view the header's
 * check-for-updates button compares against the published latest, and the
 * action that brings the running copy up to date.
 *
 * GET  /api/<ns>/update → {ok:true, value:{packageName, version, spec?, mode,
 *                           profile?, appManaged, evidence?, githubSpec?, plan,
 *                           latest?, git?, clients?}}
 * POST /api/<ns>/update → {ok:true, value:UpdateApplyResult}
 *
 * WHICH COPY IS RUNNING is measured, not declared. The measured fact is where
 * this module itself is running from (`import.meta.url` → the package root):
 * a copy that sits in some profile's `node_modules` is an install of that
 * profile, and a copy that sits anywhere else was linked in from a checkout.
 * The host's own `profileContext` supplies the profile name, its directory and
 * whether an application owns it; the profile manifest then supplies the
 * recorded spec that says HOW that install was made.
 *
 * The order matters, and it is the whole point of this module. An earlier
 * revision named a profile in code (`profiles/web`), so a desktop install
 * described itself with the web profile's `link:` spec and reported "local
 * development" — and then offered, as its one-click update, a `git pull` in
 * somebody else's checkout. Reading the declaration ALONE is the same mistake
 * with a better key: the launcher's `DSH_PROFILE_DIR` is exported into every
 * model shell call, not into this process, so consulting it would let an
 * ambient variable decide which copy is running. Location wins; the
 * declaration is corroboration, and a disagreement is reported rather than
 * hidden.
 *
 * Nothing is applied from anything the page sends: the request carries no
 * spec, and the route re-derives the plan from the running copy every time.
 *
 * The install mode then selects WHO applies an update (see
 * `core/update-check.ts` for the plan and `update-apply.ts` for the executors):
 * a package install goes through the host's installation service, a `link:`
 * checkout is refreshed in place. `git` is present only for `link:` checkouts
 * and is gathered on demand per request — never at plugin startup — through
 * read-only git commands (`rev-parse`, `status --porcelain`, `ls-remote`); any
 * failure degrades to an absent field, never an error. `latest` is read here
 * too, through the profile's own registry plan, because the browser cannot know
 * which registry (or mirror, or proxy) this installation actually uses.
 *
 * The handler is split from the pure processing function
 * (`createUpdateHandler`) so the response logic is unit-testable without a live
 * server.
 * @module dsh-task-board/host/update-route
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import { type UpdateGitStatus, type UpdateInstallMode, type UpdateLatestView, type UpdatePlan } from '../core/update-check.ts';
import { type UpdateApplyResult } from './update-apply.ts';
import { type ClientReport } from './client-report-route.ts';
/** How the running copy's own location was established. */
export interface UpdateEvidence {
    /** This copy IS a link into a checkout, rather than a copy installed in a profile. */
    linked: boolean;
    /** The host declared a profile at all. */
    declared: boolean;
    /** The declaration named a different copy than the one actually running. */
    disagreement: boolean;
}
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
    /** The profile's directory, or the checkout this copy runs from. */
    dir?: string;
    /** The profile belongs to a packaged application, which installs through its own runtime. */
    appManaged: boolean;
    /** How this copy's identity was established. */
    evidence: UpdateEvidence;
    /** The `github:` install spec (absent when the repo URL is not GitHub). */
    githubSpec?: string;
    /** How to update this copy, and who applies it. */
    plan: UpdatePlan;
    /** The newest upstream, when the host could read one (absent is "cannot tell"). */
    latest?: UpdateLatestView;
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
    /** Read the current update-source view (reading the newest upstream is I/O). */
    read(): UpdateSourceView | Promise<UpdateSourceView>;
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
    /** How this copy's identity was established. */
    evidence: UpdateEvidence;
    /** The checkout this copy runs from (only for a linked copy). */
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
 * assumes a profile name: the profile comes from where this copy runs, and the
 * spec comes from that profile's own manifest.
 * @param ctx - context carrying the host services.
 * @param selfDir - where this copy's code actually is; the real location by
 * default, and an explicit premise wherever a caller must state one.
 * @returns the running copy's identity and plan.
 */
export declare function runningCopyOf(ctx: Context, selfDir?: string): RunningCopy;
/** The registry plan one profile's installation service reports. */
export interface RegistryPlanLike {
    registry?: unknown;
    fallbackRegistries?: unknown;
    resolved?: unknown;
}
/**
 * The registries to ask for the plan an installation service reported.
 *
 * Pure, and separate from the service call that produces the plan, because the
 * ORDER is the part with a rule in it: the profile's own plan first (it knows
 * the mirrors, private sources, proxies and credentials this installation
 * really uses), then the public pair.
 *
 * **The order is a priority, not a walk.** `registriesFor` splits this list into
 * "the reader's own sources" and the rest, and asks ONLY the own sources when
 * there are any: a user-configured mirror is the only source asked, because
 * asking the public mirrors would tell them "this machine looks up this package".
 * The public entries below are a fallback for a profile that configured nothing,
 * not a second opinion for one that did. Reading this order as "a private source
 * that misses falls through to the public one" is exactly the reading the privacy
 * rule forbids — see `registriesFor`.
 *
 * @param plan - the service's plan, or undefined when it reported none.
 * @returns the registry base URLs, in priority order, without repeats.
 */
export declare function registryOrderOf(plan: RegistryPlanLike | undefined): string[];
/**
 * **给一整段工作一个总额，而不是给它内部的每一步各定一个上限。**
 *
 * `boundedJson` 管的是「一次请求多久放弃」。它是必要的，但不够：几个各自合规的
 * 上限加起来可以超出一次读取的总预算，而超出的那部分表现为**浏览器先放弃**——
 * 屏上说「检查失败」，host 却还在正常地一段一段往下走。
 *
 * 所以有两种边界，各管一件事：
 *
 *   · `boundedJson(url, timeoutMs)` —— 一次请求的上限（这一段多久没答就当作没有）。
 *   · `boundedByBudget(work, ms)`   —— 一件事的上限（整体多久没成就算了，用已有的收场）。
 *
 * 后者不 abort 那个 Promise（它与网络无关，可能是一串子进程），只是**不再等它**。
 * 那是对的：读者要的是「这一次检查的答案」，不是那个后台操作必须被取消。它自己的
 * 分段上限保证它不会永远挂着。
 * @param work - 要等的那件事。
 * @param ms - 等它多久。
 * @returns 它的结果，或超时后的 `undefined`。
 */
export declare function boundedByBudget<T>(work: Promise<T>, ms: number): Promise<T | undefined>;
/**
 * The newest upstream for this copy, as this host can read it.
 *
 * A registry install asks the profile's own registries first and the public pair
 * only when the profile configured none (see `registriesFor`); within one tier the
 * candidates are **hedged**, not serial — the next one starts after
 * `HEDGE_AFTER_MS`, and the first *successful* answer wins.
 *
 * A repository install reads the version the default branch declares. It does
 * **not** read the commit that branch is on: this view answers "what version is
 * upstream", and a commit SHA in the same field would be a different question
 * wearing the same shape.
 *
 * A checkout is compared by its own git state instead (see
 * {@link readGitStatus}), so it has nothing to read here.
 *
 * Anything unreadable is reported as absent. That is the whole contract: the
 * page renders absence as "cannot tell", and a check that cannot tell must
 * never be dressed up as "already newest".
 * @param ctx - context carrying the host services.
 * @param copy - the running copy (its mode decides what to ask).
 * @returns the newest upstream, or undefined when it could not be read.
 */
export declare function readLatest(ctx: Context, copy: Pick<RunningCopy, 'mode'>): Promise<UpdateLatestView | undefined>;
/**
 * Register the update route on the host web server: GET reads the view, POST
 * applies the plan.
 * @param ctx - context carrying the webServer service.
 * @param ns - the plugin namespace (route path prefix).
 * @returns the route disposer, or a no-op when the web server is absent.
 */
export declare function registerUpdateRoute(ctx: Context, ns: string): () => void;
