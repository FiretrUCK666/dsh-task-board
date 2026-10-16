/**
 * Update-check grammar (src/core/update-check.ts): install-mode
 * classification, numeric version comparison, the plan that updates a copy
 * (and who applies it), the packument reading that answers "what is the latest
 * version", and the local-checkout behind test. Pure logic — no platform seam.
 */
import { describe, expect, it } from 'vitest'
import {
  classifyInstallSpec,
  commandLineOf,
  commandWordsOf,
  compareVersions,
  githubSpecOfRepositoryUrl,
  isGitBehind,
  isNewerVersion,
  latestFromPackument,
  packumentUrl,
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

  it('a packaged application KEEPS its terminal command, quit-app note and all', () => {
    // Withholding it left the one install with no working button-side path and
    // no command either. The CLI special-cases the desktop profile rather than
    // refusing it; the only extra requirement is that the app be quit first,
    // which is page copy.
    const plan = updatePlanFor({ ...base, mode: 'npm', appManaged: true })
    expect(plan.apply).toBe('package')
    expect(plan.appManaged).toBe(true)
    expect(commandLineOf(plan.steps)).toBe(`dsh plugin --profile web add ${pkg}@latest`)
  })

  it('a reinstall is stated on the plan, not left for the page to guess', () => {
    const reinstall = updatePlanFor({ ...base, mode: 'npm', reinstall: true })
    const overwrite = updatePlanFor({ ...base, mode: 'npm' })
    expect(reinstall.reinstall).toBe(true)
    expect(overwrite.reinstall).toBeUndefined()
  })

  it('no apply path means no reinstall claim either', () => {
    const plan = updatePlanFor({ ...base, mode: 'npm', canInstall: false, reinstall: true })
    expect(plan.apply).toBe('none')
    expect(plan.reinstall).toBeUndefined()
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

describe('packumentUrl', () => {
  it('encodes a scope\'s slash and tolerates a registry with or without its slash', () => {
    expect(packumentUrl('https://registry.npmjs.org/', '@firetruck666/dsh-task-board'))
      .toBe('https://registry.npmjs.org/@firetruck666%2Fdsh-task-board')
    expect(packumentUrl('https://registry.npmmirror.com', '@firetruck666/dsh-task-board'))
      .toBe('https://registry.npmmirror.com/@firetruck666%2Fdsh-task-board')
  })
})

describe('latestFromPackument', () => {
  it('reads dist-tags.latest plus its publish instant', () => {
    expect(latestFromPackument({
      'dist-tags': { latest: '1.1.0' },
      time: { '1.0.0': '2026-01-01T00:00:00.000Z', '1.1.0': '2026-02-02T00:00:00.000Z' },
    })).toEqual({ version: '1.1.0', publishedAt: '2026-02-02T00:00:00.000Z' })
  })

  it('a missing publish instant still yields the version', () => {
    expect(latestFromPackument({ 'dist-tags': { latest: '1.1.0' }, time: {} }))
      .toEqual({ version: '1.1.0' })
  })

  it('a document with no usable latest is not an answer', () => {
    // Not an answer means the caller asks the next registry — never that the
    // installed copy is up to date.
    expect(latestFromPackument({ 'dist-tags': {} })).toBeUndefined()
    expect(latestFromPackument({ 'dist-tags': { latest: '' } })).toBeUndefined()
    expect(latestFromPackument({})).toBeUndefined()
    expect(latestFromPackument(null)).toBeUndefined()
  })
})

describe('commandWordsOf', () => {
  it('is the same command as commandLineOf, split at the spaces', () => {
    // One list, two views: the page draws the words and copies the joined line,
    // so they cannot disagree about what the command is.
    const steps = [
      { command: 'git', args: ['pull', '--ff-only'] },
      { command: 'pnpm', args: ['run', 'build'] },
    ]
    const words = commandWordsOf(steps)
    expect(words).toEqual(['git', 'pull', '--ff-only', '&&', 'pnpm', 'run', 'build'])
    expect(words.join(' ')).toBe(commandLineOf(steps))
  })

  it('keeps a package spec in one word, hyphens and all', () => {
    const words = commandWordsOf([
      { command: 'dsh', args: ['plugin', '--profile', 'desktop', 'add', '@firetruck666/dsh-task-board@latest'] },
    ])
    expect(words.filter(one => one.includes('firetruck666'))).toEqual(['@firetruck666/dsh-task-board@latest'])
  })

  it('no steps is no words, not an empty word', () => {
    expect(commandWordsOf([])).toEqual([])
    expect(commandLineOf([])).toBe('')
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
