/**
 * Update-check grammar (src/core/update-check.ts): install-mode
 * classification, numeric version comparison, the plan that updates a copy
 * (and who applies it), the packument reading that answers "what is the latest
 * version", and the local-checkout behind test. Pure logic — no platform seam.
 *
 * The last part is not pure: where the checkout's REMOTE tip comes from is
 * read over real git, against real repositories made for the test — because
 * the branch a remote defaults to is a fact about that remote, and a fixture
 * that claimed one would be claiming it rather than reading it.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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
  sourceSpecOf,
  updatePlanFor,
} from '../src/core/update-check.ts'
import { readGitStatus } from '../src/host/update-route.ts'

describe('classifyInstallSpec', () => {
  it('link: is local development', () => {
    expect(classifyInstallSpec('link:C:/Users/me/.dsh/Plugins/dsh-task-board')).toBe('local')
    expect(classifyInstallSpec('link:/home/me/repo')).toBe('local')
  })

  it('github: and tarball URLs are source installs', () => {
    expect(classifyInstallSpec('github:FiretrUCK666/dsh-task-board')).toBe('github')
    expect(classifyInstallSpec('https://example.com/pkg.tar.gz/abc123')).toBe('github')
  })

  it('every git spelling is a source install, not a registry one', () => {
    // A `git+…` spec read as npm would offer `<pkg>@latest` — a DIFFERENT
    // package under the same name — as the update for it.
    expect(classifyInstallSpec('git+https://github.com/o/r.git')).toBe('github')
    expect(classifyInstallSpec('git+ssh://git@github.com/o/r')).toBe('github')
    expect(classifyInstallSpec('git@github.com:o/r.git')).toBe('github')
    expect(classifyInstallSpec('gitlab:o/r')).toBe('github')
    expect(classifyInstallSpec('bitbucket:o/r')).toBe('github')
    expect(classifyInstallSpec('github:o/r#abc1234')).toBe('github')
  })

  it('a local artifact is neither a checkout nor a registry install', () => {
    // `file:`/`portal:`/`workspace:` name a local build. Reading them as npm
    // would put a command on screen that replaces that reader's own build with
    // the published one; reading them as `local` would offer a `git pull` in a
    // directory that is not a working tree. Neither route exists, so neither is
    // claimed.
    expect(classifyInstallSpec('file:../dsh-task-board')).toBe('unknown')
    expect(classifyInstallSpec('portal:../dsh-task-board')).toBe('unknown')
    expect(classifyInstallSpec('workspace:*')).toBe('unknown')
  })

  it('version ranges are npm installs', () => {
    expect(classifyInstallSpec('^0.2.80')).toBe('npm')
    expect(classifyInstallSpec('0.2.80')).toBe('npm')
    expect(classifyInstallSpec('latest')).toBe('npm')
    expect(classifyInstallSpec('^1.1.0')).toBe('npm')
  })

  it('a missing spec reads as unknown (never a guess)', () => {
    expect(classifyInstallSpec(undefined)).toBe('unknown')
    expect(classifyInstallSpec('')).toBe('unknown')
  })
})

describe('sourceSpecOf', () => {
  it('re-adds the spec the profile recorded, without a pinned commit', () => {
    // The fragment names ONE commit: re-adding it would reinstall exactly the
    // code that is already there and call it an update.
    expect(sourceSpecOf('github:someone/fork#abc1234')).toBe('github:someone/fork')
    expect(sourceSpecOf('https://example.com/pkg.tgz')).toBe('https://example.com/pkg.tgz')
  })

  it('a non-source spec is not a source update', () => {
    expect(sourceSpecOf('^1.1.0')).toBeUndefined()
    expect(sourceSpecOf('link:C:/repo')).toBeUndefined()
    expect(sourceSpecOf(undefined)).toBeUndefined()
    expect(sourceSpecOf('#abc')).toBeUndefined()
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

  it('a github install re-adds what THIS profile recorded, not the canonical repo', () => {
    // A fork, a mirror or a tarball URL is what that reader installed. Pointing
    // the update at the package's own repository would swap their package for a
    // different one under the same name — and a pinned commit would reinstall
    // the same code.
    const plan = updatePlanFor({ ...base, mode: 'github', recordedSpec: 'github:someone/fork#abc1234' })
    expect(plan.packageSpec).toBe('github:someone/fork')
    expect(commandLineOf(plan.steps)).toBe('dsh plugin --profile web add github:someone/fork')
    const url = updatePlanFor({ ...base, mode: 'github', recordedSpec: 'https://example.com/pkg.tgz' })
    expect(url.packageSpec).toBe('https://example.com/pkg.tgz')
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

  it('a packaged application gets no terminal command, because which dsh a reader has decides it', () => {
    // The CLI has two shims and only the application's own accepts the profile
    // name: the npm-installed `dsh` errors with
    // `profile "desktop" is managed exclusively by the Electron application`.
    // A line that works for one shim and fails for the other is not a line to
    // hand a reader, so the page names the application's own plugin page.
    const plan = updatePlanFor({ ...base, mode: 'npm', appManaged: true })
    expect(plan.apply).toBe('package')
    expect(plan.appManaged).toBe(true)
    expect(plan.steps).toEqual([])
  })

  it('a profile nobody owns keeps its command', () => {
    expect(commandLineOf(updatePlanFor({ ...base, mode: 'npm' }).steps))
      .toBe(`dsh plugin --profile web add ${pkg}@latest`)
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

/** The temporary directories the git fixtures live in, so they can be removed. */
const GIT_FIXTURES: string[] = []

