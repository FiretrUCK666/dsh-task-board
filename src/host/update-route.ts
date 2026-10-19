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

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import {
  classifyInstallSpec,
  githubSpecOfRepositoryUrl,
  latestFromPackument,
  packumentUrl,
  updatePlanFor,
  PUBLIC_REGISTRIES,
  type UpdateGitStatus,
  type UpdateInstallMode,
  type UpdateLatestView,
  type UpdatePlan,
  type UpdateStep,
} from '../core/update-check.ts'
import {
  applyUpdate,
  spawnStep,
  type PackageInstaller,
  type UpdateApplyResult,
} from './update-apply.ts'
import { readClientReports, type ClientReport } from './client-report-route.ts'
import packageJson from '../../package.json'

/** Package identity, read live from the manifest (never repeated in code). */
const PACKAGE_NAME = (packageJson as { name?: string }).name ?? ''
const PACKAGE_VERSION = (packageJson as { version?: string }).version ?? 'unknown'
const GITHUB_SPEC = githubSpecOfRepositoryUrl(
  (packageJson as { repository?: { url?: string } }).repository?.url ?? '',
)
/** This package's own directory, resolved from where this module is running. */
const SELF_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/** 单条 registry 请求的上限。它不是「多久没答就换下一个」——那是 `HEDGE_AFTER_MS`。 */
const REGISTRY_TIMEOUT_MS = 8000

/**
 * **这个路由里每一段网络/子进程的预算，都必须明显小于浏览器的预算。**
 *
 * 浏览器那一侧读这个接口的上限是 `fetchUpdateSource` 的 15 秒
 * （`src/client/update-source.ts`）。host 这一侧若把某一段也设成 15 秒，
 * 那一段只要走满就等于让整次读取**必然超支**：浏览器先放弃，于是屏上出现
 * 「检查失败，请重试」——而 host 其实还在正常地干活。
 *
 * 这正是那个故障的成因（读者报的「有时能成、有时失败」）：一个 checkout 的
 * `git ls-remote` 打的是 **github.com**，而它原先的上限正是 15 秒。github 可达时
 * 它 1.4 秒返回、一切正常；被墙时它走满 15 秒、正好压死浏览器那一侧。所以「忽好忽坏」
 * 不是随机，是**取决于那一刻 github 通不通**。
 *
 * 定 6 秒的理由：它给一次正常读留足余量（实测可达的 `ls-remote` 约 1.4 秒），
 * 又留出 9 秒给同一请求里其余的段（`rev-parse`、`status`、registry 对冲）走完并
 * 把 JSON 送回去。**改大它之前先看客户端那个 15 秒**——两者的关系是约束，不是巧合。
 */
const CHECK_STAGE_BUDGET_MS = 6000

/** 一次 `git rev-parse` / `status` 这种纯本地子进程的上限（它们不碰网络）。 */
const GIT_LOCAL_TIMEOUT_MS = 3000

/**
 * 第一个源领先多久之后，第二个源也起跑。
 *
 * 这个数字是「按次序」与「不等死」之间的那条线，两侧各有实测依据：
 *
 *   - 公共 registry 正常一次应答 0.5–1.0 秒（这台机器实测 npmjs 999ms、npmmirror
 *     561ms）。窗口定在它之下，才可能在第一条**挂住**时真正省下时间。
 *   - 定得太小（比如 100ms）会把「按次序」变成「事实上并发」，第一条本来一秒内就
 *     会答，却已经多发了第二条请求——那既浪费又不尊重次序。
 *
 * 800ms 落在两个实测值的低端：充足常请求领先，又不至于让一次挂住拖到用户察觉。
 */
const HEDGE_AFTER_MS = 800
/** The package directory one profile installs this package into. */
function installedDirIn(profileDir: string): string {
  return path.join(profileDir, 'node_modules', ...PACKAGE_NAME.split('/'))
}


/** The profile facts this route reads by name; every field is optional. */
interface ProfileContextLike {
  name?: unknown
  dir?: unknown
  /** Present only when a packaged application supplies its own package manager. */
  packageManager?: unknown
}

/** How the running copy's own location was established. */
export interface UpdateEvidence {
  /** This copy IS a link into a checkout, rather than a copy installed in a profile. */
  linked: boolean
  /** The host declared a profile at all. */
  declared: boolean
  /** The declaration named a different copy than the one actually running. */
  disagreement: boolean
}

/** The update-source view served to the browser half. */
export interface UpdateSourceView {
  /** Package name (the npm update command's subject). */
  packageName: string
  /** The running copy's version (the comparison baseline). */
  version: string
  /** Raw profile-manifest declaration (absent when the manifest is unreadable). */
  spec?: string
  /** Classified install mode. */
  mode: UpdateInstallMode
  /** The profile carrying this copy (absent when the running profile is unreadable). */
  profile?: string
  /** The profile's directory, or the checkout this copy runs from. */
  dir?: string
  /** The profile belongs to a packaged application, which installs through its own runtime. */
  appManaged: boolean
  /** How this copy's identity was established. */
  evidence: UpdateEvidence
  /** The `github:` install spec (absent when the repo URL is not GitHub). */
  githubSpec?: string
  /** How to update this copy, and who applies it. */
  plan: UpdatePlan
  /** The newest upstream, when the host could read one (absent is "cannot tell"). */
  latest?: UpdateLatestView
  /** Local-checkout git state (only for `local` installs). */
  git?: UpdateGitStatus
  /** Self-reports from the pages that are currently open (newest first). */
  clients?: ClientReport[]
}

/** Success envelope carrying the update-source view or an apply result. */
export interface UpdateRouteOk {
  ok: true
  value: UpdateSourceView | UpdateApplyResult
}

/** Failure envelope carrying a stable business error code. */
export interface UpdateRouteFail {
  ok: false
  error: { code: string; message: string }
}

