/**
 * Pure tests for the update surfaces (`createUpdateHandler`, `runningCopyOf`,
 * `installedVersionIn`) with faked read/apply deps, fake HTTP req/res pairs and
 * real temp directories.
 *
 * The discovery tests are the regression for the defect this route was rebuilt
 * around: WHICH profile is running is read from the process, so two profiles on
 * one machine (a desktop install and a `link:` checkout) each describe
 * themselves — no profile name is written into the route.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  createUpdateHandler,
  installedVersionIn,
  readLatest,
  registryOrderOf,
  runningCopyOf,
  type UpdateRouteDeps,
  type UpdateSourceView,
} from '../src/host/update-route.ts'
import { commandLineOf, PUBLIC_REGISTRIES, updatePlanFor } from '../src/core/update-check.ts'
import type { UpdateApplyResult } from '../src/host/update-apply.ts'

const PKG = '@firetruck666/dsh-task-board'

/** A fake response capturing the written status and body. */
function fakeRes(): import('node:http').ServerResponse & { state: { status: number; body: string } } {
  const state = { status: 200, body: '' }
  return {
    state,
    writeHead(status: number) { state.status = status },
    end(payload: string) { state.body = payload },
  } as unknown as import('node:http').ServerResponse & { state: { status: number; body: string } }
}

/** A fake request (the update route only reads the method). */
function fakeReq(method: string): import('node:http').IncomingMessage {
  return { method, headers: {} } as unknown as import('node:http').IncomingMessage
}

/** A context carrying only the named services a test wants it to carry. */
function fakeCtx(services: Record<string, unknown>): Context {
  return { get: (name: string) => services[name] } as unknown as Context
}

const VIEW: UpdateSourceView = {
  packageName: PKG,
  version: '0.2.81',
  spec: 'link:/repo',
  mode: 'local',
  profile: 'web',
  appManaged: false,
  evidence: { linked: true, declared: true, disagreement: false },
  githubSpec: 'github:FiretrUCK666/dsh-task-board',
  plan: updatePlanFor({
    mode: 'local',
    packageName: PKG,
    profile: 'web',
    appManaged: false,
    canInstall: true,
  }),
  git: { head: 'aaa', remoteHead: 'bbb', dirty: false },
}

const OK_APPLY: UpdateApplyResult = { ok: true, outcome: 'applied', version: '0.2.82' }

describe('createUpdateHandler', () => {
  it('GET serves the update-source view untouched', async () => {
    const deps: UpdateRouteDeps = { read: () => VIEW, apply: async () => OK_APPLY }
    const res = fakeRes()
    await createUpdateHandler(deps)(fakeReq('GET'), res)
    const envelope = JSON.parse(res.state.body)
    expect(envelope.ok).toBe(true)
    expect(envelope.value).toEqual(VIEW)
  })

  it('POST serves what applying did', async () => {
    const deps: UpdateRouteDeps = { read: () => VIEW, apply: async () => OK_APPLY }
    const res = fakeRes()
    await createUpdateHandler(deps)(fakeReq('POST'), res)
    expect(res.state.status).toBe(200)
    expect(JSON.parse(res.state.body)).toEqual({ ok: true, value: OK_APPLY })
  })

  it('POST carries a refusal as a value, not as a transport error', async () => {
    const refusal: UpdateApplyResult = { ok: false, error: 'dirty', output: 'git: exit 1' }
    const deps: UpdateRouteDeps = { read: () => VIEW, apply: async () => refusal }
    const res = fakeRes()
    await createUpdateHandler(deps)(fakeReq('POST'), res)
    expect(JSON.parse(res.state.body)).toEqual({ ok: true, value: refusal })
  })

  it('a throwing read lands in the error envelope (HTTP 200)', async () => {
    const deps: UpdateRouteDeps = {
      read: () => { throw new Error('manifest unreadable') },
      apply: async () => OK_APPLY,
    }
    const res = fakeRes()
    await createUpdateHandler(deps)(fakeReq('GET'), res)
    const envelope = JSON.parse(res.state.body)
    expect(envelope.ok).toBe(false)
    expect(envelope.error.code).toBe('update')
  })

  it('a throwing apply lands in the error envelope too', async () => {
    const deps: UpdateRouteDeps = {
      read: () => VIEW,
      apply: async () => { throw new Error('spawn failed') },
    }
    const res = fakeRes()
    await createUpdateHandler(deps)(fakeReq('POST'), res)
    expect(JSON.parse(res.state.body).error.message).toBe('spawn failed')
  })

  it('methods other than GET and POST are refused with 405', async () => {
    const deps: UpdateRouteDeps = { read: () => VIEW, apply: async () => OK_APPLY }
    for (const method of ['PUT', 'DELETE', 'PATCH']) {
      const res = fakeRes()
      await createUpdateHandler(deps)(fakeReq(method), res)
      expect(res.state.status).toBe(405)
    }
  })
})

