/**
 * Browser readers for the header's check-for-updates button: the installed
 * source (version + install mode + the plan that updates it) from the host
 * route, the published latest from the public npm registry, and the one action
 * that applies the plan.
 *
 * Every failure degrades to `undefined` (the button reads it as "check
 * failed, retry inline"), so a dropped line, a blocked registry, or an old
 * host without the route can never take the board down — the same discipline
 * as the board transport's bounded fetch.
 */
import type { UpdateGitStatus, UpdateInstallMode, UpdatePlan } from '../core/update-check.ts';
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
    /** The profile carrying this copy (absent when the host cannot read it). */
    profile?: string;
    /** The profile belongs to a packaged application, which installs through its own runtime. */
    appManaged: boolean;
    /** The `github:` install spec (absent when the repo URL is not GitHub). */
    githubSpec?: string;
    /** How to update this copy, and who applies it. */
    plan: UpdatePlan;
    /** Local-checkout git state (only for `local` installs). */
    git?: UpdateGitStatus;
}
/** What one applied update did, as the host reported it. */
export interface UpdateApplyResult {
    ok: boolean;
    outcome?: 'applied' | 'restart-required' | 'rebuilt';
    version?: string;
    output?: string;
    error?: 'unsupported' | 'unavailable' | 'dirty' | 'tool-missing' | 'timeout' | 'failed';
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
export declare function applyUpdate(timeoutMs?: number): Promise<UpdateApplyResult | undefined>;
/**
 * Read the published latest from the public npm registry packument
 * (`dist-tags.latest` plus its publish instant from `time`).
 * @param packageName - the scoped package name (slash-encoded for the URL).
 * @param timeoutMs - per-request bound (default 15s).
 * @returns the latest version, or undefined when unreadable.
 */
export declare function fetchNpmLatest(packageName: string, timeoutMs?: number): Promise<NpmLatest | undefined>;