export type UpdateRouteEnvelope = UpdateRouteOk | UpdateRouteFail

/** Write one JSON envelope response (same discipline as the settings route). */
function json(res: ServerResponse, envelope: UpdateRouteEnvelope, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(envelope))
}

/** The service face the pure handler needs (real readers or fakes). */
export interface UpdateRouteDeps {
  /** Read the current update-source view (reading the newest upstream is I/O). */
  read(): UpdateSourceView | Promise<UpdateSourceView>
  /** Bring the running copy up to date. */
  apply(): Promise<UpdateApplyResult>
}

/**
 * Build the pure update route processor: GET reads the source view, POST
 * applies the plan that view describes.
 * @param deps - the view and the applier (real or fake).
 * @returns an HTTP handler for the update route.
 */
export function createUpdateHandler(
  deps: UpdateRouteDeps,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res): Promise<void> => {
    if (req.method === 'GET') {
      let view: UpdateSourceView
      try {
        view = await deps.read()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        json(res, { ok: false as const, error: { code: 'update', message } })
        return
      }
      json(res, { ok: true as const, value: view })
      return
    }
    if (req.method === 'POST') {
      let result: UpdateApplyResult
      try {
        result = await deps.apply()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        json(res, { ok: false as const, error: { code: 'update', message } })
        return
      }
      json(res, { ok: true as const, value: result })
      return
    }
    res.writeHead(405)
    res.end()
  }
}

/** The running copy's identity, as this process can observe it. */
export interface RunningCopy {
  /** The profile directory the copy was loaded from (absent when unknown). */
  dir?: string
  /** The profile's name (absent when unknown). */
  profile?: string
  /** A packaged application owns this profile and installs through its own runtime. */
  appManaged: boolean
  /** The profile manifest's declaration of this package (absent when unread). */
  spec?: string
  /** The classified install mode. */
  mode: UpdateInstallMode
  /** How this copy's identity was established. */
  evidence: UpdateEvidence
  /** The checkout this copy runs from (only for a linked copy). */
  checkoutDir?: string
  /** What an update on this copy runs, and who applies it. */
  plan: UpdatePlan
}

/** `realpath`, or the input unchanged when it cannot be resolved. */
function realOf(target: string): string {
  try {
    return fs.realpathSync(target)
  } catch {
    return target
  }
}

/**
 * Whether a profile's installed location for this package resolves to
 * somewhere ELSE.
 *
 * A symlink test cannot answer this: pnpm links every package it installs,
 * including a plain registry install (into the profile's own `.pnpm` store),
 * so "is a link" would read a normal install as a checkout. Containment does
 * answer it — a package manager's store lives inside the profile, and a
 * `link:` target does not.
 * @param profileDir - the profile directory.
 * @param selfDir - this package's own resolved directory.
 * @returns true when the copy lives outside the profile that declares it.
 */
function resolvesOutside(profileDir: string, selfDir: string): boolean {
  const profile = realOf(profileDir)
  const rel = path.relative(profile, selfDir)
  return rel !== '' && (rel.startsWith('..') || path.isAbsolute(rel))
}

/**
 * The profile whose installed location IS this running copy, found by walking
 * up from where the code actually is. Only a real (non-linked) install is found
 * this way: a linked copy lives in its checkout, and the link that points at it
 * lives in a profile the checkout knows nothing about.
 *
 * The walk starts one level above the package root, so a checkout's own
 * `node_modules` can never be mistaken for a profile holding it.
 * @param selfDir - this package's own resolved directory.
 * @returns the profile directory, or undefined when this is not a real install.
 */
function profileHolding(selfDir: string): string | undefined {
  let current = selfDir
  for (;;) {
    const parent = path.dirname(current)
    if (parent === current) return undefined
    if (realOf(installedDirIn(parent)) === selfDir) return parent
    current = parent
  }
}

/**
 * Read which profile is running. The copy's own LOCATION decides; the host's
 * declaration corroborates it and supplies facts only the host knows (whether
 * a packaged application owns the profile).
 *
 * The launcher's `DSH_PROFILE_DIR` is deliberately not consulted. It is
 * exported into every model shell call rather than into this process, so
 * reading it would let an ambient variable decide which copy is running — the
 * same failure as naming a profile in code, with a less obvious cause.
 * @param ctx - context carrying the host services.
 * @param selfDir - where this copy's code actually is (the measured fact).
 * @returns the profile directory, its name, the owner, and the evidence.
 */
function readProfile(ctx: Context, selfDir: string): {
  dir?: string
  profile?: string
  appManaged: boolean
  evidence: UpdateEvidence
} {
  const declared = ctx.get('profileContext') as ProfileContextLike | undefined
  const declaredDir = typeof declared?.dir === 'string' && declared.dir !== ''
    ? declared.dir
    : undefined
  const declaredHoldsSelf = declaredDir !== undefined
    && realOf(installedDirIn(declaredDir)) === selfDir
  const derivedDir = declaredHoldsSelf ? declaredDir : profileHolding(selfDir)
  const dir = derivedDir ?? declaredDir
  const declaredName = typeof declared?.name === 'string' && declared.name !== ''
    ? declared.name
    : undefined
  // The declared name describes THIS copy only when the declaration does.
  const named = declaredHoldsSelf ? declaredName : undefined
  const name = named ?? (dir !== undefined ? path.basename(dir) : undefined)
  return {
    ...(dir !== undefined ? { dir } : {}),
    ...(name !== undefined && name !== '' ? { profile: name } : {}),
    appManaged: declared?.packageManager !== undefined,
    evidence: {
      // No profile holds this copy, or the profile that does holds a pointer
      // out of itself: either way this is a checkout, not an installed copy.
      linked: dir === undefined || resolvesOutside(dir, selfDir),
      declared: declaredDir !== undefined,
      // The declaration simply not describing this copy IS the disagreement —
      // whether it named another profile or the copy turned out to be a bare
      // checkout. Requiring a second profile to compare against would report
      // the quieter half of the same problem as agreement.
      disagreement: declaredDir !== undefined && !declaredHoldsSelf,
    },
  }
}

