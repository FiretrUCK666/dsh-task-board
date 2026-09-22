/**
 * Browser readers for the header's check-for-updates button: the installed
 * source (version + install mode + checkout state) from the host route, and
 * the published latest from the public npm registry.
 *
 * Every failure degrades to `undefined` (the button reads it as "check
 * failed, retry inline"), so a dropped line, a blocked registry, or an old
 * host without the route can never take the board down — the same discipline
 * as the board transport's bounded fetch.
 */
import type { UpdateGitStatus, UpdateInstallMode } from '../core/update-check.ts'
import { routeUrl } from './route-base.ts'
import packageJson from '../../package.json'

/** The bundle's own package identity (the host-unreachable fallback). */
export const BUNDLED_PACKAGE_NAME =
  (packageJson as { name?: string }).name ?? 'dsh-task-board'

/** The bundle's own version (the host-unreachable comparison baseline). */
export const BUNDLED_VERSION =
  (packageJson as { version?: string }).version ?? 'unknown'

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
  /** The `github:` install spec (absent when the repo URL is not GitHub). */
  githubSpec?: string
  /** Local-checkout git state (only for `local` installs). */
  git?: UpdateGitStatus
}

/** The published latest read off the npm registry. */
export interface NpmLatest {
  /** The `dist-tags.latest` version. */
  version: string
  /** The registry's publish instant for that version, when advertised. */
  publishedAt?: string
}

/** Fetch one JSON document with a hard bound; any failure reads as undefined. */
async function boundedJson(url: string, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => { ctrl.abort() }, timeoutMs)
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: ctrl.signal,
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
  const git = value.git as Record<string, unknown> | undefined
  return {
    packageName: value.packageName,
    version: value.version,
    ...(typeof value.spec === 'string' ? { spec: value.spec } : {}),
    mode: value.mode,
    ...(typeof value.githubSpec === 'string' ? { githubSpec: value.githubSpec } : {}),
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
 * Read the published latest from the public npm registry packument
 * (`dist-tags.latest` plus its publish instant from `time`).
 * @param packageName - the scoped package name (slash-encoded for the URL).
 * @param timeoutMs - per-request bound (default 15s).
 * @returns the latest version, or undefined when unreadable.
 */
export async function fetchNpmLatest(
  packageName: string,
  timeoutMs = 15_000,
): Promise<NpmLatest | undefined> {
  const body = await boundedJson(
    `https://registry.npmjs.org/${packageName.replace('/', '%2F')}`,
    timeoutMs,
  )
  if (typeof body !== 'object' || body === null) return undefined
  const packument = body as {
    'dist-tags'?: { latest?: unknown }
    time?: Record<string, unknown>
  }
  const latest = packument['dist-tags']?.latest
  if (typeof latest !== 'string' || latest === '') return undefined
  const published = packument.time?.[latest]
  return {
    version: latest,
    ...(typeof published === 'string' ? { publishedAt: published } : {}),
  }
}
