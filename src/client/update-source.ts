/**
 * Browser readers for the header's check-for-updates button: the installed
 * source (version + where it runs from + the plan that updates it) from the
 * host route, and the one action that applies the plan.
 *
 * The published latest comes from that same route. It used to be fetched here
 * from `registry.npmjs.org` directly, which meant a reader behind a mirror —
 * the very reader who picked that mirror when installing — got a failed check
 * instead of an answer, and a git install got no check at all. `latest` is a
 * host-side fact for the same reason the install mode is: only the host knows
 * which registry this profile actually uses.
 *
 * Every failure degrades to `undefined` (the button reads it as "check
 * failed, retry inline"), so a dropped line, a blocked registry, or an old
 * host without the route can never take the board down — the same discipline
 * as the board transport's bounded fetch.
 */
import type {
  UpdateGitStatus,
  UpdateInstallMode,
  UpdateLatestView,
  UpdatePlan,
  UpdateStep,
} from '../core/update-check.ts'
import { routeUrl } from './route-base.ts'
import packageJson from '../../package.json'

/** The bundle's own package identity (the host-unreachable fallback). */
export const BUNDLED_PACKAGE_NAME =
  (packageJson as { name?: string }).name ?? 'dsh-task-board'

/** The bundle's own version (the host-unreachable comparison baseline). */
export const BUNDLED_VERSION =
  (packageJson as { version?: string }).version ?? 'unknown'

/** How the host established which copy is running. */
export interface UpdateEvidence {
  /** This copy is a link into a checkout, not a copy installed in a profile. */
  linked: boolean
  /** The host declared a profile at all. */
  declared: boolean
  /** The declaration named a different copy than the one actually running. */
  disagreement: boolean
}

/** The installed-source view the host update route serves. */
export interface UpdateSourceView {
  /** Package name (the npm update command's subject). */
  packageName: string
  /** The running copy's version. */
  version: string
  /** Raw profile-manifest declaration (absent when the host cannot read it). */
  spec?: string
  /** Classified install mode. */
  mode: UpdateInstallMode
  /** The profile carrying this copy (absent when the host cannot read it). */
  profile?: string
  /** The profile's directory, or the checkout this copy runs from. */
  dir?: string
  /** The profile belongs to a packaged application, which installs through its own runtime. */
  appManaged: boolean
  /** How the host established which copy is running (absent from an older host). */
  evidence?: UpdateEvidence
  /** The `github:` install spec (absent when the repo URL is not GitHub). */
  githubSpec?: string
  /** How to update this copy, and who applies it. */
  plan: UpdatePlan
  /** The newest upstream the host could read (absent is "cannot tell"). */
  latest?: UpdateLatestView
  /** Local-checkout git state (only for `local` installs). */
  git?: UpdateGitStatus
}

/** What one applied update did, as the host reported it. */
export interface UpdateApplyResult {
  ok: boolean
  outcome?: 'applied' | 'restart-required' | 'rebuilt'
  version?: string
  output?: string
  error?: 'unsupported' | 'unavailable' | 'dirty' | 'tool-missing' | 'timeout' | 'failed'
}

/** Fetch one JSON document with a hard bound; any failure reads as undefined. */
async function boundedJson(
  url: string,
  timeoutMs: number,
  init?: RequestInit,
): Promise<unknown> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => { ctrl.abort() }, timeoutMs)
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: ctrl.signal,
      ...init,
    })
    if (!response.ok) return undefined
    return await response.json() as unknown
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/** Whether a string is one of the four install modes. */
function isMode(value: unknown): value is UpdateInstallMode {
  return value === 'npm' || value === 'github' || value === 'local' || value === 'unknown'
}

/** Whether a string is one of the three apply paths. */
function isApplyKind(value: unknown): value is UpdatePlan['apply'] {
  return value === 'package' || value === 'checkout' || value === 'none'
}

/** Whether a value is one update step (a command and its arguments). */
function isStep(value: unknown): value is UpdateStep {
  if (typeof value !== 'object' || value === null) return false
  const step = value as { command?: unknown; args?: unknown }
  return typeof step.command === 'string'
    && Array.isArray(step.args)
    && step.args.every(argument => typeof argument === 'string')
}

/**
 * Parse the plan the host serves. A plan this bundle does not understand is
 * dropped rather than half-read: the button then falls back to the copyable
 * line the view already carries, and never to a guess.
 * @param value - the wire value.
 * @returns the plan, or undefined when it is not one this bundle understands.
 */
function parsePlan(value: unknown): UpdatePlan | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const plan = value as Record<string, unknown>
  if (!isMode(plan.mode) || !isApplyKind(plan.apply)) return undefined
  return {
    mode: plan.mode,
    ...(typeof plan.packageName === 'string' ? { packageName: plan.packageName } : {}),
    ...(typeof plan.profile === 'string' ? { profile: plan.profile } : {}),
    appManaged: plan.appManaged === true,
    ...(typeof plan.packageSpec === 'string' ? { packageSpec: plan.packageSpec } : {}),
    ...(plan.reinstall === true ? { reinstall: true } : {}),
    apply: plan.apply,
    steps: Array.isArray(plan.steps) ? plan.steps.filter(isStep) : [],
  }
}

