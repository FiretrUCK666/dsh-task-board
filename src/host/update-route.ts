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

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  classifyInstallSpec,
  githubSpecOfRepositoryUrl,
  updatePlanFor,
  type UpdateGitStatus,
  type UpdateInstallMode,
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

/** The profile facts this route reads by name; every field is optional. */
interface ProfileContextLike {
  name?: unknown
  dir?: unknown
  /** Present only when a packaged application supplies its own package manager. */
  packageManager?: unknown
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
  /** The profile belongs to a packaged application, which installs through its own runtime. */
  appManaged: boolean
  /** The `github:` install spec (absent when the repo URL is not GitHub). */
  githubSpec?: string
  /** How to update this copy, and who applies it. */
  plan: UpdatePlan
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
  /** Read the current update-source view. */
  read(): UpdateSourceView
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
        view = deps.read()
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
  /** The checkout a `link:` install points at. */
  checkoutDir?: string
  /** What an update on this copy runs, and who applies it. */
  plan: UpdatePlan
}

/**
 * Read which profile is running, from the host's own declaration first and the
 * launcher's environment second. No profile name is assumed: a name that is
 * not observed here is not used anywhere.
 * @param ctx - context carrying the host services.
 * @returns the profile directory, its name, and whether an application owns it.
 */
function readProfile(ctx: Context): { dir?: string; profile?: string; appManaged: boolean } {
  const declared = ctx.get('profileContext') as ProfileContextLike | undefined
  const envDir = process.env.DSH_PROFILE_DIR
  const dir = typeof declared?.dir === 'string' && declared.dir !== ''
    ? declared.dir
    : typeof envDir === 'string' && envDir !== '' ? envDir : undefined
  const name = typeof declared?.name === 'string' && declared.name !== ''
    ? declared.name
    : dir !== undefined ? path.basename(dir) : undefined
  return {
    ...(dir !== undefined ? { dir } : {}),
    ...(name !== undefined && name !== '' ? { profile: name } : {}),
    appManaged: declared?.packageManager !== undefined,
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

/** What the plan rules read, gathered once per request. */
interface PlanFacts {
  mode: UpdateInstallMode
  profile?: string
  appManaged: boolean
  checkoutDir?: string
  checkoutSteps?: UpdateStep[]
  canInstall: boolean
}

/**
 * Gather the facts every update surface needs, from THIS process. Nothing here
 * assumes a profile name: the profile comes from the host's declaration (or the
 * launcher's environment), and the spec comes from that profile's own manifest.
 * @param ctx - context carrying the host services.
 * @returns the running copy's identity and plan.
 */
export function runningCopyOf(ctx: Context): RunningCopy {
  const profile = readProfile(ctx)
  const spec = readProfileSpec(profile.dir)
  const mode = classifyInstallSpec(spec)
  const checkoutDir = mode === 'local' && spec !== undefined && spec.startsWith('link:')
    ? spec.slice('link:'.length)
    : undefined
  const facts: PlanFacts = {
    mode,
    ...(profile.profile !== undefined ? { profile: profile.profile } : {}),
    appManaged: profile.appManaged,
    ...(checkoutDir !== undefined ? { checkoutDir, checkoutSteps: checkoutStepsFor(checkoutDir) } : {}),
    canInstall: ctx.get('pluginManager') !== undefined,
  }
  const plan = updatePlanFor({
    mode: facts.mode,
    packageName: PACKAGE_NAME,
    ...(GITHUB_SPEC !== undefined ? { githubSpec: GITHUB_SPEC } : {}),
    ...(facts.profile !== undefined ? { profile: facts.profile } : {}),
    appManaged: facts.appManaged,
    canInstall: facts.canInstall,
    ...(facts.checkoutSteps !== undefined ? { checkoutSteps: facts.checkoutSteps } : {}),
  })
  return {
    ...(profile.dir !== undefined ? { dir: profile.dir } : {}),
    ...(profile.profile !== undefined ? { profile: profile.profile } : {}),
    appManaged: profile.appManaged,
    ...(spec !== undefined ? { spec } : {}),
    mode,
    ...(checkoutDir !== undefined ? { checkoutDir } : {}),
    plan,
  }
}

/**
 * Build the live view: the running copy's own manifest spec, classified through
 * the shared grammar, plus the checkout state for `link:` installs.
 * @param ctx - context carrying the host services.
 * @returns the update-source view.
 */
function readLiveView(ctx: Context): UpdateSourceView {
  const copy = runningCopyOf(ctx)
  const git = copy.checkoutDir !== undefined ? readGitStatus(copy.checkoutDir) : undefined
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
    appManaged: copy.appManaged,
    ...(GITHUB_SPEC !== undefined ? { githubSpec: GITHUB_SPEC } : {}),
    plan: copy.plan,
    ...(git !== undefined ? { git } : {}),
    ...(clients.length > 0 ? { clients } : {}),
  }
}

/**
 * Apply the running copy's own plan. The request body is never read: the plan
 * is re-derived here, so a page cannot ask this route to install anything the
 * copy is not already declared to be.
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
