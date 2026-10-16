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

import { spawn } from 'node:child_process'
import type { UpdatePlan, UpdateStep } from '../core/update-check.ts'

/** How long one update run may take before it is killed (milliseconds). */
const RUN_TIMEOUT_MS = 600_000

/**
 * Deadlines for the steps that are not the build. Reaching a remote needs a
 * bound of its own: a pull that wants credentials must fail long before a
 * compile does, and a person watching a dialog deserves the sooner answer.
 */
const STEP_TIMEOUT_MS: Record<string, number> = { git: 120_000 }

/** How much of a run's output is kept (and shipped to the page that asked). */
const OUTPUT_LIMIT = 4000

/** One command's outcome, in the vocabulary the update reports in. */
export interface CommandOutcome {
  /** The exit code, or null when the command never started. */
  code: number | null
  /** What it printed (bounded). */
  output: string
  /** The command was killed at its deadline. */
  timedOut?: boolean
  /** No such command exists on this machine. */
  missing?: boolean
}

/** What one installation hands back, read off DSH's own change record. */
export interface PackageInstallRecord {
  /** `applied` and `restart-required` are terminal successes; `failed` is not. */
  application?: unknown
  /** The installed bundle's manifest version, when the record carries one. */
  version?: unknown
  error?: { code?: unknown; diagnostic?: unknown }
  packageResult?: { output?: unknown; exitCode?: unknown }
}

/** What one uninstallation hands back (the same record, minus a version). */
export interface PackageRemoveRecord {
  application?: unknown
  error?: { code?: unknown; diagnostic?: unknown }
  packageResult?: { output?: unknown; exitCode?: unknown }
}

/** The installation service, read by name (absent is a supported deployment). */
export interface PackageInstaller {
  installBundle(spec: string, options?: Record<string, unknown>): Promise<PackageInstallRecord>
  /**
   * Unload and remove a profile-owned bundle. Absent on a host whose
   * installation service predates it — such a host reports `unavailable`
   * rather than being handed a plan it cannot carry out.
   */
  removeBundle?(name: string): Promise<PackageRemoveRecord>
}

/** Run one step; the real implementation is {@link spawnStep}. */
export type UpdateRunner = (
  step: UpdateStep,
  options: { cwd: string; shell: boolean; timeoutMs: number },
) => Promise<CommandOutcome>

/** The checkout a `link:` install points at, and what refreshing it needs. */
export interface CheckoutUpdate {
  /** The directory the steps run in. */
  dir: string
  /** Uncommitted changes: refreshing over them would mix two states. */
  dirty: boolean
}

/** How an applied update landed. */
export type UpdateApplyOutcome = 'applied' | 'restart-required' | 'rebuilt'

/** Why an update could not be applied (a stable code the page turns into copy). */
export type UpdateApplyError =
  /** This install mode has no host-side update path at all. */
  | 'unsupported'
  /** The update path exists but this host is missing what runs it. */
  | 'unavailable'
  /** The checkout has uncommitted changes. */
  | 'dirty'
  /** A command the update needs is not installed. */
  | 'tool-missing'
  | 'timeout'
  | 'failed'

/** What applying an update did. */
export interface UpdateApplyResult {
  ok: boolean
  /** Present when `ok`: how the change landed. */
  outcome?: UpdateApplyOutcome
  /** The version now on disk, when it could be read back. */
  version?: string
  /** The tail of what the update printed, kept for failures. */
  output?: string
  /** Present when not `ok`: why it did not happen. */
  error?: UpdateApplyError
}

/** Everything applying an update reads or touches. */
export interface UpdateApplyDeps {
  /** The plan built from the running copy's own facts. */
  plan: UpdatePlan
  /** The installation service, when the host carries it. */
  installer?: PackageInstaller
  /** Runs one checkout step. */
  runner: UpdateRunner
  /** The checkout facts, for plans that refresh one. */
  checkout?: CheckoutUpdate
  /** Reads the version now on disk (the proof an update landed). */
  readVersion: () => string | undefined
  /** Per-run deadline; defaults to {@link RUN_TIMEOUT_MS}. */
  timeoutMs?: number
}

/**
 * Keep the tail of one run's output: the last lines carry the failure, and a
 * whole pnpm log is not something a dialog should hold.
 * @param text - the accumulated output.
 * @param limit - how many characters to keep.
 * @returns the trimmed tail.
 */
function tailText(text: string, limit = OUTPUT_LIMIT): string {
  const trimmed = text.trim()
  return trimmed.length <= limit ? trimmed : `...${trimmed.slice(trimmed.length - limit)}`
}

/** Read a string field off a record that may not carry one. */
function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * Uninstall the running copy, the first half of a reinstall.
 *
 * Everything that can go wrong is folded into one answer here, because the
 * service reports its refusals two different ways: an unremovable bundle comes
 * back as a failure code in the record, while a package-manager run that exits
 * nonzero is thrown as an error whose message is the run's own output.
 * @param installer - the installation service.
 * @param name - the package to uninstall.
 * @returns the failure, or undefined when the removal went through.
 */
async function removeInstalled(
  installer: PackageInstaller,
  name: string,
): Promise<UpdateApplyResult | undefined> {
  const remove = installer.removeBundle?.bind(installer)
  if (remove === undefined) return { ok: false, error: 'unavailable' }
  let record: PackageRemoveRecord
  try {
    record = await remove(name)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: 'failed', output: tailText(`remove ${name}: ${message}`) }
  }
  const output = stringOf(record?.error?.diagnostic) ?? stringOf(record?.packageResult?.output)
  const code = record?.error?.code
  const exit = record?.packageResult?.exitCode
  if (code !== undefined || record?.application === 'failed' || (typeof exit === 'number' && exit !== 0)) {
    const reason = code !== undefined ? `remove: ${String(code)}` : `remove: exit ${String(exit ?? 'none')}`
    return {
      ok: false,
      error: 'failed',
      output: tailText(`${reason}${output !== undefined ? `\n${output}` : ''}`),
    }
  }
  return undefined
}

