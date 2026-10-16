/**
 * Update application (src/host/update-apply.ts): the plan decides which path
 * runs, the installation's own record decides what is reported, and every way
 * of NOT updating — a dirty checkout, a missing command, a deadline, a run that
 * exits non-zero, a service this host does not carry — comes back as a stable
 * code instead of a silent success.
 */
import { describe, expect, it } from 'vitest'
import {
  applyUpdate,
  type CommandOutcome,
  type UpdateApplyDeps,
  type UpdateRunner,
} from '../src/host/update-apply.ts'
import { updatePlanFor, type UpdatePlanInput, type UpdateStep } from '../src/core/update-check.ts'

const PKG = '@firetruck666/dsh-task-board'

/** The plan one mode produces with every fact about the copy available. */
function planOf(mode: UpdatePlanInput['mode'], extra: Partial<UpdatePlanInput> = {}) {
  return updatePlanFor({
    mode,
    packageName: PKG,
    githubSpec: 'github:FiretrUCK666/dsh-task-board',
    profile: 'web',
    appManaged: false,
    canInstall: true,
    ...extra,
  })
}

/** A runner that answers from a table in order and records what it was asked. */
function recordingRunner(outcomes: readonly CommandOutcome[]): {
  steps: UpdateStep[]
  run: UpdateRunner
} {
  const steps: UpdateStep[] = []
  let index = 0
  return {
    steps,
    run: async (step) => {
      steps.push(step)
      const outcome = outcomes[index] ?? { code: 0, output: '' }
      index += 1
      return outcome
    },
  }
}

/**
 * A version reader that answers what the disk said AT EACH MOMENT: the run
 * reads it before and after the install, because "did anything change" is the
 * one fact the installation service cannot report. The last value repeats.
 */
function versionSeq(...versions: (string | undefined)[]): () => string | undefined {
  let index = 0
  return () => {
    const value = versions[Math.min(index, versions.length - 1)]
    index += 1
    return value
  }
}

/** The package path's deps: one installation record, one version on disk. */
function packageDeps(
  record: Record<string, unknown>,
  overrides: Partial<UpdateApplyDeps> = {},
): UpdateApplyDeps {
  return {
    plan: planOf('npm'),
    installer: { installBundle: async () => record },
    runner: recordingRunner([]).run,
    readVersion: () => '0.9.60',
    ...overrides,
  }
}

/** The checkout path's deps: a checkout pointed at a temp directory. */
function checkoutDeps(
  outcomes: readonly CommandOutcome[],
  overrides: Partial<UpdateApplyDeps> = {},
): UpdateApplyDeps & { steps: UpdateStep[] } {
  const recorder = recordingRunner(outcomes)
  return {
    plan: planOf('local'),
    runner: recorder.run,
    checkout: { dir: '/repo', dirty: false },
    readVersion: () => '0.9.60',
    steps: recorder.steps,
    ...overrides,
  }
}

