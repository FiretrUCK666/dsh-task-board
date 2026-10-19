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

  it('reports the desktop profile\'s own npm install, and hands it no command', () => {
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
    // A packaged application's profile gets no terminal command: the CLI's
    // npm-installed shim rejects that profile name, only the application's own
    // shim accepts it, and the plan cannot tell which one a reader has.
    expect(copy.plan.steps).toEqual([])
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

  /**
   * 一条**按延迟与成败**作答的 feeder，记录每个 URL 被问了几次。
   *
   * `answerWith` 是瞬时答的，所以它看不见任何与「什么时候」有关的行为：整条链在
   * 1 毫秒内结束，`done()` 把 800ms 的定时器全清掉了，于是每个地址正好被问一次——
   * **哪怕实现里有一处会让同一个地址被问两次**。这一支要能看见「问了谁、几次、
   * 什么时候」，因为并发读的唯一真实缺陷就是这三样。
   * @param table - 每个前缀的作答方式：延迟（毫秒）与成败。
   * @returns 一个按 URL 记次数的记录器。
   */
  function timedFeeder(
    table: Array<{ url: string; afterMs: number; body?: unknown; fail?: true }>,
  ): { counts: Map<string, number>; order: string[] } {
    const counts = new Map<string, number>()
    const order: string[] = []
    vi.stubGlobal('fetch', async (url: unknown) => {
      const href = String(url)
      const match = table.find(one => href.startsWith(one.url))
      const key = match?.url ?? href
      counts.set(key, (counts.get(key) ?? 0) + 1)
      order.push(key)
      if (match === undefined) return new Response('{}', { status: 404 })
      if (match.afterMs > 0) await new Promise(done => setTimeout(done, match.afterMs))
      if (match.fail === true) throw new Error('network down')
      return new Response(JSON.stringify(match.body ?? {}), { status: 200 })
    })
    return { counts, order }
  }

  it('asks each public registry at most once, even when the first one fails fast', async () => {
    /* **这条钉的是一个真实发生过的缺陷。** 先失败的那一支既「立刻推进下一条」，
       又留着那个 800ms 的定时器；定时器到点时会把下一条**再启动一次**。
       后果不止是多一个请求：如果重复那一条先失败，而原来那一条还在飞，
       `finished >= candidates.length` 会把整次读取定成 `undefined` ——
       一个本来会作答的源，被报成「读不到」。 */
    const feeder = timedFeeder([
      { url: 'https://registry.npmjs.org/', afterMs: 20, fail: true },
      { url: 'https://registry.npmmirror.com/', afterMs: 900, body: { 'dist-tags': { latest: '2.0.0' } } },
    ])
    const latest = await readLatest(ctxOf(undefined), { mode: 'npm' })
    expect(latest?.version, '第二条源答了，读取却没有拿到它').toBe('2.0.0')
    for (const [url, times] of feeder.counts) {
      expect(times, `${url} 被问了 ${String(times)} 次：并发读不是「多问几遍」，多问一遍就可能把已到手的答案丢掉`).toBe(1)
    }
  })

  it('starts the next registry as soon as one fails, without waiting out the window', async () => {
    /* 失败要**立刻**推进，不是等窗口结束。等窗口意味着一条连不上的源会让读者白等
       800ms——而那 800ms 存在的理由是「这条可能只是慢」，不是「它坏了」。 */
    const started = Date.now()
    const feeder = timedFeeder([
      { url: 'https://registry.npmjs.org/', afterMs: 10, fail: true },
      { url: 'https://registry.npmmirror.com/', afterMs: 10, body: { 'dist-tags': { latest: '3.0.0' } } },
    ])
    const latest = await readLatest(ctxOf(undefined), { mode: 'npm' })
    const elapsed = Date.now() - started
    expect(latest?.version).toBe('3.0.0')
    expect(elapsed, `失败之后等了 ${String(elapsed)}ms 才推进——那 800ms 的窗口是给「慢」的源留的，不是给「坏」的`).toBeLessThan(400)
    expect(feeder.counts.size).toBe(2)
  })

  it('a slow first registry does not stop the second from answering within the window', async () => {
    /* 这一条是那次改动存在的全部理由：第一条正常但慢（真实的 npmjs 常在 1 秒上下），
       第二条（镜像）快。串行读要等到第一条的 8 秒上限，并发读只要窗口 + 第二条自己的时间。 */
    const started = Date.now()
    timedFeeder([
      { url: 'https://registry.npmjs.org/', afterMs: 5_000, body: { 'dist-tags': { latest: '4.0.0' } } },
      { url: 'https://registry.npmmirror.com/', afterMs: 100, body: { 'dist-tags': { latest: '5.0.0' } } },
    ])
    const latest = await readLatest(ctxOf(undefined), { mode: 'npm' })
    const elapsed = Date.now() - started
    expect(latest?.version, '快的那个源答了，读取却没有采信它').toBe('5.0.0')
    expect(latest?.registry).toBe('https://registry.npmmirror.com/')
    expect(elapsed, `第一条要 5 秒，读取却等了 ${String(elapsed)}ms——并发读没有生效`).toBeLessThan(2_500)
  })

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
    /* **先问 registry，再问仓库。** 这不是「多打几次网络」，是可达性问题：
       `raw.githubusercontent.com` 在部分网络下被切断（实测 ECONNRESET），而 registry 与
       `api.github.com` 都是 200。所以这条路的第一答案来自 registry；它答不上来时，
       `api.github.com` 的 contents 读同一份文件，raw 只是最后手段。
       下面把前三条都关掉、只留 raw，验证最后那一步仍然能答。 */
    const asked = answerWith([
      { url: 'https://raw.githubusercontent.com/', body: { version: '1.3.0' } },
    ])
    const latest = await readLatest(fakeCtx({}), { mode: 'github' })
    expect(latest).toEqual({ version: '1.3.0', source: 'repository' })
    /* 顺序是契约的一部分：registry 两条 → GitHub API → raw。 */
    expect(asked).toEqual([
      'https://registry.npmjs.org/@firetruck666%2Fdsh-task-board',
      'https://registry.npmmirror.com/@firetruck666%2Fdsh-task-board',
      'https://api.github.com/repos/FiretrUCK666/dsh-task-board/contents/package.json',
      'https://raw.githubusercontent.com/FiretrUCK666/dsh-task-board/HEAD/package.json',
    ])
  })

  it('raw 不可达时检查仍然给出答案（读者报的正是这件事）', async () => {
    /* 钉住「一条路被切断不等于检查失败」：registry 与 raw 都失败，只有 API 通，
       结果必须来自 API 而不是 undefined。 */
    vi.stubGlobal('fetch', async (url: string) => {
      const u = String(url)
      if (u.includes('registry.')) return { ok: false, json: async () => ({}) } as unknown as Response
      if (u.includes('api.github.com')) return { ok: true, json: async () => ({ version: '1.3.9' }) } as unknown as Response
      throw new Error('raw is unreachable on this network')
    })
    const latest = await readLatest(fakeCtx({}), { mode: 'github' })
    expect(latest).toEqual({ version: '1.3.9', source: 'repository' })
  })

  it('判定不了装法的拷贝也去问一次，不再直接报失败', async () => {
    /* 原先 `unknown` 直接 `return undefined`，于是「不知道自己是哪种装法」等于
       「永远检查失败」——而那恰恰是最需要一次答案的情形。 */
    const asked = answerWith([
      { url: 'https://registry.npmmirror.com/', body: { versions: {}, 'dist-tags': { latest: '2.0.0' } } },
    ])
    const latest = await readLatest(fakeCtx({}), { mode: 'unknown' })
    expect(latest?.version).toBe('2.0.0')
    expect(asked.length).toBeGreaterThan(0)
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