/** Run one git command in a directory and return its trimmed output. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

/**
 * A checkout whose remote's DEFAULT branch is `branch`, and the remote itself.
 *
 * The remote is a real bare repository with a real branch on it, and the
 * remote's HEAD is pointed at that branch the way a hosting service points
 * it at its default branch. Nothing here says what the default branch is
 * called — the test passes the name in and the reader has to find it.
 */
function checkoutOfRemote(branch: string): { remote: string; checkout: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-tb-git-'))
  GIT_FIXTURES.push(root)
  const remote = path.join(root, 'origin.git')
  const checkout = path.join(root, 'source')
  git(root, 'init', '--bare', '-q', remote)
  git(root, 'init', '-q', checkout)
  git(checkout, 'symbolic-ref', 'HEAD', `refs/heads/${branch}`)
  git(checkout, 'config', 'user.email', 'test@example.invalid')
  git(checkout, 'config', 'user.name', 'Test')
  fs.writeFileSync(path.join(checkout, 'a.txt'), 'x\n')
  git(checkout, 'add', 'a.txt')
  git(checkout, '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init')
  git(checkout, 'remote', 'add', 'origin', remote)
  git(checkout, 'push', '-q', 'origin', branch)
  git(remote, 'symbolic-ref', 'HEAD', `refs/heads/${branch}`)
  return { remote, checkout }
}

afterAll(() => {
  for (const root of GIT_FIXTURES) fs.rmSync(root, { recursive: true, force: true })
})

describe('the checkout\'s remote tip comes from the remote\'s own default branch', () => {
  /**
   * THE DEFECT THIS PINS.
   *
   * The remote's tip was read as `refs/heads/main` — a branch name written
   * into the code. A checkout whose default branch is `master` therefore never
   * got a `remoteHead` at all, and the client tells 「判断不了」 from 「已同步」
   * by exactly that field: no `remoteHead` means it cannot say. So a `master`
   * checkout could never be told that it was behind, no matter what the remote
   * had.
   *
   * The branch is DETECTED now, and a remote that does not say which branch is
   * its default is read as 「判断不了」 — never as 「已同步」.
   */
  it('a remote whose default branch is master yields its head', async () => {
    const { remote, checkout } = checkoutOfRemote('master')
    // A commit the checkout does not have, so 「behind」 is a real answer here
    // and not a coincidence of two equal SHAs.
    git(checkout, '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'upstream')
    git(checkout, 'push', '-q', 'origin', 'master')
    git(checkout, 'reset', '-q', '--hard', 'HEAD~1')
    const status = await readGitStatus(checkout)
    expect(status, 'the checkout was not read at all').toBeDefined()
    expect(
      status?.remoteHead,
      'a remote whose default branch is master yielded no head, so the screen can only ever say 「判断不了」',
    ).toBeDefined()
    expect(status?.remoteHead).toBe(git(remote, 'rev-parse', 'refs/heads/master'))
    // And with both SHAs known, the checkout can be told that it is behind —
    // which is the reading a missing remote head made impossible.
    expect(isGitBehind({ head: status?.head ?? '', remoteHead: status?.remoteHead, dirty: false })).toBe(true)
  })

  it('a remote that says nothing about its default branch yields no head at all', async () => {
    const { remote, checkout } = checkoutOfRemote('master')
    // The remote's HEAD points at a branch that does not exist, so it
    // advertises no HEAD and never says which branch is its default.
    git(remote, 'symbolic-ref', 'HEAD', 'refs/heads/nonexistent')
    const status = await readGitStatus(checkout)
    expect(status?.head, 'the local head is still read — the checkout did not break').toBeDefined()
    expect(
      status?.remoteHead,
      'a remote that said nothing was given a head anyway — that is the client reading 「已同步」 out of a guess',
    ).toBeUndefined()
    // A missing remote head is never evidence of anything: not of being behind,
    // and not of being in sync.
    expect(isGitBehind({ head: status?.head ?? '', dirty: false })).toBe(false)
  })
})
