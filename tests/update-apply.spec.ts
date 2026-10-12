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
    const result = await applyUpdate(packageDeps({ application: 'restart-required' }))
    expect(result.ok).toBe(true)
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