/** Whether a value is one of the four install modes. */
function isEvidence(value: unknown): value is UpdateEvidence {
  if (typeof value !== 'object' || value === null) return false
  const evidence = value as Record<string, unknown>
  return typeof evidence.linked === 'boolean' && typeof evidence.declared === 'boolean'
}

/**
 * Parse the newest-upstream reading. An answer without a version is not an
 * answer: it is dropped, and the page then says it cannot tell.
 * @param value - the wire value.
 * @returns the reading, or undefined when it is not one.
 */
function parseLatest(value: unknown): UpdateLatestView | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const latest = value as Record<string, unknown>
  if (typeof latest.version !== 'string' || latest.version === '') return undefined
  const source = latest.source === 'repository' ? 'repository' : latest.source === 'registry' ? 'registry' : undefined
  if (source === undefined) return undefined
  return {
    version: latest.version,
    source,
    ...(typeof latest.publishedAt === 'string' ? { publishedAt: latest.publishedAt } : {}),
    ...(typeof latest.registry === 'string' ? { registry: latest.registry } : {}),
  }
}

/**
 * Read the installed source through the host route. An old host without the
 * route answers 404 (or hangs), which degrades to undefined like any other
 * failure — the button then compares the bundle version against npm with an
 * unknown install mode.
 * @param timeoutMs - per-request bound (default 15s, the transport's budget).
 * @returns the source view, or undefined when unreadable.
 */
export async function fetchUpdateSource(timeoutMs = 15_000): Promise<UpdateSourceView | undefined> {
  const body = await boundedJson(routeUrl('/api/dsh-task-board/update'), timeoutMs)
  if (typeof body !== 'object' || body === null) return undefined
  const envelope = body as { ok?: unknown; value?: unknown }
  if (envelope.ok !== true || typeof envelope.value !== 'object' || envelope.value === null) {
    return undefined
  }
  const value = envelope.value as Record<string, unknown>
  if (typeof value.packageName !== 'string' || typeof value.version !== 'string' || !isMode(value.mode)) {
    return undefined
  }
  const plan = parsePlan(value.plan)
  if (plan === undefined) return undefined
  const git = value.git as Record<string, unknown> | undefined
  const latest = parseLatest(value.latest)
  return {
    packageName: value.packageName,
    version: value.version,
    ...(typeof value.spec === 'string' ? { spec: value.spec } : {}),
    mode: value.mode,
    ...(typeof value.profile === 'string' ? { profile: value.profile } : {}),
    ...(typeof value.dir === 'string' ? { dir: value.dir } : {}),
    appManaged: value.appManaged === true,
    ...(isEvidence(value.evidence) ? { evidence: value.evidence } : {}),
    ...(typeof value.githubSpec === 'string' ? { githubSpec: value.githubSpec } : {}),
    plan,
    ...(latest !== undefined ? { latest } : {}),
    ...(git !== undefined && typeof git === 'object' && git !== null
      && typeof git.head === 'string'
      && typeof git.dirty === 'boolean'
      ? {
        git: {
          head: git.head,
          ...(typeof git.remoteHead === 'string' ? { remoteHead: git.remoteHead } : {}),
          dirty: git.dirty,
        },
      }
      : {}),
  }
}

/**
 * Ask the host to apply the update it described. The request carries nothing:
 * the host re-derives the plan from the running copy, so the page can never
 * ask for a different installation than the one it is running in.
 *
 * The bound is generous on purpose — a package download plus a compile is
 * minutes, not seconds — and the caller re-reads the source afterwards, so an
 * answer lost to a live reload is not mistaken for a failed update.
 * @param timeoutMs - per-request bound (default 10 minutes).
 * @returns the result, or undefined when the answer never arrived.
 */
export async function applyUpdate(timeoutMs = 600_000): Promise<UpdateApplyResult | undefined> {
  const body = await boundedJson(
    routeUrl('/api/dsh-task-board/update'),
    timeoutMs,
    { method: 'POST' },
  )
  if (typeof body !== 'object' || body === null) return undefined
  const envelope = body as { ok?: unknown; value?: unknown }
  if (envelope.ok !== true || typeof envelope.value !== 'object' || envelope.value === null) {
    return undefined
  }
  const value = envelope.value as Record<string, unknown>
  if (typeof value.ok !== 'boolean') return undefined
  const outcome = value.outcome
  const error = value.error
  return {
    ok: value.ok,
    ...(outcome === 'applied' || outcome === 'restart-required' || outcome === 'rebuilt'
      ? { outcome }
      : {}),
    ...(typeof value.version === 'string' ? { version: value.version } : {}),
    ...(typeof value.output === 'string' ? { output: value.output } : {}),
    ...(typeof error === 'string' ? { error: error as UpdateApplyResult['error'] } : {}),
  }
}

