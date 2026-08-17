/**
 * Tests for the route-backed settings scope with fetch mocked through
 * `vi.stubGlobal`. Covers the initial GET filling the snapshot, set/unset op
 * and revision mapping, adopting the response's fresh view with subscriber
 * notification, and a fetch failure degrading to an unavailable snapshot.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RouteSettingsScope } from '../src/client/route-scope.ts'

/** Build a fetch mock returning one envelope per configured URL. */
function mockFetch(get: (init: { url: string; method: string; body?: string }) => {
  ok: boolean
  envelope: unknown
  fail?: boolean
}) {
  const handler = vi.fn(async (url: unknown, init?: RequestInit) => {
    const input = get({
      url: String(url),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : undefined,
    })
    if (input.fail) throw new Error('network down')
    return {
      ok: input.ok,
      async json() { return input.envelope },
    } as unknown as Response
  })
  vi.stubGlobal('fetch', handler)
  return handler
}

/** One navigation microtask so the constructor's load() settles. */
function settle() {
  return new Promise<void>(resolve => { setImmediate(resolve) })
}

const NAMESPACE = 'dsh-task-board'

const READY_VIEW = {
  ok: true,
  value: {
    available: true,
    value: { enabled: true, announceToAgent: true },
    base: { enabled: true },
    user: { enabled: true },
    writable: true,
    revision: 3,
  },
}

beforeEach(() => {
  vi.useRealTimers()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('RouteSettingsScope', () => {
  it('fills the snapshot from the initial GET', async () => {
    const fetch = mockFetch(({ url, method }) => {
      expect(url).toBe('/api/dsh-task-board/settings')
      expect(method).toBe('GET')
      return { ok: true, envelope: READY_VIEW }
    })
    const scope = new RouteSettingsScope<{ enabled?: boolean; announceToAgent?: boolean }>(NAMESPACE)
    expect(scope.getSnapshot().status).toBe('loading')
    await settle()
    expect(fetch).toHaveBeenCalledTimes(1)
    const snapshot = scope.getSnapshot()
    expect(snapshot.status).toBe('ready')
    expect(snapshot.value).toEqual({ enabled: true, announceToAgent: true })
    expect(snapshot.base).toEqual({ enabled: true })
    expect(snapshot.user).toEqual({ enabled: true })
    expect(snapshot.revision).toBe(3)
    expect(snapshot.writable).toBe(true)
    scope.dispose()
  })

  it('set sends a set op with the expected revision and adopts the fresh view', async () => {
    const fetch = mockFetch(({ url, method, body }) => {
      if (method === 'GET') return { ok: true, envelope: READY_VIEW }
      expect(url).toBe('/api/dsh-task-board/settings')
      const parsed = JSON.parse(body ?? '{}')
      expect(parsed.ops).toEqual([{ op: 'set', path: ['enabled'], value: false }])
      expect(parsed.expectedRevision).toBe(3)
      return {
        ok: true,
        envelope: { ok: true, value: { ...READY_VIEW.value, value: { enabled: false, announceToAgent: true }, revision: 4 } },
      }
    })
    const scope = new RouteSettingsScope<{ enabled?: boolean; announceToAgent?: boolean }>(NAMESPACE)
    await settle()
    expect(scope.getSnapshot().status).toBe('ready')
    await scope.set('enabled', false)
    const snapshot = scope.getSnapshot()
    expect(snapshot.value?.enabled).toBe(false)
    expect(snapshot.revision).toBe(4)
    expect(fetch).toHaveBeenCalledTimes(2)
    scope.dispose()
  })

  it('unset sends an unset op without a value', async () => {
    const fetch = mockFetch(({ method, body }) => {
      if (method === 'GET') return { ok: true, envelope: READY_VIEW }
      const parsed = JSON.parse(body ?? '{}')
      expect(parsed.ops).toEqual([{ op: 'unset', path: ['announceToAgent'] }])
      expect(parsed.expectedRevision).toBe(3)
      return {
        ok: true,
        envelope: { ok: true, value: { ...READY_VIEW.value, value: { enabled: true }, user: {}, revision: 5 } },
      }
    })
    const scope = new RouteSettingsScope<{ enabled?: boolean; announceToAgent?: boolean }>(NAMESPACE)
    await settle()
    await scope.unset('announceToAgent')
    expect(scope.getSnapshot().value).toEqual({ enabled: true })
    expect(fetch).toHaveBeenCalledTimes(2)
    scope.dispose()
  })

  it('notifies subscribers when the response updates the snapshot', async () => {
    mockFetch(({ method }) => {
      if (method === 'GET') return { ok: true, envelope: READY_VIEW }
      return {
        ok: true,
        envelope: { ok: true, value: { ...READY_VIEW.value, value: { enabled: false, announceToAgent: true }, revision: 4 } },
      }
    })
    const scope = new RouteSettingsScope<{ enabled?: boolean; announceToAgent?: boolean }>(NAMESPACE)
    await settle()
    const notified: Array<'value' | 'revision'> = []
    scope.subscribe(() => {
      const s = scope.getSnapshot()
      notified.push(s.status === 'ready' ? 'revision' : 'value')
    })
    await scope.set('enabled', false)
    expect(notified.length).toBeGreaterThan(0)
    expect(scope.getSnapshot().value?.enabled).toBe(false)
    scope.dispose()
  })

  it('degrades to an unavailable snapshot when fetch rejects', async () => {
    const fetch = mockFetch(({ method }) => {
      if (method === 'GET') return { fail: true, ok: false, envelope: null }
      return { ok: false, envelope: null }
    })
    const scope = new RouteSettingsScope<{ enabled?: boolean }>(NAMESPACE)
    await settle()
    const snapshot = scope.getSnapshot()
    expect(snapshot.status).toBe('unavailable')
    expect(fetch).toHaveBeenCalledTimes(1)
    await scope.set('enabled', true)
    expect(scope.getSnapshot().status).toBe('unavailable')
    scope.dispose()
  })

  it('degrades to an unavailable snapshot when the GET returns a non-ok response', async () => {
    const fetch = mockFetch(() => ({ ok: false, envelope: null }))
    const scope = new RouteSettingsScope<{ enabled?: boolean }>(NAMESPACE)
    await settle()
    expect(scope.getSnapshot().status).toBe('unavailable')
    expect(fetch).toHaveBeenCalledTimes(1)
    scope.dispose()
  })
})
