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
import type { UpdateGitStatus, UpdateInstallMode } from '../core/update-check.ts';
/** The bundle's own package identity (the host-unreachable fallback). */
export declare const BUNDLED_PACKAGE_NAME: string;
/** The bundle's own version (the host-unreachable comparison baseline). */
export declare const BUNDLED_VERSION: string;
/** The installed-source view the host update route serves. */
export interface UpdateSourceView {
    /** Package name (the npm update command's subject). */
    packageName: string;
    /** The running copy's version. */
    version: string;
    /** Raw profile-manifest declaration (absent when the host cannot read it). */
    spec?: string;
    /** Classified install mode. */
    mode: UpdateInstallMode;
    /** The `github:` install spec (absent when the repo URL is not GitHub). */
    githubSpec?: string;
    /** Local-checkout git state (only for `local` installs). */
    git?: UpdateGitStatus;
}
/** The published latest read off the npm registry. */
export interface NpmLatest {
    /** The `dist-tags.latest` version. */
    version: string;
    /** The registry's publish instant for that version, when advertised. */
    publishedAt?: string;
}
/**
 * Read the installed source through the host route. An old host without the
 * route answers 404 (or hangs), which degrades to undefined like any other
 * failure — the button then compares the bundle version against npm with an
 * unknown install mode.
 * @param timeoutMs - per-request bound (default 15s, the transport's budget).
 * @returns the source view, or undefined when unreadable.
 */
export declare function fetchUpdateSource(timeoutMs?: number): Promise<UpdateSourceView | undefined>;
/**
 * Read the published latest from the public npm registry packument
 * (`dist-tags.latest` plus its publish instant from `time`).
 * @param packageName - the scoped package name (slash-encoded for the URL).
 * @param timeoutMs - per-request bound (default 15s).
 * @returns the latest version, or undefined when unreadable.
 */
export declare function fetchNpmLatest(packageName: string, timeoutMs?: number): Promise<NpmLatest | undefined>;
