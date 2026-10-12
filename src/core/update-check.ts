/**
 * Update-check grammar for the task-board plugin: how the installed copy
 * compares against the published latest, how it was installed, and what
 * bringing it up to date runs. Pure logic — no DOM, no fetch, no Node APIs —
 * so the host route and the browser half share it without a platform seam.
 *
 * The plan names WHO applies the update instead of assuming it: a package
 * install is handed to the installation's own service, a `link:` checkout is
 * refreshed where it lives, and a copy whose install mode cannot be read gets
 * no plan at all — never a guessed command.
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

/** One command an update runs, as data rather than as a line of text. */
export interface UpdateStep {
  /** The executable or package-manager name. */
  command: string
  /** Its arguments, in order. */
  args: string[]
}

/** Where an update is applied: through a package installation, in the checkout, or by hand only. */
export type UpdateApplyKind = 'package' | 'checkout' | 'none'

/**
 * How this copy reaches the newest upstream, and who does it.
 *
 * The steps are ONE list: they are what the host runs when it applies the
 * update, and the line a reader pastes into a terminal is generated from them.
 * Rendering a second line by hand is how the copy and the behavior drift apart.
 */
export interface UpdatePlan {
  /** The install mode the plan was built from. */
  mode: UpdateInstallMode
  /** The profile carrying this copy (absent when the running profile is unreadable). */
  profile?: string
  /** The profile belongs to a packaged application, which installs through its own runtime. */
  appManaged: boolean
  /** The spec a package installation re-adds (npm and github modes only). */
  packageSpec?: string
  /** Where the host applies the update itself. */
  apply: UpdateApplyKind
  /** What this update runs: the host's steps, and the equivalent terminal line. */
  steps: UpdateStep[]
}

/**
 * Render steps as the one line a reader pastes into a terminal.
 * @param steps - the steps in order.
 * @returns the `&&`-joined command line (empty for no steps).
 */
export function commandLineOf(steps: readonly UpdateStep[]): string {
  return steps.map(step => [step.command, ...step.args].join(' ')).join(' && ')
}

/** Every fact the plan rules read; each one describes the copy that is running. */
export interface UpdatePlanInput {
  mode: UpdateInstallMode
  packageName: string
  /** The `github:` spec (absent when the repository URL is not GitHub). */
  githubSpec?: string
  /** The profile carrying this copy (absent when unreadable). */
  profile?: string
  /** The profile belongs to a packaged application. */
  appManaged: boolean
  /** The host carries the installation service that applies a package update. */
  canInstall: boolean
  /** The steps a checkout refresh runs (local mode; absent keeps the documented pair). */
  checkoutSteps?: readonly UpdateStep[]
}

/**
 * The steps a reader would run by hand for one package spec. A packaged
 * application manages its profile itself — its CLI refuses that profile — and
 * the CLI always requires `--profile`, so a missing profile name yields no
 * command rather than a line that cannot work.
 * @param appManaged - whether a packaged application owns the profile.
 * @param profile - the profile name.
 * @param spec - the package spec to re-add.
 * @returns the steps (empty when no terminal command applies).
 */
function terminalStepsFor(appManaged: boolean, profile: string | undefined, spec: string): UpdateStep[] {
  if (appManaged || profile === undefined || profile === '') return []
  return [{ command: 'dsh', args: ['plugin', '--profile', profile, 'add', spec] }]
}

/**
 * Build the update plan for the running copy. Local checkouts pull and rebuild
 * in place; source installs re-add the GitHub spec; npm installs re-add the
 * package at latest; an unreadable mode gets no plan at all — guessing an
 * install mode is how a reader is told to run a command that cannot work.
 * @param input - the facts about the running copy.
 * @returns the plan.
 */
export function updatePlanFor(input: UpdatePlanInput): UpdatePlan {
  const base = {
    mode: input.mode,
    ...(input.profile !== undefined && input.profile !== '' ? { profile: input.profile } : {}),
    appManaged: input.appManaged,
  }
  if (input.mode === 'local') {
    return {
      ...base,
      apply: 'checkout',
      steps: [...(input.checkoutSteps ?? [
        { command: 'git', args: ['pull', '--ff-only'] },
        { command: 'pnpm', args: ['run', 'build'] },
      ])],
    }
  }
  const spec = input.mode === 'npm'
    ? `${input.packageName}@latest`
    : input.mode === 'github'
      ? input.githubSpec
      : undefined
  if (spec === undefined) return { ...base, apply: 'none', steps: [] }
  return {
    ...base,
    packageSpec: spec,
    apply: input.canInstall ? 'package' : 'none',
    steps: terminalStepsFor(input.appManaged, input.profile, spec),
  }
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
