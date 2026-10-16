/**
 * Browser update-source readers (src/client/update-source.ts): the host view
 * passes through shape-guarded — including where the copy runs from, the
 * evidence behind that, and the newest upstream the host read — an apply answer
 * parses into its outcome, and every failure (HTTP error, hang, malformed body,
 * old host without the route) degrades to `undefined` (inline retry, never a
 * crash).
 *
 * The published latest is NOT fetched here any more; it travels in the same
 * view, because only the host knows which registry this profile uses.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyUpdate, fetchUpdateSource } from '../src/client/update-source.ts'

afterEach(() => { vi.unstubAllGlobals() })

/** Stub fetch with one canned JSON answer. */
function answerJson(payload: unknown, status = 200): void {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  }))
}

/** Stub fetch with a hang until aborted (dead tunnel, half-open proxy). */
function hangFetch(): void {
  vi.stubGlobal('fetch', (_url: unknown, init?: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      reject(new DOMException('aborted', 'AbortError'))
    })
  }))
}

/** The plan the host serves for one install mode. */
function planOf(mode: 'npm' | 'github' | 'local' | 'unknown'): Record<string, unknown> {
  return {
    mode,
    packageName: '@firetruck666/dsh-task-board',
    profile: 'web',
    appManaged: false,
    ...(mode === 'npm' ? { packageSpec: '@firetruck666/dsh-task-board@latest' } : {}),
    apply: mode === 'npm' ? 'package' : mode === 'local' ? 'checkout' : 'none',
    steps: mode === 'npm'
      ? [{ command: 'dsh', args: ['plugin', '--profile', 'web', 'add', '@firetruck666/dsh-task-board@latest'] }]
      : [],
  }
}

describe('fetchUpdateSource', () => {
  it('passes a well-formed host view through, newest upstream included', async () => {
    answerJson({
      ok: true,
      value: {
        packageName: '@firetruck666/dsh-task-board',
        version: '0.2.81',
        spec: 'link:/repo',
        mode: 'local',
        profile: 'web',
        dir: '/home/u/.dsh/profiles/web',
        appManaged: false,
        evidence: { linked: true, declared: true, disagreement: false },
        githubSpec: 'github:FiretrUCK666/dsh-task-board',
        plan: planOf('local'),
        latest: {
          version: '0.2.82',
          publishedAt: '2026-09-11T10:00:00.000Z',
          registry: 'https://registry.npmmirror.com/',
          source: 'registry',
        },
        git: { head: 'aaa', remoteHead: 'bbb', dirty: true },
      },
    })
    expect(await fetchUpdateSource(1_000)).toEqual({
      packageName: '@firetruck666/dsh-task-board',
      version: '0.2.81',
      spec: 'link:/repo',
      mode: 'local',
      profile: 'web',
      dir: '/home/u/.dsh/profiles/web',
      appManaged: false,
      evidence: { linked: true, declared: true, disagreement: false },
      githubSpec: 'github:FiretrUCK666/dsh-task-board',
      plan: {
        mode: 'local',
        packageName: '@firetruck666/dsh-task-board',
        profile: 'web',
        appManaged: false,
        apply: 'checkout',
        steps: [],
      },
      latest: {
        version: '0.2.82',
        publishedAt: '2026-09-11T10:00:00.000Z',
        registry: 'https://registry.npmmirror.com/',
        source: 'registry',
      },
      git: { head: 'aaa', remoteHead: 'bbb', dirty: true },
    })
  })

  it('an unreadable newest upstream is absent, not invented', async () => {
    // The whole point of the three-state verdict: a host that could not read
    // the registry must not arrive as "already newest".
    answerJson({
      ok: true,
      value: {
        packageName: '@firetruck666/dsh-task-board',
        version: '0.2.81',
        mode: 'npm',
        plan: planOf('npm'),
      },
    })
    const view = await fetchUpdateSource(1_000)
    expect(view?.latest).toBeUndefined()
    expect(view?.evidence).toBeUndefined()
    expect(view?.dir).toBeUndefined()
  })

  it('a malformed newest-upstream answer is dropped whole', async () => {
    answerJson({
      ok: true,
      value: {
        packageName: '@firetruck666/dsh-task-board',
        version: '0.2.81',
        mode: 'npm',
        plan: planOf('npm'),
        latest: { publishedAt: '2026-09-11T10:00:00.000Z', source: 'registry' },
      },
    })
    expect((await fetchUpdateSource(1_000))?.latest).toBeUndefined()
  })

  it('drops malformed envelopes and HTTP errors to undefined', async () => {
    answerJson({ ok: true, value: { version: '0.2.81' } })
    expect(await fetchUpdateSource(1_000)).toBeUndefined()
    answerJson({ ok: false, error: { code: 'x', message: 'y' } })
    expect(await fetchUpdateSource(1_000)).toBeUndefined()
    answerJson({}, 404)
    expect(await fetchUpdateSource(1_000)).toBeUndefined()
  })

  it('a view without a plan this bundle understands is dropped whole', async () => {
    answerJson({
      ok: true,
      value: {
        packageName: '@firetruck666/dsh-task-board',
        version: '0.2.81',
        mode: 'npm',
        plan: { mode: 'npm', apply: 'something-new', steps: [] },
      },
    })
    expect(await fetchUpdateSource(1_000)).toBeUndefined()
  })

  it('a hanging host resolves undefined within the timeout', async () => {
    hangFetch()
    const started = Date.now()
    expect(await fetchUpdateSource(30)).toBeUndefined()
    expect(Date.now() - started).toBeLessThan(5_000)
  })
})

describe('applyUpdate', () => {
  it('POSTs to the update route and carries no installation target of its own', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), ...(init !== undefined ? { init } : {}) })
      return new Response(JSON.stringify({
        ok: true,
        value: { ok: true, outcome: 'applied', version: '0.9.60' },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    expect(await applyUpdate(1_000)).toEqual({ ok: true, outcome: 'applied', version: '0.9.60' })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toContain('api/dsh-task-board/update')
    expect(calls[0]?.init?.method).toBe('POST')
    expect(calls[0]?.init?.body).toBeUndefined()
  })

  it('keeps a refusal and its reason', async () => {
    answerJson({ ok: true, value: { ok: false, error: 'dirty', output: 'git: exit 1' } })
    expect(await applyUpdate(1_000)).toEqual({ ok: false, error: 'dirty', output: 'git: exit 1' })
  })

  it('carries the unchanged outcome through (it is not a success to be reshaped)', async () => {
    answerJson({ ok: true, value: { ok: true, outcome: 'unchanged', version: '1.1.0' } })
    expect(await applyUpdate(1_000)).toEqual({ ok: true, outcome: 'unchanged', version: '1.1.0' })
  })

  it('an outcome this version does not know is dropped, not guessed', async () => {
    answerJson({ ok: true, value: { ok: true, outcome: 'staged', version: '1.1.0' } })
    expect(await applyUpdate(1_000)).toEqual({ ok: true, version: '1.1.0' })
  })

  it('malformed answers and hangs degrade to undefined', async () => {
    answerJson({ ok: true, value: { application: 'applied' } })
    expect(await applyUpdate(1_000)).toBeUndefined()
    hangFetch()
    expect(await applyUpdate(30)).toBeUndefined()
  })
})