/**
 * Read this plugin's raw dependency spec from one profile manifest.
 * @param dir - the profile directory.
 * @returns the spec string, or undefined when the manifest is unreadable.
 */
function readProfileSpec(dir: string | undefined): string | undefined {
  if (dir === undefined) return undefined
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(dir, 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> }
    const spec = manifest.dependencies?.[PACKAGE_NAME]
    return typeof spec === 'string' && spec !== '' ? spec : undefined
  } catch {
    return undefined
  }
}

/**
 * The version of this package as it exists on disk under `dir`: the installed
 * copy inside a profile, or the manifest of a checkout. Read after an update to
 * report what landed, rather than what an update claimed to do.
 * @param dir - a profile directory or a checkout directory.
 * @returns the version, or undefined when neither shape is readable.
 */
export function installedVersionIn(dir: string | undefined): string | undefined {
  if (dir === undefined) return undefined
  const candidates = [
    path.join(dir, 'node_modules', ...PACKAGE_NAME.split('/'), 'package.json'),
    path.join(dir, 'package.json'),
  ]
  for (const candidate of candidates) {
    try {
      const manifest = JSON.parse(fs.readFileSync(candidate, 'utf8')) as { version?: unknown }
      if (typeof manifest.version === 'string' && manifest.version !== '') return manifest.version
    } catch {
      // The next shape may still be readable; a missing file is not an error.
    }
  }
  return undefined
}

/**
 * Run one read-only git command; `undefined` on any failure (git may be absent).
 *
 * **异步，不是 `execFileSync`。** 两条理由，都不是风格问题：
 *
 *   1. **同步子进程会阻塞整个 host 事件循环。** 一次 `ls-remote` 挂住 6 秒，这 6 秒里
 *      同一个进程要伺候的每一条别的请求（看板文档、SSE、会话状态）都停着。
 *   2. **同步让「总预算」变成一个算不出来的数。** `boundedByBudget` 包一个同步调用
 *      没有意义：它先跑完，才轮到计时器。于是整段的墙钟时间是两段相加，而不是两者的
 *      较大值——那正好是这一版要修掉的缺陷的形状。
 * @param repoDir - the checkout directory.
 * @param args - the git arguments.
 * @param timeoutMs - the bound; a hung command is the same as an absent one.
 * @returns the trimmed stdout, or `undefined`.
 */
function gitOut(repoDir: string, args: string[], timeoutMs: number): Promise<string | undefined> {
  return new Promise<string | undefined>((resolve) => {
    execFile('git', args, {
      cwd: repoDir,
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
    }, (error, stdout) => {
      if (error !== null) { resolve(undefined); return }
      const text = stdout.toString().trim()
      resolve(text === '' ? undefined : text)
    })
  })
}

/**
 * Read the local checkout state without mutating it: HEAD plus worktree
 * dirtiness locally, the remote tip through `ls-remote` (no fetch, no local
 * ref moves). Any failure degrades to undefined — an unreadable checkout is
 * not an error, it just hides the git section.
 * @param repoDir - the `link:` target directory.
 * @returns the git status, or undefined when unreadable.
 */
async function readGitStatus(repoDir: string): Promise<UpdateGitStatus | undefined> {
  const head = await gitOut(repoDir, ['rev-parse', 'HEAD'], GIT_LOCAL_TIMEOUT_MS)
  if (head === undefined || head === '') return undefined
  const porcelain = (await gitOut(repoDir, ['status', '--porcelain'], GIT_LOCAL_TIMEOUT_MS)) ?? ''
  /* **打网络的那一段用 `CHECK_STAGE_BUDGET_MS`，不是客户端的 15 秒。** 走满它就意味着
     这次读取拿不到 git 状态（下面降级成 `undefined`，界面只是不显示 git 那一段），
     而不是让浏览器先放弃、把整次检查画成一次失败。见那个常量的注释。 */
  const remoteLine = await gitOut(repoDir, ['ls-remote', 'origin', 'refs/heads/main'], CHECK_STAGE_BUDGET_MS)
  const remoteHead = remoteLine !== undefined && remoteLine !== ''
    ? remoteLine.split(/\s/)[0]
    : undefined
  return {
    head,
    ...(remoteHead !== undefined && remoteHead !== '' ? { remoteHead } : {}),
    dirty: porcelain !== '',
  }
}

/**
 * The package manager a checkout declares. Its own `packageManager` field wins;
 * otherwise the lockfile it ships with decides, and a checkout with none of the
 * markers is read as npm — the manager every Node installation already has.
 * @param dir - the checkout directory.
 * @returns the command name to run the build with.
 */
function declaredManager(dir: string): string {
  let field: unknown
  try {
    field = (JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
      packageManager?: unknown
    }).packageManager
  } catch {
    field = undefined
  }
  const named = typeof field === 'string' ? field.match(/^(pnpm|npm|yarn|bun)@/)?.[1] : undefined
  if (named !== undefined) return named
  const has = (file: string): boolean => fs.existsSync(path.join(dir, file))
  if (has('pnpm-lock.yaml') || has('pnpm-workspace.yaml')) return 'pnpm'
  if (has('yarn.lock')) return 'yarn'
  if (has('bun.lockb') || has('bun.lock')) return 'bun'
  return 'npm'
}

/**
 * What refreshing a `link:` checkout runs: bring the working tree up to its
 * remote without creating a merge commit, then rebuild the `lib/` the host
 * loads. `--ff-only` is the point — a diverged checkout stops and says so
 * instead of merging two histories under a running plugin.
 * @param dir - the checkout directory.
 * @returns the steps, in order.
 */
