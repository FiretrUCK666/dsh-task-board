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
import { execFileSync } from 'node:child_process'
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
/** How long one registry answer may take before the next one is asked. */
const REGISTRY_TIMEOUT_MS = 8000
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

/** Run one read-only git command; undefined on any failure (git may be absent). */
function gitOut(repoDir: string, args: string[], timeoutMs: number): string | undefined {
  try {
    return execFileSync('git', args, {
      cwd: repoDir,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: timeoutMs,
    }).toString().trim()
  } catch {
    return undefined
  }
}

/**
 * Read the local checkout state without mutating it: HEAD plus worktree
 * dirtiness locally, the remote tip through `ls-remote` (no fetch, no local
 * ref moves). Any failure degrades to undefined — an unreadable checkout is
 * not an error, it just hides the git section.
 * @param repoDir - the `link:` target directory.
 * @returns the git status, or undefined when unreadable.
 */
function readGitStatus(repoDir: string): UpdateGitStatus | undefined {
  const head = gitOut(repoDir, ['rev-parse', 'HEAD'], 10_000)
  if (head === undefined || head === '') return undefined
  const porcelain = gitOut(repoDir, ['status', '--porcelain'], 10_000) ?? ''
  const remoteLine = gitOut(repoDir, ['ls-remote', 'origin', 'refs/heads/main'], 15_000)
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
 * The registries to ask, in order, for the plan an installation service
 * reported.
 *
 * Pure, and separate from the service call that produces the plan, because the
 * ORDER is the part with a rule in it: the profile's own plan first (it knows
 * the mirrors, private sources, proxies and credentials this installation
 * really uses), then the public pair.
 *
 * Asking the public pair after a private source is safe here because the only
 * thing ever asked for is THIS package, which is public: a private source that
 * answers ends the walk before a public one is reached, and a private source
 * that does not carry the package is exactly the case where the public answer
 * is the right one.
 * @param plan - the service's plan, or undefined when it reported none.
 * @returns the registry base URLs, in the order to ask them, without repeats.
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
 * The registries to ask for this host, from its installation service when it has
 * one and from the public pair when it does not.
 * @param ctx - context carrying the host services.
 * @returns the registry base URLs, in the order to ask them.
 */
async function registriesFor(ctx: Context): Promise<string[]> {
  const manager = ctx.get('pluginManager') as PluginManagerLike | undefined
  let plan: RegistryPlanLike | undefined
  try {
    plan = await manager?.registries?.() as RegistryPlanLike | undefined
  } catch {
    // The service is not answering; the public pair below still applies.
    plan = undefined
  }
  return registryOrderOf(plan)
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
 * The newest upstream for this copy, as this host can read it.
 *
 * A registry install asks the profile's own registries in order; a repository
 * install reads the version the default branch declares and the commit that
 * branch is on. A checkout is compared by its own git state instead (see
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
  const fromRegistries = async (): Promise<UpdateLatestView | undefined> => {
    for (const registry of await registriesFor(ctx)) {
      const answer = latestFromPackument(
        await boundedJson(packumentUrl(registry, PACKAGE_NAME), REGISTRY_TIMEOUT_MS),
      )
      if (answer !== undefined) return { ...answer, registry, source: 'registry' }
    }
    return undefined
  }
  const fromRepository = async (): Promise<UpdateLatestView | undefined> => {
    const slug = GITHUB_SPEC !== undefined && GITHUB_SPEC.startsWith('github:')
      ? GITHUB_SPEC.slice('github:'.length)
      : undefined
    if (slug === undefined || slug === '') return undefined
    /* GitHub 的 contents 接口与 raw 读的是**同一份文件**，只是前者走 `api.github.com`。
       `Accept: raw` 让响应正文就是文件本身，不必解 base64。 */
    const viaApi = await boundedJson(
      `https://api.github.com/repos/${slug}/contents/package.json`,
      REGISTRY_TIMEOUT_MS,
      { accept: 'application/vnd.github.raw' },
    )
    const apiVersion = (viaApi as { version?: unknown } | undefined)?.version
    if (typeof apiVersion === 'string' && apiVersion !== '') {
      return { version: apiVersion, source: 'repository' }
    }
    const base = rawBaseOf(GITHUB_SPEC)
    if (base === undefined) return undefined
    const manifest = await boundedJson(`${base}/HEAD/package.json`, REGISTRY_TIMEOUT_MS)
    const version = (manifest as { version?: unknown } | undefined)?.version
    if (typeof version !== 'string' || version === '') return undefined
    // Only the declared version, on purpose. The branch's commit would be a
    // second network transport (a `git ls-remote` subprocess) in a check that
    // already has one, and there is nothing here to compare a commit AGAINST:
    // a git install carries no recorded commit of its own to measure against.
    // Version-against-version is one grammar for every mode.
    return { version, source: 'repository' }
  }
  /* registry 先问：最权威，且两种装法下都可达。 */
  const published = await fromRegistries()
  if (published !== undefined) return published
  /* registry 全答不上来（离线、私有源、包没发布过）——这时才问仓库。 */
  if (copy.mode === 'github') return await fromRepository()
  /* **判定不了的装法也问一次。** 原先这里 `return undefined`，于是「不知道自己是
     怎么装的」等于「永远检查失败」；而那恰恰是最需要一次答案的情形。 */
  if (copy.mode === 'unknown') return await fromRepository()
  return undefined
}

/**
 * Build the live view: the running copy's own location and manifest spec, the
 * newest upstream this host can read for that mode, and the checkout state for
 * a linked copy.
 * @param ctx - context carrying the host services.
 * @returns the update-source view.
 */
async function readLiveView(ctx: Context): Promise<UpdateSourceView> {
  const copy = runningCopyOf(ctx)
  const git = copy.checkoutDir !== undefined ? readGitStatus(copy.checkoutDir) : undefined
  const latest = await readLatest(ctx, copy)
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
  return await applyUpdate({
    plan: copy.plan,
    ...(installer !== undefined ? { installer } : {}),
    runner: spawnStep,
    ...(copy.checkoutDir !== undefined
      ? {
        checkout: {
          dir: copy.checkoutDir,
          dirty: readGitStatus(copy.checkoutDir)?.dirty === true,
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
