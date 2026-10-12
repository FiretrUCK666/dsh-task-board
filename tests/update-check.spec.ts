/**
 * Update-check grammar (src/core/update-check.ts): install-mode
 * classification, numeric version comparison, the plan that updates a copy
 * (and who applies it), and the local-checkout behind test. Pure logic — no
 * platform seam.
 */
import { describe, expect, it } from 'vitest'
import {
  classifyInstallSpec,
  commandLineOf,
  compareVersions,
  githubSpecOfRepositoryUrl,
  isGitBehind,
  isNewerVersion,
  parseVersionParts,
  shortSha,
  updatePlanFor,
} from '../src/core/update-check.ts'

describe('classifyInstallSpec', () => {
  it('link: is local development', () => {
    expect(classifyInstallSpec('link:C:/Users/me/.dsh/Plugins/dsh-task-board')).toBe('local')
    expect(classifyInstallSpec('link:/home/me/repo')).toBe('local')
  })

  it('github: and tarball URLs are source installs', () => {
    expect(classifyInstallSpec('github:FiretrUCK666/dsh-task-board')).toBe('github')
    expect(classifyInstallSpec('https://example.com/pkg.tar.gz/abc123')).toBe('github')
  })

  it('version ranges are npm installs', () => {
    expect(classifyInstallSpec('^0.2.80')).toBe('npm')
    expect(classifyInstallSpec('0.2.80')).toBe('npm')
    expect(classifyInstallSpec('latest')).toBe('npm')
  })

  it('a missing spec reads as unknown (never a guess)', () => {
    expect(classifyInstallSpec(undefined)).toBe('unknown')
    expect(classifyInstallSpec('')).toBe('unknown')
  })
})

describe('compareVersions', () => {
  it('compares numeric triples segment by segment', () => {
    expect(compareVersions('0.2.80', '0.2.80')).toBe(0)
    expect(compareVersions('0.2.81', '0.2.80')).toBe(1)
    expect(compareVersions('0.2.80', '0.2.81')).toBe(-1)
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1)
    expect(compareVersions('1.0.0', '0.99.99')).toBe(1)
  })

  it('ignores suffixes and tolerates short forms', () => {
    expect(compareVersions('0.2.81-rc.1', '0.2.80')).toBe(1)
    expect(compareVersions('0.2', '0.2.0')).toBe(0)
    expect(parseVersionParts('not-a-version')).toEqual([0, 0, 0])
  })

  it('isNewerVersion is strict (equal or older reads as up to date)', () => {
    expect(isNewerVersion('0.2.81', '0.2.80')).toBe(true)
    expect(isNewerVersion('0.2.80', '0.2.80')).toBe(false)
    expect(isNewerVersion('0.2.79', '0.2.80')).toBe(false)
  })
})

describe('githubSpecOfRepositoryUrl', () => {
  it('derives the install spec without repeating the account in code', () => {
    expect(githubSpecOfRepositoryUrl('git+https://github.com/FiretrUCK666/dsh-task-board.git'))
      .toBe('github:FiretrUCK666/dsh-task-board')
    expect(githubSpecOfRepositoryUrl('https://github.com/someone/else')).toBe('github:someone/else')
  })

  it('returns undefined for non-GitHub URLs', () => {
    expect(githubSpecOfRepositoryUrl('https://example.com/repo.git')).toBeUndefined()
  })
})

describe('updatePlanFor', () => {
  const pkg = '@firetruck666/dsh-task-board'
  const spec = 'github:FiretrUCK666/dsh-task-board'
  const base = {
    packageName: pkg,
    githubSpec: spec,
    profile: 'web',
    appManaged: false,
    canInstall: true,
  }

  it('npm installs re-add the package at latest, through the profile that carries them', () => {
    const plan = updatePlanFor({ ...base, mode: 'npm' })
    expect(plan.apply).toBe('package')
    expect(plan.packageSpec).toBe(`${pkg}@latest`)
    expect(plan.profile).toBe('web')
    expect(commandLineOf(plan.steps)).toBe(`dsh plugin --profile web add ${pkg}@latest`)
  })

  it('github installs re-add the repository spec', () => {
    const plan = updatePlanFor({ ...base, mode: 'github' })
    expect(plan.apply).toBe('package')
    expect(plan.packageSpec).toBe(spec)
    expect(commandLineOf(plan.steps)).toBe(`dsh plugin --profile web add ${spec}`)
  })

  it('local checkouts pull and rebuild in place', () => {
    const plan = updatePlanFor({ ...base, mode: 'local' })
    expect(plan.apply).toBe('checkout')
    expect(commandLineOf(plan.steps)).toBe('git pull --ff-only && pnpm run build')
  })

  it('the checkout supplies its own refresh steps when the host read them', () => {
    const steps = [{ command: 'yarn', args: ['run', 'build'] }]
    expect(updatePlanFor({ ...base, mode: 'local', checkoutSteps: steps }).steps).toEqual(steps)
  })

  it('a packaged application gets no terminal command: its CLI refuses that profile', () => {
    const plan = updatePlanFor({ ...base, mode: 'npm', appManaged: true })
    expect(plan.apply).toBe('package')
    expect(plan.steps).toEqual([])
  })

  it('an unreadable profile name yields no command rather than an invalid one', () => {
    const plan = updatePlanFor({
      mode: 'npm',
      packageName: pkg,
      githubSpec: spec,
      appManaged: false,
      canInstall: true,
    })
    expect(plan.steps).toEqual([])
    expect(plan.profile).toBeUndefined()
  })

  it('a host without the installation service keeps the command and applies nothing', () => {
    const plan = updatePlanFor({ ...base, mode: 'npm', canInstall: false })
    expect(plan.apply).toBe('none')
    expect(commandLineOf(plan.steps)).toBe(`dsh plugin --profile web add ${pkg}@latest`)
  })

  it('an unreadable install mode gets no plan at all (never a guessed command)', () => {
    const plan = updatePlanFor({ ...base, mode: 'unknown' })
    expect(plan.apply).toBe('none')
    expect(plan.packageSpec).toBeUndefined()
    expect(plan.steps).toEqual([])
  })

  it('a source install with no repository to re-add gets no plan', () => {
    const plan = updatePlanFor({
      mode: 'github',
      packageName: pkg,
      profile: 'web',
      appManaged: false,
      canInstall: true,
    })
    expect(plan.apply).toBe('none')
    expect(plan.steps).toEqual([])
  })
})

describe('git status helpers', () => {
  it('behind only when both SHAs are known and differ', () => {
    expect(isGitBehind({ head: 'aaa', remoteHead: 'bbb', dirty: false })).toBe(true)
    expect(isGitBehind({ head: 'aaa', remoteHead: 'aaa', dirty: false })).toBe(false)
    expect(isGitBehind({ head: 'aaa', dirty: false })).toBe(false)
    expect(isGitBehind({ head: '', remoteHead: 'bbb', dirty: false })).toBe(false)
  })

  it('shortSha keeps short inputs intact', () => {
    expect(shortSha('97b9dec9c8b1')).toBe('97b9dec')
    expect(shortSha('abc')).toBe('abc')
  })
})
