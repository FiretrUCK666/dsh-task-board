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
 * read-only git commands (`rev-parse`, `status --porcelain`, `symbolic-ref`,
 * `ls-remote`); any
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
import type { UpdateApplyResult, UpdateEvidence, UpdateSourceView } from '../core/update-view.ts';
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
 * Read the local checkout state without mutating it: HEAD plus worktree
 * dirtiness locally, the remote tip through {@link remoteHeadOf}. Any failure
 * degrades to undefined — an unreadable checkout is not an error, it just hides
 * the git section.
 * @param repoDir - the `link:` target directory.
 * @param slug - the `Owner/Repo` the checkout tracks, when it is known.
 * @returns the git status, or undefined when unreadable.
 */
export declare function readGitStatus(repoDir: string, slug?: string): Promise<UpdateGitStatus | undefined>;
/** Where a remote tip was read from — the page says so instead of guessing. */
export interface RemoteTip {
    readonly head: string;
    readonly via: 'api' | 'git';
}
/**
 * THE REMOTE'S TIP OUT OF `api.github.com`, which is the host that answers.
 *
 * One request, `per_page=1` on the default branch: GitHub answers with the newest
 * commit of that branch, its sha, and the repository's own `default_branch` is
 * read from the same family of endpoints. The body is deliberately small — the
 * whole point of this step is that it is a single JSON read over a host measured
 * at 725ms, not a pack negotiation.
 *
 * An unauthenticated reader is rate-limited to 60 requests/hour, which is far
 * more than a manual 「检查更新」 can spend, and a rate-limited answer is
 * `undefined` — the same shape as an unreachable one, so the next step gets its
 * turn rather than the click turning into an error.
 *
 * @param slug - the `Owner/Repo` this checkout tracks.
 * @returns the tip, or undefined when this host could not say.
 */
export declare function tipFromApi(slug: string | undefined): Promise<RemoteTip | undefined>;
/**
 * The sha out of `ls-remote --symref origin HEAD`.
 *
 * The listing is two lines: the ref HEAD points at, and the sha it points at.
 * **A listing with no `refs/heads/` symref is not an answer** — the remote
 * does not say what its default branch is, and the sha on its own would be the
 * sha of whatever HEAD happens to be, which is not a branch tip.
 * @param listing - the command's output.
 * @returns the sha, or undefined when the remote said nothing usable.
 */
export declare function remoteHeadFromAdvertisement(listing: string | undefined): string | undefined;
/**
 * The branch name out of `symbolic-ref refs/remotes/origin/HEAD`.
 * @param ref - the command's output.
 * @returns the branch name, or undefined when the clone does not know one.
 */
export declare function branchOfSymbolicRef(ref: string | undefined): string | undefined;
/**
 * The sha out of `ls-remote origin refs/heads/<branch>`.
 * @param listing - the command's output.
 * @returns the sha, or undefined when the branch is not there.
 */
export declare function shaOfListing(listing: string | undefined): string | undefined;
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
 * @param _copy - the running copy. Its mode no longer selects an answer path —
 *   every install mode asks the same question ("what is published upstream?"),
 *   so there is one transport ladder. The parameter stays because the callers
 *   are other people's code (AGENTS.md 13); the ROUTE decides what to show.
 * @returns the newest upstream, or undefined when it could not be read.
 */
export declare function readLatest(ctx: Context, _copy: Pick<RunningCopy, 'mode'>): Promise<UpdateLatestView | undefined>;
/**
 * Register the update route on the host web server: GET reads the view, POST
 * applies the plan.
 * @param ctx - context carrying the webServer service.
 * @param ns - the plugin namespace (route path prefix).
 * @returns the route disposer, or a no-op when the web server is absent.
 */
export declare function registerUpdateRoute(ctx: Context, ns: string): () => void;
