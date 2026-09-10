/**
 * Update-check grammar for the task-board plugin: how the installed copy
 * compares against the published latest, and which terminal command updates
 * it. Pure logic — no DOM, no fetch, no Node APIs — so the host route and
 * the browser half share it without a platform seam.
 *
 * The plugin intentionally never updates itself in place: the host half runs
 * inside the live DSH process, so rewriting the profile underneath it would
 * tear down the very routes serving the board. Checking is live; updating is
 * a copyable command plus a restart note.
 * @module dsh-task-board/core/update-check
 */

/** How this copy was installed (read off the profile manifest's spec string). */
export type UpdateInstallMode = 'npm' | 'github' | 'local' | 'unknown'

/**
 * Classify one profile-manifest dependency spec. `link:` is local development;
 * `github:` and tarball URLs are source installs (their update path is the
 * GitHub re-add); anything else version-shaped is an npm install.
 * @param spec - the raw `dependencies[name]` string, or undefined when unread.
 * @returns the install mode (`unknown` when the spec is missing).
 */
export function classifyInstallSpec(spec: string | undefined): UpdateInstallMode {
  if (spec === undefined || spec === '') return 'unknown'
  if (spec.startsWith('link:')) return 'local'
  if (spec.startsWith('github:')) return 'github'
  if (spec.startsWith('https:') || spec.startsWith('http:')) return 'github'
  return 'npm'
}

/**
 * Parse the numeric `x.y.z` prefix of a version string. Missing segments
 * default to 0; pre-release/build suffixes are ignored (a suffix never makes
 * a version newer — the numeric triple decides).
 * @param version - the version string.
 * @returns the `[major, minor, patch]` triple.
 */
export function parseVersionParts(version: string): [number, number, number] {
  const match = version.trim().match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
  if (match === null) return [0, 0, 0]
  const num = (segment: string | undefined): number =>
    segment === undefined ? 0 : Number(segment)
  return [num(match[1]), num(match[2]), num(match[3])]
}

/**
 * Compare two version strings by their numeric triples.
 * @param a - first version.
 * @param b - second version.
 * @returns -1 when a < b, 0 when equal, 1 when a > b.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = parseVersionParts(a)
  const pb = parseVersionParts(b)
  const pairs: Array<[number, number]> = [[pa[0], pb[0]], [pa[1], pb[1]], [pa[2], pb[2]]]
  for (const [x, y] of pairs) {
    if (x < y) return -1
    if (x > y) return 1
  }
  return 0
}

/**
 * Whether `latest` is strictly newer than `current`.
 * @param latest - the published latest version.
 * @param current - the running copy's version.
 * @returns true only when latest is newer (equal or older reads as up to date).
 */
export function isNewerVersion(latest: string, current: string): boolean {
  return compareVersions(latest, current) > 0
}

/**
 * Derive the `github:Owner/Repo` install spec from the package repository
 * URL. The account is never repeated in code — it is read live from the
 * manifest, so a fork or rename keeps working.
 * @param url - the package.json `repository.url` value.
 * @returns the `github:` spec, or undefined when the URL is not a GitHub one.
 */
export function githubSpecOfRepositoryUrl(url: string): string | undefined {
  const match = url.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/)
  if (match === null || match[1] === undefined) return undefined
  return `github:${match[1]}`
}

/** One copyable update step (the restart note is shared copy, see locales). */
export interface UpdateAction {
  /** Which install grammar this command belongs to (selects the hint copy). */
  kind: 'npm' | 'github' | 'local'
  /** The exact single-line terminal command. */
  command: string
}

/**
 * Build the update commands for one install mode. Local checkouts pull and
 * rebuild in place; source installs re-add the GitHub spec; npm installs
 * re-add the package at latest; an unknown mode shows both remote commands
 * rather than guessing.
 * @param mode - the classified install mode.
 * @param packageName - the package name (the npm command's subject).
 * @param githubSpec - the `github:` spec (absent when the repo URL is unknown).
 * @returns the copyable actions in display order.
 */
export function updateActionsFor(
  mode: UpdateInstallMode,
  packageName: string,
  githubSpec: string | undefined,
): UpdateAction[] {
  const npm: UpdateAction = {
    kind: 'npm',
    command: `dsh plugin --profile web add ${packageName}@latest`,
  }
  if (mode === 'local') {
    return [{ kind: 'local', command: 'git pull && pnpm build' }]
  }
  if (mode === 'github') {
    return githubSpec !== undefined
      ? [{ kind: 'github', command: `dsh plugin --profile web add ${githubSpec}` }]
      : [npm]
  }
  if (mode === 'npm') return [npm]
  return githubSpec !== undefined
    ? [npm, { kind: 'github', command: `dsh plugin --profile web add ${githubSpec}` }]
    : [npm]
}

/** The local checkout's git state (only meaningful for `local` installs). */
export interface UpdateGitStatus {
  /** Full local HEAD SHA. */
  head: string
  /** Full `origin/main` SHA from `ls-remote` (absent when unreachable). */
  remoteHead?: string
  /** Whether the worktree has uncommitted changes. */
  dirty: boolean
}

/**
 * Whether the local checkout trails the remote (unpublished commits exist).
 * A missing remote reading is never evidence — it reads as "not behind".
 * @param git - the checkout status.
 * @returns true only when both SHAs are known and differ.
 */
export function isGitBehind(git: UpdateGitStatus): boolean {
  return git.remoteHead !== undefined && git.remoteHead !== ''
    && git.head !== '' && git.remoteHead !== git.head
}

/**
 * Shorten a full SHA for display (the full value still travels the wire).
 * @param sha - the full SHA.
 * @returns the first 7 characters (or the input when shorter).
 */
export function shortSha(sha: string): string {
  return sha.length <= 7 ? sha : sha.slice(0, 7)
}