function checkoutStepsFor(dir: string): UpdateStep[] {
  return [
    { command: 'git', args: ['pull', '--ff-only'] },
    { command: declaredManager(dir), args: ['run', 'build'] },
  ]
}

/** The installation service's registry plan, read by name (absent is supported). */
interface PluginManagerLike {
  registries?(): Promise<{
    registry?: unknown
    fallbackRegistries?: unknown
    resolved?: unknown
  }>
}

/** What the plan rules read, gathered once per request. */
interface PlanFacts {
  mode: UpdateInstallMode
  profile?: string
  appManaged: boolean
  checkoutDir?: string
  checkoutSteps?: UpdateStep[]
  canInstall: boolean
  reinstall: boolean
}

/**
 * Gather the facts every update surface needs, from THIS process. Nothing here
 * assumes a profile name: the profile comes from where this copy runs, and the
 * spec comes from that profile's own manifest.
 * @param ctx - context carrying the host services.
 * @param selfDir - where this copy's code actually is; the real location by
 * default, and an explicit premise wherever a caller must state one.
 * @returns the running copy's identity and plan.
 */
export function runningCopyOf(ctx: Context, selfDir = SELF_ROOT): RunningCopy {
  const profile = readProfile(ctx, selfDir)
  const spec = readProfileSpec(profile.dir)
  // A linked copy IS a checkout, whatever the manifest records — and when the
  // manifest cannot be read at all, the location still answers.
  const linked = profile.evidence.linked
  const mode: UpdateInstallMode = linked ? 'local' : classifyInstallSpec(spec)
  const checkoutDir = linked ? selfDir : undefined
  const facts: PlanFacts = {
    mode,
    ...(profile.profile !== undefined ? { profile: profile.profile } : {}),
    appManaged: profile.appManaged,
    ...(checkoutDir !== undefined ? { checkoutDir, checkoutSteps: checkoutStepsFor(checkoutDir) } : {}),
    canInstall: ctx.get('pluginManager') !== undefined,
    // The installation service refuses to install over an installed package
    // exactly when HMR is live, and refuses to remove a running bundle exactly
    // when it is not. Both halves are read from the predicate it uses itself.
    reinstall: ctx.get('hmr') !== undefined,
  }
  const plan = updatePlanFor({
    mode: facts.mode,
    packageName: PACKAGE_NAME,
    ...(GITHUB_SPEC !== undefined ? { githubSpec: GITHUB_SPEC } : {}),
    // What the profile declares WINS over the spec derived from the package's
    // own repository field: a fork or a tarball URL is what this reader
    // installed, and the update must re-add that, not the canonical repo.
    ...(spec !== undefined ? { recordedSpec: spec } : {}),
    ...(facts.profile !== undefined ? { profile: facts.profile } : {}),
    appManaged: facts.appManaged,
    canInstall: facts.canInstall,
    reinstall: facts.reinstall,
    ...(facts.checkoutSteps !== undefined ? { checkoutSteps: facts.checkoutSteps } : {}),
  })
  return {
    ...(profile.dir !== undefined ? { dir: profile.dir } : {}),
    ...(profile.profile !== undefined ? { profile: profile.profile } : {}),
    appManaged: profile.appManaged,
    ...(spec !== undefined ? { spec } : {}),
    mode,
    evidence: profile.evidence,
    ...(checkoutDir !== undefined ? { checkoutDir } : {}),
    plan,
  }
}

/** The registry plan one profile's installation service reports. */
export interface RegistryPlanLike {
  registry?: unknown
  fallbackRegistries?: unknown
  resolved?: unknown
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
export function registryOrderOf(plan: RegistryPlanLike | undefined): string[] {
  const ordered: string[] = []
  const add = (value: unknown): void => {
    if (typeof value === 'string' && value !== '' && !ordered.includes(value)) ordered.push(value)
  }
  // `resolved` is what pnpm reads right now; `registry` is the configured first
  // choice, and a null there means pnpm's own configuration decides.
  add(plan?.resolved)
  add(plan?.registry)
  if (Array.isArray(plan?.fallbackRegistries)) for (const item of plan.fallbackRegistries) add(item)
  for (const item of PUBLIC_REGISTRIES) add(item)
  return ordered
}

/**
 * 一个 registry 地址的**身份**：比较时只看这个，不看它写成什么样。
 *
 * 为什么要归一化再比：`PUBLIC_REGISTRIES` 里的两个值是常量（带结尾斜杠），而
 * `order` 里的值来自宿主安装服务。两者**今天**恰好一字不差（DSH 的
 * `normalizeRegistry` 会小写主机名并补上斜杠），但那是宿主的实现细节，不是契约。
 * 一旦某个来源给出 `https://registry.npmjs.org`（少一个斜杠），精确比较就会把
 * **公共源判成「用户自己的源」**——于是这次读取只问 npmjs、不问 npmmirror，
 * 而镜像回退正是「墙内也能用」的全部理由。
 *
 * 所以判据是身份：小写、去结尾斜杠。这样写法的差异不再能改变「谁算公共源」。
 * @param url - 一个 registry 地址。
 * @returns 用于比较的规范形式。
 */
function registryIdentityOf(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, '')
}

/** 公共源的规范形式，算一次。 */
const PUBLIC_IDENTITIES: ReadonlySet<string> = new Set(PUBLIC_REGISTRIES.map((one) => registryIdentityOf(one)))

/**
 * The registries to ask for this host, from its installation service when it has
 * one and from the public pair when it does not.
 *
 * 返回值分成两半，因为**两半的性质不同**：`own` 是这台机器自己配的源（镜像、内网
 * registry），`order` 是完整的询问次序（`own` 之后接公共回退）。
 *
 * 为什么必须分开：`order` 永远至少有两个公共源，所以「数组长度」说明不了「用户有
 * 没有配自己的源」。而这件事决定两件不同的事——配了自己的源就**只问它**（那是隐私
 * 与正确性），没配才**并发问公共源**（那才是性能）。用一个数字同时表达两件事，
 * 就会在某一头上错。
 *
 * @param ctx - context carrying the host services.
 * @returns `own`（用户配置的源，可能为空）与 `order`（完整询问次序）。
 */
