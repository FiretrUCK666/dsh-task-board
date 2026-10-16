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
 * Classify one profile-manifest dependency spec. The three routes the plugin
 * documents are what this reads, and nothing is guessed into them:
 *
 * - `link:` is local development: the code being run is a checkout, and the
 *   update refreshes it in place.
 * - a `github:`/`gitlab:`/`bitbucket:`/`gist:` spec, ANY `git+…` spec, or an
 *   `http(s)://` URL is a SOURCE install: what was installed is a repository or
 *   a tarball named by that spec, and re-adding that same spec is its update.
 *   (A URL is not assumed to be GitHub — the plan re-adds the recorded spec, so
 *   a private tarball URL updates from itself.)
 * - anything else is a registry install, EXCEPT the specs that name a local
 *   artifact (`file:`, `portal:`, `workspace:`) — those are not in the registry
 *   and not a checkout either, so no route here can update them. They read as
 *   `unknown` on purpose: the page then says it has no command for this install
 *   instead of offering `@latest`, which would replace someone's local build
 *   with the published one.
 * @param spec - the raw `dependencies[name]` string, or undefined when unread.
 * @returns the install mode (`unknown` when the spec is missing or unrouted).
 */
export function classifyInstallSpec(spec: string | undefined): UpdateInstallMode {
  if (spec === undefined || spec === '') return 'unknown'
  const s = spec.trim()
  if (s.startsWith('link:')) return 'local'
  if (/^(?:github|gitlab|bitbucket|gist):/.test(s)) return 'github'
  if (s.startsWith('git+') || s.startsWith('git@') || /\.git(?:#|$)/.test(s)) return 'github'
  if (/^https?:/.test(s)) return 'github'
  if (/^(?:file|portal|workspace):/.test(s)) return 'unknown'
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
  /** The package this plan is about (the subject a reinstall uninstalls). */
  packageName?: string
  /** The profile carrying this copy (absent when the running profile is unreadable). */
  profile?: string
  /** The profile belongs to a packaged application, which installs through its own runtime. */
  appManaged: boolean
  /** The spec a package installation re-adds (npm and github modes only). */
  packageSpec?: string
  /** Where the host applies the update itself. */
  apply: UpdateApplyKind
  /**
   * A package update must uninstall the running copy before installing the new
   * one. The installation service refuses to install over an installed package
   * exactly when HMR is live, and refuses to REMOVE a running bundle exactly
   * when it is not — so which of the two happens is decided by the host, and
   * the page reads it here rather than describing a step it cannot know.
   */
  reinstall?: boolean
  /** What this update runs: the host's steps, and the equivalent terminal line. */
  steps: UpdateStep[]
}

/**
 * Render steps as the one line a reader pastes into a terminal.
 * @param steps - the steps in order.
 * @returns the `&&`-joined command line (empty for no steps).
 */
export function commandLineOf(steps: readonly UpdateStep[]): string {
  return commandWordsOf(steps).join(' ')
}

/**
 * The same command as its individual words, one entry per word.
 *
 * A command is a line to retype or paste, and the page must break it the way a
 * reader would: between words. Left to itself the browser also breaks after a
 * hyphen, so `@scope/dsh-task-board@latest` renders as `@scope/dsh-task-` /
 * `board@latest` whenever the line happens to end there — which reads as two
 * words in a string that has to be typed exactly. The words are what the page
 * puts in unbreakable spans, and {@link commandLineOf} is this same list joined
 * up, so the copyable line and the drawn line cannot drift apart.
 * @param steps - the steps in order.
 * @returns the words, with `&&` as its own word between steps.
 */
export function commandWordsOf(steps: readonly UpdateStep[]): string[] {
  return steps.flatMap((step, index) => [
    ...(index === 0 ? [] : ['&&']),
    step.command,
    ...step.args,
  ])
}

/** Every fact the plan rules read; each one describes the copy that is running. */
export interface UpdatePlanInput {
  mode: UpdateInstallMode
  packageName: string
  /** The `github:` spec (absent when the repository URL is not GitHub). */
  githubSpec?: string
  /** What the profile manifest actually declares for this package (when read). */
  recordedSpec?: string
  /** The profile carrying this copy (absent when unreadable). */
  profile?: string
  /** The profile belongs to a packaged application. */
  appManaged: boolean
  /** The host carries the installation service that applies a package update. */
  canInstall: boolean
  /** That service will uninstall the running copy first (it refuses to install over one). */
  reinstall?: boolean
  /** The steps a checkout refresh runs (local mode; absent keeps the documented pair). */
  checkoutSteps?: readonly UpdateStep[]
}

/**
 * The steps a reader would run by hand for one package spec. The CLI always
 * requires `--profile`, so a missing profile name yields no command rather than
 * a line that cannot work.
 *
 * A packaged application's profile gets no command either, and the reason is
 * narrower than "its CLI refuses that profile": the CLI has TWO shims. The one
 * the npm package installs rejects this profile name outright
 * (`profile "desktop" is managed exclusively by the Electron application`),
 * while the application's own shim — the one its menu puts on PATH — is allowed
 * through. A plan cannot see which `dsh` a reader has, so a line that works for
 * one of them and fails for the other is not offered at all: the page names the
 * route that always works (the application's own plugin page) instead.
 * @param appManaged - whether a packaged application owns the profile.
 * @param profile - the profile name.
 * @param spec - the package spec to re-add.
 * @returns the steps (empty when no terminal command applies).
 */
function terminalStepsFor(
  appManaged: boolean,
  profile: string | undefined,
  spec: string,
): UpdateStep[] {
  if (appManaged || profile === undefined || profile === '') return []
  return [{ command: 'dsh', args: ['plugin', '--profile', profile, 'add', spec] }]
}

/**
 * The spec to re-add when updating a SOURCE install, read from what the profile
 * actually recorded.
 *
 * The profile's own declaration wins over the spec derived from the package's
 * `repository` field: a fork, a mirror or a tarball URL is what that reader
 * installed, and re-pointing the update at the canonical repository would swap
 * their package for a different one under the same name. A `#fragment` is
 * dropped — it names ONE commit, so re-adding it would reinstall precisely the
 * code that is already there and call it an update.
 * @param recorded - the profile manifest's spec string, when it was read.
 * @returns the spec to re-add, or undefined when the recorded one is not a source spec.
 */
export function sourceSpecOf(recorded: string | undefined): string | undefined {
  if (recorded === undefined) return undefined
  const withoutFragment = (recorded.split('#')[0] ?? '').trim()
  if (withoutFragment === '') return undefined
  return classifyInstallSpec(withoutFragment) === 'github' ? withoutFragment : undefined
}

/**
 * Build the update plan for the running copy. Local checkouts pull and rebuild
 * in place; source installs re-add the spec the profile recorded (see
 * {@link sourceSpecOf}); npm installs re-add the package at latest; an
 * unreadable or unrouted mode gets no plan at all — guessing an install mode is
 * how a reader is told to run a command that cannot work.
 * @param input - the facts about the running copy.
 * @returns the plan.
 */
export function updatePlanFor(input: UpdatePlanInput): UpdatePlan {
  const base = {
    mode: input.mode,
    ...(input.packageName !== '' ? { packageName: input.packageName } : {}),
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
      ? sourceSpecOf(input.recordedSpec) ?? input.githubSpec
      : undefined
  if (spec === undefined) return { ...base, apply: 'none', steps: [] }
  const applies = input.canInstall
  return {
    ...base,
    packageSpec: spec,
    apply: applies ? 'package' : 'none',
    ...(applies && input.reinstall === true ? { reinstall: true } : {}),
    steps: terminalStepsFor(input.appManaged, input.profile, spec),
  }
}

/**
 * The newest upstream this copy could move to, as the host read it. One shape
 * for every install mode: a registry answers with a version and which registry
 * said so, a repository answers with the version its default branch declares.
 * Absent means the host could not read it — the page reports that as "cannot
 * tell", never as "already newest".
 */
export interface UpdateLatestView {
  /** The newest version found. */
  version: string
  /** That version's publish instant (registry answers only). */
  publishedAt?: string
  /** The registry that answered (registry answers only). */
  registry?: string
  /** Where the answer came from. */
  source: 'registry' | 'repository'
}

/**
 * The registries to ask when the host carries no installation service to ask
 * instead. A degraded fallback on purpose: the profile's own registry plan is
 * the authority (it knows mirrors, private sources and proxies), and this pair
 * is the public default that any Node installation already reaches. Reading
 * only the first of them is what made a mirror user's check fail outright.
 */
export const PUBLIC_REGISTRIES = ['https://registry.npmjs.org/', 'https://registry.npmmirror.com/']

/**
 * The packument URL for one package on one registry.
 * @param registry - the registry base URL, with or without a trailing slash.
 * @param packageName - the package name (a scope's slash is encoded).
 * @returns the URL to fetch.
 */
export function packumentUrl(registry: string, packageName: string): string {
  const base = registry.endsWith('/') ? registry : `${registry}/`
  return `${base}${packageName.replace('/', '%2F')}`
}

/**
 * Read the published latest out of one registry's packument. A document that
 * does not carry a `dist-tags.latest` string is not an answer, so it reads as
 * undefined and the caller asks the next registry.
 * @param body - the parsed packument.
 * @returns the version and its publish instant, or undefined.
 */
export function latestFromPackument(body: unknown): { version: string; publishedAt?: string } | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const packument = body as { 'dist-tags'?: { latest?: unknown }; time?: Record<string, unknown> }
  const latest = packument['dist-tags']?.latest
  if (typeof latest !== 'string' || latest === '') return undefined
  const published = packument.time?.[latest]
  return {
    version: latest,
    ...(typeof published === 'string' && published !== '' ? { publishedAt: published } : {}),
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