describe('applyUpdate on a package install', () => {
  it('reports what the installation applied, with the version on disk', async () => {
    const recorded: string[] = []
    const result = await applyUpdate({
      ...packageDeps({ application: 'applied', version: '0.9.59' }),
      readVersion: versionSeq('0.9.59', '0.9.60'),
      installer: {
        installBundle: async (spec) => {
          recorded.push(spec)
          return { application: 'applied', version: '0.9.59' }
        },
      },
    })
    expect(result).toEqual({ ok: true, outcome: 'applied', version: '0.9.60' })
    // The plan's own spec is what gets re-added — never a spec from the caller.
    expect(recorded).toEqual([`${PKG}@latest`])
  })

  it('keeps restart-required distinct from applied (they read differently)', async () => {
    const result = await applyUpdate({
      ...packageDeps({ application: 'restart-required' }),
      readVersion: versionSeq('0.9.59', '0.9.60'),
    })
    expect(result.ok).toBe(true)
    expect(result.outcome).toBe('restart-required')
  })

  it('a run that reports success without moving the version is NOT an update', async () => {
    // The measured shape: `pnpm add <pkg>@latest` on a copy whose declared range
    // already resolves to the installed version exits 0 having done nothing, and
    // the installation service reports that as a successful application. Saying
    // "updated to 1.1.0" there is the one answer a reader cannot check.
    const result = await applyUpdate({
      ...packageDeps({ application: 'restart-required', version: '1.1.0' }),
      readVersion: versionSeq('1.1.0', '1.1.0'),
    })
    expect(result).toEqual({ ok: true, outcome: 'unchanged', version: '1.1.0' })
  })

  it('the same non-move on a branch install IS still an update', async () => {
    // A `github:` install can move without any version changing (the branch's
    // commits did), so the version is not the identity of that install.
    const result = await applyUpdate({
      ...packageDeps({ application: 'restart-required', version: '1.1.0' }, { plan: planOf('github') }),
      readVersion: versionSeq('1.1.0', '1.1.0'),
    })
    expect(result.outcome).toBe('restart-required')
  })

  it('falls back to the record version when the disk cannot be read', async () => {
    const result = await applyUpdate({
      ...packageDeps({ application: 'applied', version: '0.9.59' }),
      readVersion: () => undefined,
    })
    expect(result.version).toBe('0.9.59')
  })

  it('a failed run reports the tail of what it printed', async () => {
    const result = await applyUpdate(packageDeps({
      application: 'failed',
      packageResult: { output: 'ERR_PNPM_NO_MATCHING_VERSION' },
    }))
    expect(result.ok).toBe(false)
    expect(result.error).toBe('failed')
    expect(result.output).toBe('ERR_PNPM_NO_MATCHING_VERSION')
  })

  it('an application value this version does not know is never a success', async () => {
    const result = await applyUpdate(packageDeps({ application: 'staged' }))
    expect(result.ok).toBe(false)
    expect(result.output).toContain('staged')
  })

  it('a service that is not there is unavailable, not a failure to install', async () => {
    const result = await applyUpdate({
      plan: planOf('npm'),
      runner: recordingRunner([]).run,
      readVersion: () => undefined,
    })
    expect(result).toEqual({ ok: false, error: 'unavailable' })
  })

  it('a service that throws reports the message instead of escaping', async () => {
    const result = await applyUpdate({
      plan: planOf('npm'),
      installer: { installBundle: async () => { throw new Error('lock timed out') } },
      runner: recordingRunner([]).run,
      readVersion: () => undefined,
    })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('failed')
    expect(result.output).toBe('lock timed out')
  })
})

describe('applyUpdate on a link: checkout', () => {
  it('runs the plan steps in order and reports the rebuilt version', async () => {
    const deps = checkoutDeps([{ code: 0, output: '' }, { code: 0, output: 'built' }])
    const result = await applyUpdate(deps)
    expect(result).toEqual({ ok: true, outcome: 'rebuilt', version: '0.9.60' })
    expect(deps.steps).toEqual([
      { command: 'git', args: ['pull', '--ff-only'] },
      { command: 'pnpm', args: ['run', 'build'] },
    ])
  })

  it('a dirty checkout is refused before anything runs', async () => {
    const deps = checkoutDeps([{ code: 0, output: '' }], { checkout: { dir: '/repo', dirty: true } })
    const result = await applyUpdate(deps)
    expect(result).toEqual({ ok: false, error: 'dirty' })
    expect(deps.steps).toEqual([])
  })

  it('a step that exits non-zero stops the run and names itself', async () => {
    const deps = checkoutDeps([{ code: 1, output: 'CONFLICT (content): merge conflict' }])
    const result = await applyUpdate(deps)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('failed')
    expect(result.output).toContain('git: exit 1')
    expect(result.output).toContain('CONFLICT')
    // The build never ran: a failed pull must not leave a half-updated copy.
    expect(deps.steps).toHaveLength(1)
  })

  it('a command that is not installed reads as tool-missing', async () => {
    const deps = checkoutDeps([{ code: null, output: 'command not found', missing: true }])
    const result = await applyUpdate(deps)
    expect(result.error).toBe('tool-missing')
    expect(result.output).toContain('git')
  })

  it('a deadline reads as timeout', async () => {
    const deps = checkoutDeps([{ code: null, output: 'partial', timedOut: true }])
    expect((await applyUpdate(deps)).error).toBe('timeout')
  })

  it('no checkout facts is unavailable, not a silent success', async () => {
    const deps = checkoutDeps([{ code: 0, output: '' }], { checkout: undefined })
    expect(await applyUpdate(deps)).toEqual({ ok: false, error: 'unavailable' })
    expect(deps.steps).toEqual([])
  })

  it('the pull gets its own shorter deadline than the build', async () => {
    const deadlines: number[] = []
    await applyUpdate({
      plan: planOf('local'),
      runner: async (_step, options) => {
        deadlines.push(options.timeoutMs)
        return { code: 0, output: '' }
      },
      checkout: { dir: '/repo', dirty: false },
      readVersion: () => undefined,
    })
    expect(deadlines).toHaveLength(2)
    expect(deadlines[0]).toBeLessThan(deadlines[1] ?? 0)
  })
})