async function registriesFor(ctx: Context): Promise<{ own: string[]; order: string[] }> {
  const manager = ctx.get('pluginManager') as PluginManagerLike | undefined
  let plan: RegistryPlanLike | undefined
  try {
    plan = await manager?.registries?.() as RegistryPlanLike | undefined
  } catch {
    // The service is not answering; the public pair below still applies.
    plan = undefined
  }
  const order = registryOrderOf(plan)
  /* 用户自己的源 = 完整次序里那些**不在公共名单里**的项。这样判断与
     `registryOrderOf` 的构造方式一致，不必在第二处重复「谁算公共」。
     比较的是**身份**而不是字面（见 `registryIdentityOf`）：一个少写斜杠的公共地址
     不该被误判成用户自己配的源，否则镜像回退会静默消失。 */
  const own = order.filter((url) => !PUBLIC_IDENTITIES.has(registryIdentityOf(url)))
  return { own, order }
}

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
function boundedByBudget<T>(work: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve) => {
    const timer = setTimeout(() => { resolve(undefined) }, ms)
    void work.then(
      (value) => { clearTimeout(timer); resolve(value) },
      () => { clearTimeout(timer); resolve(undefined) },
    )
  })
}

/**
 * Read one JSON document with a hard bound; any failure reads as undefined.
 *
 * @param url - the document to read.
 * @param timeoutMs - the bound; a hung endpoint is the same as an absent one.
 * @param headers - extra request headers. GitHub's contents API answers with the
 *   file body itself only when asked for `application/vnd.github.raw`; without
 *   it the same URL returns a base64 envelope instead.
 */
async function boundedJson(
  url: string,
  timeoutMs: number,
  headers?: Record<string, string>,
): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, timeoutMs)
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json', ...headers },
      signal: controller.signal,
    })
    if (!response.ok) return undefined
    return await response.json() as unknown
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/** The raw-content base for a `github:Owner/Repo` spec. */
function rawBaseOf(spec: string | undefined): string | undefined {
  if (spec === undefined || !spec.startsWith('github:')) return undefined
  const slug = spec.slice('github:'.length)
  return slug === '' ? undefined : `https://raw.githubusercontent.com/${slug}`
}

/**
 * 按次序起跑、带领先窗口的**对冲请求**：第一个成功答案胜出。
 *
 * ── 为什么这不是 `Promise.race`，也不是 `for … await` ──────────────────────
 *
 * 这两种写法在这个项目里都真出现过，各自错在不同的地方：
 *
 *   `for … await`（串行）：第一条挂住要等满它的超时才试第二条。实测两个 registry
 *     各自 0.5–1.0 秒可达，而接口要 2.3–4.0 秒——差额就是这段空等，而它每一天都
 *     在被等。
 *
 *   `Promise.race`（无序并发）：「第一个完成的」不等于「第一个成功的」。连接被拒
 *     往往比正常返回**更快**，于是明明有一条能答的来源，却被拒连的那条抢先，正确答案
 *     被丢掉。那会把「有更新」说成「读不到」。
 *
 * 对冲请求的形状是：按次序起跑，给前一条 `hedgeMs` 的领先窗口；窗口内它答了就结束
 * （次序被时间保证），窗口过后把下一条也发出去，之后第一个**成功**的胜出。
 *
 * ── 一条候选只许启动一次 ────────────────────────────────────────────────────
 *
 * 有**两条**路会把控制权推进到下一条：前一条**失败**时立刻推进（不等窗口——那 800ms
 * 是给「慢」的源留的，不该被「坏」的源白占），以及窗口到点时放行。两条路都会到同一条
 * 候选上，所以必须**在启动处去重**，而不是指望两条路互斥。
 *
 * 不去重的后果不是多一个请求，是**丢掉一个已经到手的答案**：重复的那条若先失败，而
 * 原来那条还在飞，`finished >= candidates.length` 就把整次读取定成 `undefined`——
 * 一个本来会作答的源被报成「读不到」，屏上就是「检查失败，请重试」。触发条件是「前
 * 一条在窗口内失败」（连接被拒通常就是几十毫秒）加上「后一条慢或抖」。
 *
 * @param candidates - 候选，按优先级从高到低。
 * @param hedgeMs - 领先窗口；超过它仍未答就放行下一条。
 * @param timeoutMs - 单条的上限，由 `ask` 自己带。
 * @returns 第一个可用答案；全部没有则 `undefined`。
 */
