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
export type UpdateInstallMode = 'npm' | 'github' | 'local' | 'unknown';
/**
 * Classify one profile-manifest dependency spec. `link:` is local development;
 * `github:` and tarball URLs are source installs (their update path is the
 * GitHub re-add); anything else version-shaped is an npm install.
 * @param spec - the raw `dependencies[name]` string, or undefined when unread.
 * @returns the install mode (`unknown` when the spec is missing).
 */
export declare function classifyInstallSpec(spec: string | undefined): UpdateInstallMode;
/**
 * Parse the numeric `x.y.z` prefix of a version string. Missing segments
 * default to 0; pre-release/build suffixes are ignored (a suffix never makes
 * a version newer — the numeric triple decides).
 * @param version - the version string.
 * @returns the `[major, minor, patch]` triple.
 */
export declare function parseVersionParts(version: string): [number, number, number];
/**
 * Compare two version strings by their numeric triples.
 * @param a - first version.
 * @param b - second version.
 * @returns -1 when a < b, 0 when equal, 1 when a > b.
 */
export declare function compareVersions(a: string, b: string): -1 | 0 | 1;
/**
 * Whether `latest` is strictly newer than `current`.
 * @param latest - the published latest version.
 * @param current - the running copy's version.
 * @returns true only when latest is newer (equal or older reads as up to date).
 */
export declare function isNewerVersion(latest: string, current: string): boolean;
/**
 * Derive the `github:Owner/Repo` install spec from the package repository
 * URL. The account is never repeated in code — it is read live from the
 * manifest, so a fork or rename keeps working.
 * @param url - the package.json `repository.url` value.
 * @returns the `github:` spec, or undefined when the URL is not a GitHub one.
 */
export declare function githubSpecOfRepositoryUrl(url: string): string | undefined;
/** One copyable update step (the restart note is shared copy, see locales). */
export interface UpdateAction {
    /** Which install grammar this command belongs to (selects the hint copy). */
    kind: 'npm' | 'github' | 'local';
    /** The exact single-line terminal command. */
    command: string;
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
export declare function updateActionsFor(mode: UpdateInstallMode, packageName: string, githubSpec: string | undefined): UpdateAction[];
/** The local checkout's git state (only meaningful for `local` installs). */
export interface UpdateGitStatus {
    /** Full local HEAD SHA. */
    head: string;
    /** Full `origin/main` SHA from `ls-remote` (absent when unreachable). */
    remoteHead?: string;
    /** Whether the worktree has uncommitted changes. */
    dirty: boolean;
}
/**
 * Whether the local checkout trails the remote (unpublished commits exist).
 * A missing remote reading is never evidence — it reads as "not behind".
 * @param git - the checkout status.
 * @returns true only when both SHAs are known and differ.
 */
export declare function isGitBehind(git: UpdateGitStatus): boolean;
/**
 * Shorten a full SHA for display (the full value still travels the wire).
 * @param sha - the full SHA.
 * @returns the first 7 characters (or the input when shorter).
 */
export declare function shortSha(sha: string): string;