describe('applyUpdate on a plan with nothing to apply', () => {
  it('an unreadable install mode is unsupported', async () => {
    const result = await applyUpdate({
      plan: planOf('unknown'),
      runner: recordingRunner([]).run,
      readVersion: () => undefined,
    })
    expect(result).toEqual({ ok: false, error: 'unsupported' })
  })
})

describe('applyUpdate on a reinstall', () => {
  const REINSTALL = planOf('npm', { reinstall: true })

  /** The service, recording the order it was asked to do things in. */
  function service(
    order: string[],
    remove: Record<string, unknown> | Error = {},
    install: Record<string, unknown> = { application: 'applied', version: '1.2.0' },
  ): UpdateApplyDeps['installer'] {
    return {
      removeBundle: async (name: string) => {
        order.push(`remove:${name}`)
        if (remove instanceof Error) throw remove
        return remove
      },
      installBundle: async (spec: string) => {
        order.push(`install:${spec}`)
        return install
      },
    }
  }

  it('uninstalls first, then installs, in that order', async () => {
    // The order is the contract: HMR hosts refuse to install over an installed
    // package precisely so the old version stops before its files are replaced.
    const order: string[] = []
    const result = await applyUpdate({
      plan: REINSTALL,
      installer: service(order),
      runner: recordingRunner([]).run,
      readVersion: versionSeq('1.1.0', '1.2.0'),
    })
    expect(order).toEqual([`remove:${PKG}`, `install:${PKG}@latest`])
    expect(result).toEqual({ ok: true, outcome: 'applied', version: '1.2.0' })
  })

  it('a plan without reinstall installs straight over the running copy', async () => {
    const order: string[] = []
    const result = await applyUpdate({
      plan: planOf('npm'),
      installer: service(order),
      runner: recordingRunner([]).run,
      readVersion: () => '1.2.0',
    })
    expect(order).toEqual([`install:${PKG}@latest`])
    expect(result.ok).toBe(true)
  })

  it('a host whose service cannot uninstall reports unavailable, and installs nothing', async () => {
    const order: string[] = []
    const result = await applyUpdate({
      plan: REINSTALL,
      installer: {
        installBundle: async (spec: string) => {
          order.push(`install:${spec}`)
          return { application: 'applied' }
        },
      },
      runner: recordingRunner([]).run,
      readVersion: () => undefined,
    })
    expect(result).toEqual({ ok: false, error: 'unavailable' })
    expect(order).toEqual([])
  })

  it('a refused removal stops there, and says which refusal it was', async () => {
    // `bundle-in-use` and friends arrive as a code on the record; a failed
    // `pnpm remove` arrives as a thrown error whose message is its output.
    const order: string[] = []
    const refused = await applyUpdate({
      plan: REINSTALL,
      installer: service(order, { error: { code: 'bundle-in-use' } }),
      runner: recordingRunner([]).run,
      readVersion: () => undefined,
    })
    expect(refused.ok).toBe(false)
    expect(refused.output).toContain('bundle-in-use')
    const thrown = await applyUpdate({
      plan: REINSTALL,
      installer: service(order, new Error('ERR_PNPM_NO_MATCHING_VERSION')),
      runner: recordingRunner([]).run,
      readVersion: () => undefined,
    })
    expect(thrown.ok).toBe(false)
    expect(thrown.output).toContain('ERR_PNPM_NO_MATCHING_VERSION')
    // Neither one went on to install: an uninstall that did not happen must not
    // be followed by an install that pretends it did.
    expect(order.filter(entry => entry.startsWith('install:'))).toEqual([])
  })

  it('a removal that exits non-zero is a failure, not an install', async () => {
    const order: string[] = []
    const result = await applyUpdate({
      plan: REINSTALL,
      installer: service(order, { packageResult: { exitCode: 1, output: 'boom' } }),
      runner: recordingRunner([]).run,
      readVersion: () => undefined,
    })
    expect(result.ok).toBe(false)
    expect(result.output).toContain('boom')
    expect(order).toEqual([`remove:${PKG}`])
  })
})
