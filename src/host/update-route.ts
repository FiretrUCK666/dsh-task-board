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

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { classifyInstallSpec, githubSpecOfRepositoryUrl, type UpdateGitStatus, type UpdateInstallMode } from '../core/update-check.ts'
import { readClientReports, type ClientReport } from './client-report-route.ts'
import packageJson from '../../package.json'

/** Package identity, read live from the manifest (never repeated in code). */
const PACKAGE_NAME = (packageJson as { name?: string }).name ?? ''
const PACKAGE_VERSION = (packageJson as { version?: string }).version ?? 'unknown'
const GITHUB_SPEC = githubSpecOfRepositoryUrl(
  (packageJson as { repository?: { url?: string } }).repository?.url ?? '',
)

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
  /** The `github:` install spec (absent when the repo URL is not GitHub). */
  githubSpec?: string
  /** Local-checkout git state (only for `local` installs). */
  git?: UpdateGitStatus
  /** Self-reports from the pages that are currently open (newest first). */
  clients?: ClientReport[]
}

/** Success envelope carrying the update-source view. */
export interface UpdateRouteOk {
  ok: true
  value: UpdateSourceView
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
}

/**
 * Build the pure update-source route processor.
 * @param deps - the view face (real or fake).
 * @returns an HTTP handler for GET on the update route.
 */
export function createUpdateHandler(
  deps: UpdateRouteDeps,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res): Promise<void> => {
    if (req.method !== 'GET') {
      res.writeHead(405)
      res.end()
      return
    }
    let view: UpdateSourceView
    try {
      view = deps.read()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      json(res, { ok: false as const, error: { code: 'update', message } })
      return
    }
    json(res, { ok: true as const, value: view })
  }
}

/**
 * Read this plugin's raw dependency spec from the web profile manifest.
 * @returns the spec string, or undefined when the manifest is unreadable.
 */
function readProfileSpec(): string | undefined {
  try {
    const home = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
    const manifest = JSON.parse(
      fs.readFileSync(path.join(home, 'profiles', 'web', 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> }
    const spec = manifest.dependencies?.[PACKAGE_NAME]
    return typeof spec === 'string' ? spec : undefined
  } catch {
    return undefined
  }
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
 * Build the live view: manifest spec classified through the shared grammar,
 * plus the checkout state for `link:` installs.
 * @returns the update-source view.
 */
function readLiveView(): UpdateSourceView {
  const spec = readProfileSpec()
  const mode = classifyInstallSpec(spec)
  let git: UpdateGitStatus | undefined
  if (mode === 'local' && spec !== undefined) {
    git = readGitStatus(spec.slice('link:'.length))
  }
  return {
    packageName: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    ...(spec !== undefined ? { spec } : {}),
    mode,
    ...(GITHUB_SPEC !== undefined ? { githubSpec: GITHUB_SPEC } : {}),
    ...(git !== undefined ? { git } : {}),
    // What the pages that are actually open reported about themselves (bundle
    // version + measured geometry). Diagnosing "the phone looks wrong" without
    // this meant arguing from screenshots; with it, the host shows the truth.
    ...(() => {
      const clients = readClientReports()
      return clients.length > 0 ? { clients } : {}
    })(),
  }
}

/**
 * Register the update-source route on the host web server.
 * @param ctx - context carrying the webServer service.
 * @param ns - the plugin namespace (route path prefix).
 * @returns the route disposer, or a no-op when the web server is absent.
 */
export function registerUpdateRoute(ctx: Context, ns: string): () => void {
  const webServer = ctx.get('webServer') as { register(options: unknown): () => void } | undefined
  if (webServer === undefined) return () => undefined
  const handler = createUpdateHandler({ read: readLiveView })
  return webServer.register({ kind: 'exact', path: `/api/${ns}/update`, handler })
}