describe('runningCopyOf', () => {
  const roots: string[] = []

  afterAll(() => {
    for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true })
  })

  /** One throwaway directory with a manifest. */
  function tempDir(manifest: Record<string, unknown>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-tb-update-'))
    roots.push(dir)
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest))
    return dir
  }

  /**
   * A profile that really installs this package, plus where that copy's code
   * would then be running from.
   *
   * A profile only counts as this copy's install when its installed location
   * actually IS this copy, so a fixture that skipped this would be pinning a
   * state production cannot reach — which is how the original defect stayed
   * green here while the real desktop reported the wrong thing.
   */
  function installedProfile(spec: string): { dir: string; self: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-tb-profile-'))
    roots.push(dir)
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: `dsh-profile-${path.basename(dir)}`, dependencies: { [PKG]: spec } }),
    )
    const self = path.join(dir, 'node_modules', ...PKG.split('/'))
    fs.mkdirSync(self, { recursive: true })
    fs.writeFileSync(
      path.join(self, 'package.json'),
      JSON.stringify({ name: PKG, version: '0.9.54' }),
    )
    return { dir, self }
  }

  /** A profile whose installed location is a link out to `target`. */
  function linkedProfile(target: string): { dir: string; self: string } {
    const profile = installedProfile(`link:${target}`)
    fs.rmSync(profile.self, { recursive: true, force: true })
    fs.symlinkSync(target, profile.self, 'junction')
    return { dir: profile.dir, self: target }
  }

  it('reports the desktop profile\'s own npm install, and gives it a command', () => {
    // The defect: an npm install in the desktop profile was described with the
    // web profile's `link:` spec, so it said "local development" and offered to
    // git-pull somebody else's checkout — and the desktop could never update.
    const desktop = installedProfile('^0.9.54')
    const copy = runningCopyOf(fakeCtx({
      profileContext: { name: 'desktop', dir: desktop.dir, packageManager: { command: 'app' } },
      pluginManager: {},
      hmr: {},
    }), desktop.self)
    expect(copy.mode).toBe('npm')
    expect(copy.profile).toBe('desktop')
    expect(copy.spec).toBe('^0.9.54')
    expect(copy.appManaged).toBe(true)
    expect(copy.plan.apply).toBe('package')
    expect(copy.plan.packageSpec).toBe(`${PKG}@latest`)
    // A packaged application's profile DOES have a terminal path — the CLI
    // special-cases that profile name instead of refusing it, and only asks
    // that the application has run once and is fully quit.
    expect(commandLineOf(copy.plan.steps)).toBe(`dsh plugin --profile desktop add ${PKG}@latest`)
  })

  it('a linked copy is a checkout, and the checkout is where the code runs', () => {
    // The checkout's own markers decide the manager, so a pnpm checkout gets a
    // pnpm build even on a machine whose convention could have been npm.
    const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-tb-checkout-'))
    roots.push(checkout)
    fs.writeFileSync(path.join(checkout, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    const profile = linkedProfile(checkout)
    const copy = runningCopyOf(
      fakeCtx({ profileContext: { name: 'web', dir: profile.dir }, pluginManager: {} }),
      profile.self,
    )
    expect(copy.mode).toBe('local')
    expect(copy.appManaged).toBe(false)
    expect(copy.checkoutDir).toBe(checkout)
    expect(copy.plan.profile).toBe('web')
    expect(copy.evidence.linked).toBe(true)
    expect(commandLineOf(copy.plan.steps)).toBe('git pull --ff-only && pnpm run build')
  })

  it('the reinstall step follows HMR, which is the predicate the service uses', () => {
    // With HMR the service refuses to install over an installed package, so the
    // running copy has to come out first; without it the service refuses to
    // REMOVE a running bundle, so the install goes straight over the top.
    const profile = installedProfile('^1.0.0')
    const withHmr = runningCopyOf(fakeCtx({
      profileContext: { name: 'web', dir: profile.dir },
      pluginManager: {},
      hmr: {},
    }), profile.self)
    const withoutHmr = runningCopyOf(fakeCtx({
      profileContext: { name: 'web', dir: profile.dir },
      pluginManager: {},
    }), profile.self)
    expect(withHmr.plan.reinstall).toBe(true)
    expect(withoutHmr.plan.reinstall).toBeUndefined()
    expect(withHmr.plan.apply).toBe('package')
    expect(withoutHmr.plan.apply).toBe('package')
  })

  it('the profile name falls back to the directory it was loaded from', () => {
    const profile = installedProfile('^1.0.0')
    const copy = runningCopyOf(fakeCtx({ profileContext: { dir: profile.dir } }), profile.self)
    expect(copy.profile).toBe(path.basename(profile.dir))
  })

  it('a host that declares nothing still finds the profile the copy runs from', () => {
    // The declaration corroborates; the location decides. A host with no
    // profile service at all still names the right profile, because the copy
    // was found inside it.
    const profile = installedProfile('^1.0.0')
    const copy = runningCopyOf(fakeCtx({}), profile.self)
    expect(copy.mode).toBe('npm')
    expect(copy.profile).toBe(path.basename(profile.dir))
    expect(copy.evidence.declared).toBe(false)
    expect(copy.evidence.linked).toBe(false)
  })

  it('a declaration that names another copy is recorded, not believed', () => {
    // The shape of the original defect: something declares a profile, and the
    // code is somewhere else entirely. The location wins and the disagreement
    // is reported instead of hidden.
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-tb-elsewhere-'))
    roots.push(elsewhere)
    const declared = tempDir({
      name: 'dsh-profile-web',
      dependencies: { [PKG]: 'link:C:/somewhere/else' },
    })
    const copy = runningCopyOf(fakeCtx({ profileContext: { name: 'web', dir: declared } }), elsewhere)
    expect(copy.mode).toBe('local')
    expect(copy.checkoutDir).toBe(elsewhere)
    expect(copy.evidence.disagreement).toBe(true)
    expect(copy.profile).toBe(path.basename(declared))
  })

  it('a host without the installation service keeps the command but applies nothing', () => {
    const profile = installedProfile('^1.0.0')
    const copy = runningCopyOf(fakeCtx({ profileContext: { name: 'web', dir: profile.dir } }), profile.self)
    expect(copy.plan.apply).toBe('none')
    expect(copy.plan.steps.map(step => step.command)).toEqual(['dsh'])
  })
})