function hedgeFor<T>(
  candidates: readonly string[],
  hedgeMs: number,
  timeoutMs: number,
): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve) => {
    let settled = false
    let finished = 0
    const timers: ReturnType<typeof setTimeout>[] = []
    /* 已起跑的下标。存在的唯一理由是那两条推进路径会撞在一起（见函数的注释）。 */
    const launched = new Set<number>()
    const done = (value: T | undefined): void => {
      if (settled) return
      settled = true
      for (const timer of timers) clearTimeout(timer)
      resolve(value)
    }
    /* 空候选：没有任何一条会作答，所以**立刻**收场。留着不结算就是一个永不返回的
       Promise，而调用方在等它。 */
    if (candidates.length === 0) {
      done(undefined)
      return
    }
    const launch = (index: number): void => {
      if (settled || index >= candidates.length) return
      if (launched.has(index)) return
      launched.add(index)
      const candidate = candidates[index] as string
      const settleOne = (): void => {
        finished += 1
        /* **这一条没有答案，就立刻放下一条**——不等窗口走完，也不等别的候选。
           窗口是给「慢」的源留的，不该被「坏」的源白占：一条连不上的源让读者白等
           800ms，而那 800ms 里本来已经有另一条在等着被发出去。

           这里**无条件**推进，判据是「刚刚这一条失败了」，不是「已启动的都结算完了」。
           两者在只有一条在飞时相同，但在对冲之后不同：A 慢、B 由窗口放出、B 在 850ms
           失败时，若按后者判，C 要等到它自己的 1600ms 窗口才起跑——一次失败白等 750ms。
           `launch` 自己去重，所以无条件推进不会重复启动，也不会让窗口那条路多启一次。 */
        launch(index + 1)
        /* 收场只看「全部候选都结算过」。它**不能删**：没有它，最后一条失败之后既不
           推进也不结算，这个 Promise 永远不返回。也不能只留它——那样每次推进都要等
           窗口，而窗口存在的理由是「这条可能只是慢」，不是「它坏了」。 */
        if (finished >= candidates.length) done(undefined)
      }
      void boundedJson(packumentUrl(candidate, PACKAGE_NAME), timeoutMs).then(
        (document) => {
          const answer = latestFromPackument(document)
          if (answer !== undefined) {
            done({ ...answer, registry: candidate, source: 'registry' } as T)
            return
          }
          settleOne()
        },
        () => { settleOne() },
      )
      /* 窗口到点放行下一条。它同时是「前一条只是慢」的唯一出路——前一条若失败，
         失败那一支会立刻推进，而这里的去重保证不会因此启动第二条路。 */
      if (index + 1 < candidates.length) {
        timers.push(setTimeout(() => { launch(index + 1) }, hedgeMs))
      }
    }
    launch(0)
  })
}

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
export async function readLatest(
  ctx: Context,
  copy: Pick<RunningCopy, 'mode'>,
): Promise<UpdateLatestView | undefined> {
  /* **一个 checkout 的「有没有新版」不来自发布号。** 它由自己那份 git 状态回答
     （见 `readGitStatus`），去看 registry 上的发布号是另一件事，而且会把「本地改了
     还没提交」误报成「有新版」。这条判断在函数最前面，因为它省掉整条 registry 链，
     不只是省一次请求。

     **但这不等于这个请求不发任何网络请求。** 同一个请求里的 `readGitStatus` 会打一次
     `git ls-remote` 到那个 checkout 的 origin（通常是 github.com）——那一条是有意的，
     因为「远端有没有新提交」只能问远端。它的上限由 `CHECK_STAGE_BUDGET_MS` 压住，
     必须明显小于浏览器的预算，否则一次被墙的 github 会把整次检查拖成「检查失败」。 */
  if (copy.mode === 'local') return undefined

  /* ── **一条路走不通，不等于「检查失败」。** ───────────────────────────────────
   *
   * 这个函数原先按装法各走一条路：npm 问 registry、git 安装读
   * `raw.githubusercontent.com`、判定不了就 `return undefined`（永远显示「检查失败」）。
   *
   * 问题不在逻辑，在**可达性**。实测（同一个网络，同一次会话）：
   *
   *   registry.npmjs.org      200
   *   registry.npmmirror.com  200
   *   api.github.com          200
   *   raw.githubusercontent.com   SSL 连接被切断
   *
   * 于是同一个「检查更新」，装法不同的人得到完全不同的结果——其中一种**永远失败**，
   * 而失败的原因与「有没有新版本」毫无关系。
   *
   * 现在按可靠度逐层降级，哪一种装法都至少有一条通：
   *
   *   1. registry（发布过的版本才权威，而且两条公共源都在可用网络里）
   *   2. `api.github.com` 的 contents 接口（读同一份 package.json，走可达的域名，
   *      未登录限流 60 次/小时，手动点击绰绰有余）
   *   3. 最后才是 `raw.githubusercontent.com`
   *
   * 顺序是「最权威且最快 → 次优 → 最后手段」，不是「哪条路属于哪种装法」：**版本号这
   * 件事 registry 比仓库文件更权威**，因为只有发布过的版本才存在别人装得到的可能。
   */

  /**
   * 同时问所有候选源，取第一个给出**可用答案**的。
   *
   * 为什么不是 `Promise.race`：`race` 等的是「第一个 settle 的」，而第一个完成的
   * 完全可能是**失败**——连接被拒往往比正常返回还快。要的是第一个**成功**，所以逐个
   * settle，成功即返回。
   *
   * 为什么不是串行的 `for`：串行时每一层都可能吃满自己的超时，最坏 8 秒 × N 层，而
   * 那些时间几乎全花在等一个注定不可用的地址上。实测：两个 registry 各自 0.5–1.0 秒
   * 可达，接口却要 2.3–4.0 秒——差的正是「等前一个失败」。
   *
   * 权威次序没有因此改变：并发的只是**查询**，取舍仍然按此前的判断（registry 优先于
   * 仓库文件这件事由 `readLatest` 的分层决定，不由这里的快慢决定）。
   *
   * @param probes - 候选项；`ask` 返回 `undefined` 表示这一源没有可用答案。
   * @returns 第一个可用答案；全部没有则 `undefined`。
   */
  const raceFor = async <T>(
    probes: readonly { readonly ask: () => Promise<T | undefined> }[],
  ): Promise<T | undefined> => await new Promise<T | undefined>((resolve) => {
    let pending = probes.length
    if (pending === 0) {
      resolve(undefined)
      return
    }
    for (const probe of probes) {
      void probe.ask().then(
        (answer) => {
          if (answer !== undefined) {
            resolve(answer)
            return
          }
          pending -= 1
          if (pending === 0) resolve(undefined)
        },
        () => {
          /* 一个源抛错不是这条链的失败——其余源仍在跑。 */
          pending -= 1
          if (pending === 0) resolve(undefined)
        },
      )
    }
  })

  const fromRegistries = async (): Promise<UpdateLatestView | undefined> => {
    const { own, order } = await registriesFor(ctx)
    /* **配了源的人只问那个源。**
     *
     * 这不是性能取舍，是隐私与正确性：用户挑了一个镜像（公司内网、私有 registry），
     * 「这个包有没有新版本」就不该问到外面去——那是把他的依赖清单泄露给第三方。
     * 所以「只问自己的源」优先于任何并发技巧；那条路只有一条候选，也就无从并发。 */
    const candidates = own.length > 0 ? own : order
    if (candidates.length === 1) {
      const only = candidates[0] as string
      const answer = latestFromPackument(
        await boundedJson(packumentUrl(only, PACKAGE_NAME), REGISTRY_TIMEOUT_MS),
      )
      return answer === undefined ? undefined : { ...answer, registry: only, source: 'registry' }
    }

    /* ── 公共回退：**对冲请求**，不是串行排队，也不是无序并发 ────────────────────
     *
     * 两者都不对，理由不同：
     *
     *   - **串行**（原实现）：第一条挂住时要等满 8 秒才试第二条。实测这台机器上两条
     *     各自 0.5–1.0 秒可达，接口却要 2.3–4.0 秒——差的就是这段空等。
     *   - **无序并发**（`Promise.race`）：谁先 settle 就用谁，而先 settle 的完全可能
     *     是**失败**（连接被拒比正常返回快），于是明明有一条能答的来源，却被拒连的
     *     那条抢先。那会把「有更新」说成「读不到」。
     *
     * 对冲请求是两者的折中，也正是这一处想要的形状：**按次序起跑，给前一条一个短暂
     * 领先窗口**（`HEDGE_AFTER_MS`），窗口过后把下一条也发出去，然后**第一个成功的
     * 胜出**。于是
     *
     *   - 第一条正常（0.5–1 秒）→ 它先答，第二条根本没发出去 → 次序被尊重；
     *   - 第一条挂住 → 第二条在窗口后起跑，不必等满 8 秒 → 快；
     *   - 第一条失败 → 第二条已在跑或将要在跑 → 不会因为「先失败」而丢掉答案。
     *
     * 优先级由**时间**保证（窗口内只有第一条在跑），不靠运气。 */
    return await hedgeFor(candidates, HEDGE_AFTER_MS, REGISTRY_TIMEOUT_MS)
  }
  const fromRepository = async (): Promise<UpdateLatestView | undefined> => {
    const slug = GITHUB_SPEC !== undefined && GITHUB_SPEC.startsWith('github:')
      ? GITHUB_SPEC.slice('github:'.length)
      : undefined
    if (slug === undefined || slug === '') return undefined
    /* GitHub 的 contents 接口与 raw 读的是**同一份文件**，只是前者走 `api.github.com`。
       `Accept: raw` 让响应正文就是文件本身，不必解 base64。
       **两条路并发**：实测 `raw.githubusercontent.com` 在某些网络下 SSL 连接被切断，
       而 `api.github.com` 通——反过来也见过。串行时被切断的那条要等满超时才轮到通的那条。
       取舍取的是第一个**成功**的（不是第一个结束的）：连接被拒往往比正常返回更快，
       按「先到」取会把一个能答的源判掉。 */
    const base = rawBaseOf(GITHUB_SPEC)
    const versionOf = (document: unknown): string | undefined => {
      const version = (document as { version?: unknown } | undefined)?.version
      return typeof version === 'string' && version !== '' ? version : undefined
    }
    const probes = [
      {
        ask: async (): Promise<UpdateLatestView | undefined> => {
          const viaApi = await boundedJson(
            `https://api.github.com/repos/${slug}/contents/package.json`,
            REGISTRY_TIMEOUT_MS,
            { accept: 'application/vnd.github.raw' },
          )
          const version = versionOf(viaApi)
          return version === undefined ? undefined : { version, source: 'repository' }
        },
      },
    ]
    if (base !== undefined) {
      probes.push({
        ask: async (): Promise<UpdateLatestView | undefined> => {
          const manifest = await boundedJson(`${base}/HEAD/package.json`, REGISTRY_TIMEOUT_MS)
          const version = versionOf(manifest)
          return version === undefined ? undefined : { version, source: 'repository' }
        },
      })
    }
    // Only the declared version, on purpose. The branch's commit would be a
    // second network transport (a `git ls-remote` subprocess) in a check that
    // already has one, and there is nothing here to compare a commit AGAINST:
    // a git install carries no recorded commit of its own to measure against.
    // Version-against-version is one grammar for every mode.
    return await raceFor(probes)
  }
  /* **registry 先行，仓库只是它的后备——这条次序是契约，不能并发掉。**
   *
   * 为什么次序本身是契约（而不是「谁快谁先」）：
   *
   *   1. **权威**：版本号这件事 registry 比仓库文件更权威——只有发布过的版本才存在
   *      别人装得到的可能；仓库里那份 `package.json` 可能写着一个从未发布的号。
   *   2. **隐私**：装法判定不出来时也要问仓库，而问仓库意味着把「我在查这个包」这件事
   *      告诉 GitHub。能由 registry 答的问题就不该去问仓库。
   *
   * 所以这里是**有先后的**：registry 的候选全部试完（`fromRegistries` 内部对自己的
   * 候选做对冲，那只是「不必等死」，不改变 registry 先于仓库），答不上来才问仓库。
   *
   * 串行**不等于慢**：真正慢的那一段在 `fromRegistries` 内部——两个公共 registry 之间
   * 已经是对冲的，第一条挂住时第二条在 800ms 后起跑。这里串行的两条是「registry 整体」
   * 与「仓库」，而后者在绝大多数网络下根本不会被走到。 */
  const published = await fromRegistries()
  if (published !== undefined) return published
  /* registry 全答不上来（离线、私有源、包没发布过、判定不了的装法）——这时才问仓库。 */
  return await fromRepository()
}

