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
import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  createUpdateHandler,
  installedVersionIn,
  runningCopyOf,
  type UpdateRouteDeps,
  type UpdateSourceView,
} from '../src/host/update-route.ts'
import { commandLineOf, updatePlanFor } from '../src/core/update-check.ts'
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

  /** One throwaway profile (or checkout) directory with a manifest. */
  function tempDir(manifest: Record<string, unknown>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-tb-update-'))
    roots.push(dir)
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(manifest))
    return dir
  }

  afterAll(() => {
    for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true })
  })

  it('reads the spec from the profile that is running, not from a named one', () => {
    // The defect: an npm install in the desktop profile was described with the
    // web profile's `link:` spec, so it reported "local development".
    const desktop = tempDir({ name: 'dsh-profile-desktop', dependencies: { [PKG]: '^0.8.26' } })
    const copy = runningCopyOf(fakeCtx({
      profileContext: { name: 'desktop', dir: desktop, packageManager: { command: 'app' } },
      pluginManager: {},
    }))
    expect(copy.mode).toBe('npm')
    expect(copy.profile).toBe('desktop')
    expect(copy.appManaged).toBe(true)
    expect(copy.plan.apply).toBe('package')
    // A packaged application owns its profile: the CLI refuses it, so no
    // terminal command is offered for it.
    expect(copy.plan.steps).toEqual([])
  })

  it('a link: checkout keeps its terminal command, built from its own profile name', () => {
    // The checkout's own markers decide the manager, so a pnpm checkout gets a
    // pnpm build even on a machine whose convention could have been npm.
    const checkout = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-tb-checkout-'))
    roots.push(checkout)
    fs.writeFileSync(path.join(checkout, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    const web = tempDir({ name: 'dsh-profile-web', dependencies: { [PKG]: `link:${checkout}` } })
    const copy = runningCopyOf(fakeCtx({ profileContext: { name: 'web', dir: web }, pluginManager: {} }))
    expect(copy.mode).toBe('local')
    expect(copy.appManaged).toBe(false)
    expect(copy.checkoutDir).toBe(checkout)
    expect(copy.plan.profile).toBe('web')
    expect(commandLineOf(copy.plan.steps)).toBe('git pull --ff-only && pnpm run build')
  })

  it('the profile name falls back to the directory it was loaded from', () => {
    const dir = tempDir({ dependencies: { [PKG]: '^1.0.0' } })
    const copy = runningCopyOf(fakeCtx({ profileContext: { dir } }))
    expect(copy.profile).toBe(path.basename(dir))
  })

  it('a host without a profile service still reads the launcher environment', () => {
    const dir = tempDir({ dependencies: { [PKG]: '^1.0.0' } })
    const previous = process.env.DSH_PROFILE_DIR
    process.env.DSH_PROFILE_DIR = dir
    try {
      const copy = runningCopyOf(fakeCtx({}))
      expect(copy.mode).toBe('npm')
      expect(copy.profile).toBe(path.basename(dir))
    } finally {
      if (previous === undefined) delete process.env.DSH_PROFILE_DIR
      else process.env.DSH_PROFILE_DIR = previous
    }
  })

  it('an unreadable copy reads as unknown and offers no command at all', () => {
    // No profile service and no launcher variable: nothing is observed, so
    // nothing is claimed. (The variable is cleared because this suite runs
    // inside a dsh process, which really does export it.)
    const previous = process.env.DSH_PROFILE_DIR
    delete process.env.DSH_PROFILE_DIR
    try {
      const copy = runningCopyOf(fakeCtx({}))
      expect(copy.mode).toBe('unknown')
      expect(copy.plan.apply).toBe('none')
      expect(copy.plan.steps).toEqual([])
      expect(copy.plan.profile).toBeUndefined()
    } finally {
      if (previous !== undefined) process.env.DSH_PROFILE_DIR = previous
    }
  })

  it('a host without the installation service keeps the command but applies nothing', () => {
    const dir = tempDir({ dependencies: { [PKG]: '^1.0.0' } })
    const copy = runningCopyOf(fakeCtx({ profileContext: { name: 'web', dir } }))
    expect(copy.plan.apply).toBe('none')
    expect(copy.plan.steps.map(step => step.command)).toEqual(['dsh'])
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