/**
 * Apply a package update through the installation service.
 *
 * A plan that says `reinstall` uninstalls first: that is the only order the
 * service accepts on an HMR host, which refuses to install over a package that
 * is already there so that the old version's plugin stops before its files are
 * replaced. A plan without it installs straight over the running copy, which is
 * what a host without HMR accepts and reports as `restart-required`.
 * @param plan - the plan whose package is reinstalled and whose spec re-added.
 * @param installer - the installation service.
 * @param readVersion - reads the version now on disk.
 * @returns the result.
 */
async function applyPackage(
  plan: UpdatePlan,
  installer: PackageInstaller | undefined,
  readVersion: () => string | undefined,
): Promise<UpdateApplyResult> {
  if (installer === undefined) return { ok: false, error: 'unavailable' }
  const spec = plan.packageSpec
  if (spec === undefined) return { ok: false, error: 'unsupported' }
  const name = plan.packageName
  if (plan.reinstall === true) {
    if (name === undefined || name === '') return { ok: false, error: 'unsupported' }
    const refused = await removeInstalled(installer, name)
    if (refused !== undefined) return refused
  }
  let record: PackageInstallRecord
  try {
    record = await installer.installBundle(spec, { enabled: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: 'failed', output: tailText(message) }
  }
  const output = stringOf(record.packageResult?.output) ?? stringOf(record.error?.diagnostic)
  if (record.application === 'failed') {
    return { ok: false, error: 'failed', ...(output !== undefined ? { output: tailText(output) } : {}) }
  }
  if (record.application !== 'applied' && record.application !== 'restart-required') {
    // Anything else (cancelled, overridden, a value this version does not know)
    // is reported as it is: claiming success for it would be a guess.
    const raw = stringOf(record.application) ?? '(none)'
    return {
      ok: false,
      error: 'failed',
      output: tailText(`application: ${raw}${output !== undefined ? `\n${output}` : ''}`),
    }
  }
  const version = readVersion() ?? stringOf(record.version)
  return {
    ok: true,
    outcome: record.application,
    ...(version !== undefined ? { version } : {}),
  }
}

/**
 * Apply a checkout refresh: pull, then the checkout's own build.
 * @param plan - the plan whose steps run in order.
 * @param deps - the runner, the checkout facts and the version reader.
 * @returns the result.
 */
async function applyCheckout(plan: UpdatePlan, deps: UpdateApplyDeps): Promise<UpdateApplyResult> {
  const checkout = deps.checkout
  if (checkout === undefined) return { ok: false, error: 'unavailable' }
  if (checkout.dirty) return { ok: false, error: 'dirty' }
  const timeoutMs = deps.timeoutMs ?? RUN_TIMEOUT_MS
  for (const step of plan.steps) {
    const outcome = await deps.runner(step, {
      cwd: checkout.dir,
      shell: true,
      timeoutMs: STEP_TIMEOUT_MS[step.command] ?? timeoutMs,
    })
    if (outcome.missing === true) {
      return {
        ok: false,
        error: 'tool-missing',
        output: tailText(`${step.command}: ${outcome.output}`),
      }
    }
    if (outcome.timedOut === true) {
      return { ok: false, error: 'timeout', output: tailText(outcome.output) }
    }
    if (outcome.code !== 0) {
      return {
        ok: false,
        error: 'failed',
        output: tailText(`${step.command}: exit ${outcome.code ?? 'none'}\n${outcome.output}`),
      }
    }
  }
  const version = deps.readVersion()
  return { ok: true, outcome: 'rebuilt', ...(version !== undefined ? { version } : {}) }
}

/**
 * Apply one update plan and report how it went.
 * @param deps - the plan and the injected effects.
 * @returns the result (`ok` is the only thing callers branch on).
 */
export async function applyUpdate(deps: UpdateApplyDeps): Promise<UpdateApplyResult> {
  if (deps.plan.apply === 'package') {
    return await applyPackage(deps.plan, deps.installer, deps.readVersion)
  }
  if (deps.plan.apply === 'checkout') return await applyCheckout(deps.plan, deps)
  return { ok: false, error: 'unsupported' }
}

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
export function spawnStep(
  step: UpdateStep,
  options: { cwd: string; shell: boolean; timeoutMs: number },
): Promise<CommandOutcome> {
  return new Promise<CommandOutcome>((resolve) => {
    let output = ''
    let timedOut = false
    let settled = false
    const child = spawn(step.command, step.args, {
      cwd: options.cwd,
      shell: options.shell,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const take = (chunk: Buffer): void => {
      output = tailText(output + chunk.toString())
    }
    child.stdout?.on('data', take)
    child.stderr?.on('data', take)
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, options.timeoutMs)
    const settle = (outcome: CommandOutcome): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(outcome)
    }
    child.on('error', (error: NodeJS.ErrnoException) => {
      const detail = error.code === 'ENOENT' ? 'command not found' : error.message
      settle({
        code: null,
        output: tailText(output === '' ? detail : `${detail}\n${output}`),
        ...(error.code === 'ENOENT' ? { missing: true } : {}),
      })
    })
    child.on('close', (code: number | null) => {
      settle({ code, output: tailText(output), ...(timedOut ? { timedOut: true } : {}) })
    })
  })
}