/**
 * **一次读取的总上限。** 它小于浏览器的 15 秒预算，理由与 `CHECK_STAGE_BUDGET_MS`
 * 同一件：浏览器先放弃，屏上就是「检查失败」，而 host 还在正常干活。
 *
 * 为什么需要「总额」而不是只把每一段压小：`readLatest` 内部是**有层次**的——registry
 * 整体（最坏 800 + 8000 = 8.8 秒）答不上来才问仓库（最坏 8000 秒，两条探针并发）。
 * 逐段看每一段都「小于 15 秒」，加起来却是 16.8 秒。**每一段都合规而整体超支**，正是
 * 这类 bug 的形状：没有任何一个数字是错的，错的是它们的和，而和不写在任何一个地方。
 *
 * 所以这里量的是整次读取的时间，超了就带着已经读到的部分收场（`latest` 缺席），
 * 界面据此说「读不到」——那比让浏览器先放弃、把整次检查画成失败要好。
 */
const CHECK_TOTAL_BUDGET_MS = 11_000

/**
 * Build the live view: the running copy's own location and manifest spec, the
 * newest upstream this host can read for that mode, and the checkout state for
 * a linked copy.
 * @param ctx - context carrying the host services.
 * @returns the update-source view.
 */
async function readLiveView(ctx: Context): Promise<UpdateSourceView> {
  const copy = runningCopyOf(ctx)
  /* **两件事并发，各自都受同一个总额保护。**
   *
   * 原先这里是「先读 git 状态（同步，最长 12 秒：本地两条各 3 秒 + `ls-remote` 6 秒），
   * 再从余额里扣掉 6 秒给 `readLatest`」——那是个**算术**保证，而算术会算错：git 的
   * 真实最坏是 3000 + 3000 + 6000 = 12 秒，扣掉 6 秒之后剩 5 秒，两者相加仍是 17 秒，
   * 比客户端的 15 秒还长。于是这个函数存在的理由（host 不许比浏览器活得久）在**最需要
   * 它的那一条路上**恰好失效：一个 `ls-remote` 挂住的 checkout。
   *
   * 改成并发之后，保证是**结构性的**而不是算术的：两件事同时起跑，谁都没有机会把
   * 对方的时间花掉，整段的墙钟时间不超过 `CHECK_TOTAL_BUDGET_MS`。
   *
   * 而且这本来就是它们的关系——它们互不依赖：一个问「本机这份 checkout 在哪、脏不脏、
   * 远端有没有新提交」，一个问「上游发布到哪一版」。串行只是历史顺序。
   *
   * 超时的后果都是**降级而非失败**：`git` 缺席只是不显示 git 那一段（对话里那句
   * 「远端读不到」就是它），`latest` 缺席是「读不到最新版」。两者都不是「检查失败」。 */
  const gitWork = copy.checkoutDir !== undefined
    ? boundedByBudget(readGitStatus(copy.checkoutDir), CHECK_TOTAL_BUDGET_MS)
    : Promise.resolve(undefined)
  const latestWork = boundedByBudget(readLatest(ctx, copy), CHECK_TOTAL_BUDGET_MS)
  const [git, latest] = await Promise.all([gitWork, latestWork])
  // What the pages that are actually open reported about themselves (bundle
  // version + measured geometry). Diagnosing "the phone looks wrong" without
  // this meant arguing from screenshots; with it, the host shows the truth.
  const clients = readClientReports()
  return {
    packageName: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    ...(copy.spec !== undefined ? { spec: copy.spec } : {}),
    mode: copy.mode,
    ...(copy.profile !== undefined ? { profile: copy.profile } : {}),
    ...(copy.dir !== undefined ? { dir: copy.dir } : {}),
    appManaged: copy.appManaged,
    evidence: copy.evidence,
    ...(GITHUB_SPEC !== undefined ? { githubSpec: GITHUB_SPEC } : {}),
    plan: copy.plan,
    ...(latest !== undefined ? { latest } : {}),
    ...(git !== undefined ? { git } : {}),
    ...(clients.length > 0 ? { clients } : {}),
  }
}

