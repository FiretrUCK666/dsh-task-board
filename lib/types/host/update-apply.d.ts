/**
 * Update application for the task-board plugin: the one place that changes an
 * installed copy, and the only place that says how it went.
 *
 * The plugin never rewrites its own files by hand, and it never updates a
 * profile by name. Two paths exist, and each one goes through the machinery
 * that owns that copy:
 *
 * - a package install (npm / github) is handed to DSH's installation service,
 *   which takes the profile's writer lock, runs the installation's own package
 *   manager, restores the previous files when a run fails, and reports whether
 *   the change applied live or needs a restart;
 * - a `link:` checkout is refreshed where it lives — pull, then the checkout's
 *   own build script — because no package manager owns those files.
 *
 * Every effect is injected (`installer`, `runner`, `readVersion`), so the
 * decision logic is unit-tested without a process, a registry or a server.
 * @module dsh-task-board/host/update-apply
 */
import type { UpdatePlan, UpdateStep } from '../core/update-check.ts';
/** One command's outcome, in the vocabulary the update reports in. */
export interface CommandOutcome {
    /** The exit code, or null when the command never started. */
    code: number | null;
    /** What it printed (bounded). */
    output: string;
    /** The command was killed at its deadline. */
    timedOut?: boolean;
    /** No such command exists on this machine. */
    missing?: boolean;
}
/** What one installation hands back, read off DSH's own change record. */
export interface PackageInstallRecord {
    /** `applied` and `restart-required` are terminal successes; `failed` is not. */
    application?: unknown;
    /** The installed bundle's manifest version, when the record carries one. */
    version?: unknown;
    error?: {
        code?: unknown;
        diagnostic?: unknown;
    };
    packageResult?: {
        output?: unknown;
        exitCode?: unknown;
    };
}
/** What one uninstallation hands back (the same record, minus a version). */
export interface PackageRemoveRecord {
    application?: unknown;
    error?: {
        code?: unknown;
        diagnostic?: unknown;
    };
    packageResult?: {
        output?: unknown;
        exitCode?: unknown;
    };
}
/** The installation service, read by name (absent is a supported deployment). */
export interface PackageInstaller {
    installBundle(spec: string, options?: Record<string, unknown>): Promise<PackageInstallRecord>;
    /**
     * Unload and remove a profile-owned bundle. Absent on a host whose
     * installation service predates it — such a host reports `unavailable`
     * rather than being handed a plan it cannot carry out.
     */
    removeBundle?(name: string): Promise<PackageRemoveRecord>;
}
/** Run one step; the real implementation is {@link spawnStep}. */
export type UpdateRunner = (step: UpdateStep, options: {
    cwd: string;
    shell: boolean;
    timeoutMs: number;
}) => Promise<CommandOutcome>;
/** The checkout a `link:` install points at, and what refreshing it needs. */
export interface CheckoutUpdate {
    /** The directory the steps run in. */
    dir: string;
    /** Uncommitted changes: refreshing over them would mix two states. */
    dirty: boolean;
}
/**
 * How an applied update landed.
 *
 * `unchanged` is the case the installation service cannot report: it answers
 * with what the package manager did, and a package manager asked for "the
 * latest" that resolves to the version already installed exits successfully
 * having done nothing at all. A package update's whole subject is its version,
 * so a run that left the version alone is not an update — and reporting one is
 * how a page tells a reader they are current when the resolution was merely
 * held back (an installer's release-age policy does exactly that to a version
 * that was published minutes ago). Only `npm` mode claims it: a branch install
 * can move without any version changing.
 */
export type UpdateApplyOutcome = 'applied' | 'restart-required' | 'rebuilt' | 'unchanged';
/** Why an update could not be applied (a stable code the page turns into copy). */
export type UpdateApplyError = 
/** This install mode has no host-side update path at all. */
'unsupported'
/** The update path exists but this host is missing what runs it. */
 | 'unavailable'
/** The checkout has uncommitted changes. */
 | 'dirty'
/** A command the update needs is not installed. */
 | 'tool-missing' | 'timeout' | 'failed';
/** What applying an update did. */
export interface UpdateApplyResult {
    ok: boolean;
    /** Present when `ok`: how the change landed. */
    outcome?: UpdateApplyOutcome;
    /** The version now on disk, when it could be read back. */
    version?: string;
    /** The tail of what the update printed, kept for failures. */
    output?: string;
    /** Present when not `ok`: why it did not happen. */
    error?: UpdateApplyError;
}
/** Everything applying an update reads or touches. */
export interface UpdateApplyDeps {
    /** The plan built from the running copy's own facts. */
    plan: UpdatePlan;
    /** The installation service, when the host carries it. */
    installer?: PackageInstaller;
    /** Runs one checkout step. */
    runner: UpdateRunner;
    /** The checkout facts, for plans that refresh one. */
    checkout?: CheckoutUpdate;
    /** Reads the version now on disk (the proof an update landed). */
    readVersion: () => string | undefined;
    /** Per-run deadline; defaults to {@link RUN_TIMEOUT_MS}. */
    timeoutMs?: number;
}
/**
 * Apply one update plan and report how it went.
 * @param deps - the plan and the injected effects.
 * @returns the result (`ok` is the only thing callers branch on).
 */
export declare function applyUpdate(deps: UpdateApplyDeps): Promise<UpdateApplyResult>;
/**
 * Run one step and collect its output.
 *
 * `shell` is on for checkout steps on purpose: on Windows the package-manager
 * entry points are `.cmd` shims, which Node refuses to spawn directly. The
 * command line is assembled from this plugin's own table plus the checkout's
 * script name — never from user data — so there is no quoting surface to get
 * wrong; the working directory travels as an option, not inside the line.
 *
 * The deadline kills the process this call started. A step that spawns its own
 * children (a build tool) can outlive it; the caller still reports the timeout,
 * so the run is never silently assumed to have finished.
 * @param step - the command and its arguments.
 * @param options - working directory, shell mode and deadline.
 * @returns the outcome (a command that never started reports `missing`).
 */
export declare function spawnStep(step: UpdateStep, options: {
    cwd: string;
    shell: boolean;
    timeoutMs: number;
}): Promise<CommandOutcome>;