describe('registryOrderOf', () => {
  it('asks the profile\'s own plan first, then the public pair, without repeats', () => {
    expect(registryOrderOf({
      resolved: 'https://mirror.internal/npm/',
      registry: 'https://registry.npmmirror.com/',
      fallbackRegistries: ['https://registry.npmjs.org/', 'https://mirror.internal/npm/'],
    })).toEqual([
      'https://mirror.internal/npm/',
      'https://registry.npmmirror.com/',
      'https://registry.npmjs.org/',
    ])
  })

  it('a host that reports no plan still asks the public pair', () => {
    expect(registryOrderOf(undefined)).toEqual([...PUBLIC_REGISTRIES])
  })

  it('a null registry means pnpm decides, and is never asked as a URL', () => {
    expect(registryOrderOf({ registry: null, resolved: 'https://npm.corp/' }))
      .toEqual(['https://npm.corp/', ...PUBLIC_REGISTRIES])
  })
})

describe('readLatest', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  /** A context whose installation service reports one registry plan. */
  function ctxOf(plan: unknown): Context {
    return fakeCtx({ pluginManager: { registries: async () => plan } })
  }

  /** Stub fetch with a table of answers, recording every URL asked. */
  function answerWith(answers: Array<{ url: string; body?: unknown; status?: number }>): string[] {
    const asked: string[] = []
    vi.stubGlobal('fetch', async (url: unknown) => {
      asked.push(String(url))
      const match = answers.find(one => String(url).startsWith(one.url))
      if (match === undefined) return new Response('{}', { status: 404 })
      return new Response(JSON.stringify(match.body ?? {}), { status: match.status ?? 200 })
    })
    return asked
  }

  it('asks its own registry first and stops at the first answer', async () => {
    // The reader this replaces asked `registry.npmjs.org` and nothing else, so a
    // reader behind a mirror — the very reader who chose that mirror when
    // installing — got a failed check instead of an answer.
    const asked = answerWith([
      { url: 'https://mirror.internal/', body: { 'dist-tags': { latest: '1.2.0' } } },
      { url: 'https://registry.npmjs.org/', body: { 'dist-tags': { latest: '9.9.9' } } },
    ])
    const latest = await readLatest(ctxOf({ resolved: 'https://mirror.internal/npm/' }), { mode: 'npm' })
    expect(latest).toEqual({
      version: '1.2.0',
      source: 'registry',
      registry: 'https://mirror.internal/npm/',
    })
    expect(asked).toEqual([`https://mirror.internal/npm/${PKG.replace('/', '%2F')}`])
  })

  it('moves on when a registry answers without the package, and names who answered', async () => {
    const asked = answerWith([
      { url: 'https://registry.npmjs.org/', body: { 'dist-tags': {} } },
      { url: 'https://registry.npmmirror.com/', body: { 'dist-tags': { latest: '1.2.0' } } },
    ])
    const latest = await readLatest(ctxOf(undefined), { mode: 'npm' })
    expect(latest?.registry).toBe('https://registry.npmmirror.com/')
    expect(asked).toHaveLength(2)
  })

  it('no registry answering is absent, never "up to date"', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline') })
    expect(await readLatest(ctxOf(undefined), { mode: 'npm' })).toBeUndefined()
  })

  it('a repository install reads the version its default branch declares', async () => {
    const asked = answerWith([
      { url: 'https://raw.githubusercontent.com/', body: { version: '1.3.0' } },
    ])
    const latest = await readLatest(fakeCtx({}), { mode: 'github' })
    expect(latest).toEqual({ version: '1.3.0', source: 'repository' })
    expect(asked).toEqual(['https://raw.githubusercontent.com/FiretrUCK666/dsh-task-board/HEAD/package.json'])
  })

  it('a checkout has nothing to read here: its own git state answers instead', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('must not be asked') })
    expect(await readLatest(fakeCtx({}), { mode: 'local' })).toBeUndefined()
  })
})

describe('installedVersionIn', () => {
  it('reads the installed copy inside a profile', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-tb-version-'))
    const installed = path.join(dir, 'node_modules', ...PKG.split('/'))
    fs.mkdirSync(installed, { recursive: true })
    fs.writeFileSync(path.join(installed, 'package.json'), JSON.stringify({ version: '0.9.58' }))
    try {
      expect(installedVersionIn(dir)).toBe('0.9.58')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('reads a checkout manifest, and an unreadable directory as nothing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-tb-version-'))
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '0.9.58' }))
    try {
      expect(installedVersionIn(dir)).toBe('0.9.58')
      expect(installedVersionIn(path.join(dir, 'nope'))).toBeUndefined()
      expect(installedVersionIn(undefined)).toBeUndefined()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