/**
 * Apply the running copy's own plan. The request body is never read: the plan
 * is re-derived here, so a page cannot ask this route to install anything the
 * copy is not already declared to be.
 *
 * The version is read back from disk afterwards rather than taken from the
 * answer: on an HMR host this update uninstalls the plugin that is serving this
 * very request, so the answer may never arrive, and only the file on disk says
 * what actually landed.
 * @param ctx - context carrying the host services.
 * @returns the apply result.
 */
async function applyRunningCopy(ctx: Context): Promise<UpdateApplyResult> {
  const copy = runningCopyOf(ctx)
  const installer = ctx.get('pluginManager') as PackageInstaller | undefined
  const target = copy.plan.apply === 'checkout' ? copy.checkoutDir : copy.dir
  const status = copy.checkoutDir !== undefined ? await readGitStatus(copy.checkoutDir) : undefined
  return await applyUpdate({
    plan: copy.plan,
    ...(installer !== undefined ? { installer } : {}),
    runner: spawnStep,
    ...(copy.checkoutDir !== undefined
      ? {
        checkout: {
          dir: copy.checkoutDir,
          dirty: status?.dirty === true,
        },
      }
      : {}),
    readVersion: () => installedVersionIn(target),
  })
}

/**
 * Register the update route on the host web server: GET reads the view, POST
 * applies the plan.
 * @param ctx - context carrying the webServer service.
 * @param ns - the plugin namespace (route path prefix).
 * @returns the route disposer, or a no-op when the web server is absent.
 */
export function registerUpdateRoute(ctx: Context, ns: string): () => void {
  const webServer = ctx.get('webServer') as { register(options: unknown): () => void } | undefined
  if (webServer === undefined) return () => undefined
  const handler = createUpdateHandler({
    read: () => readLiveView(ctx),
    apply: () => applyRunningCopy(ctx),
  })
  return webServer.register({ kind: 'exact', path: `/api/${ns}/update`, handler })
}
