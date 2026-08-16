/**
 * Pure tests for the settings route processor (`createSettingsHandler`) with
 * faked describe/mutate deps and fake HTTP req/res pairs. Covers GET found and
 * not-found, POST set/unset, and the mutate-throw → {ok:false} envelope.
 */

import { describe, expect, it } from 'vitest'
import { createSettingsHandler, readJsonBody, type SettingsRouteDeps } from '../src/host/settings-route.ts'
import type { SettingsDescriptor } from '@deepseek-ai/dsh-settings'
/** A fake response capturing the written status and body. */
function fakeRes(): import('node:http').ServerResponse & { state: { status: number; body: string } } {
  const state = { status: 200, body: '' }
  return {
    state,
    writeHead(status: number) { state.status = status },
    end(payload: string) { state.body = payload },
  } as unknown as import('node:http').ServerResponse & { state: { status: number; body: string } }
}

/** A fake request stream yielding one JSON chunk. */
function fakeReq(method: string, body?: unknown, contentType = 'application/json') {
  let sent = false
  const request = {
    method,
    headers: { 'content-type': contentType },
    url: '/api/dsh-task-board/settings',
    [Symbol.asyncIterator]() {
      return {
        next: () => {
          if (sent) return Promise.resolve({ done: true as const, value: undefined })
          sent = true
          return Promise.resolve({ done: false as const, value: Buffer.from(body === undefined ? '' : JSON.stringify(body)) })
        },
      }
    },
  }
  return request as unknown as import('node:http').IncomingMessage
}

/** A fake deps face that also records the mutate calls it received. */
type FakeDescriptor = { ns: string; value: unknown; base?: unknown; user?: unknown; revision: number }
function fakeDeps(initial: FakeDescriptor[], writable = true) {
  const descriptors = [...initial] as SettingsDescriptor[]
  const mutateCalls: Array<{ ns: string; ops: unknown[]; expectedRevision?: number }> = []
  let mutateImpl: (ns: string, ops: unknown[], expectedRevision?: number) => Promise<unknown> =
    async (ns, ops) => { mutateCalls.push({ ns, ops }); return undefined }
  const deps: SettingsRouteDeps & { calls: typeof mutateCalls; setMutate: (f: typeof mutateImpl) => void } = {
    describe: () => descriptors,
    mutate: async (ns, ops, expectedRevision) => {
      const entry = descriptors.find(d => d.ns === ns)
      if (entry === undefined) return null
      const call: { ns: string; ops: unknown[]; expectedRevision?: number } = { ns, ops }
      if (expectedRevision !== undefined) call.expectedRevision = expectedRevision
      mutateCalls.push(call)
      return mutateImpl(ns, ops, expectedRevision)
    },
    writable,
    calls: mutateCalls,
    setMutate(f: typeof mutateImpl) { mutateImpl = f },
  }
  return deps
}

describe('createSettingsHandler', () => {
  it('GET returns the namespace view when registered', async () => {
    const deps = fakeDeps([
      { ns: 'dsh-task-board', value: { enabled: true, announceToAgent: true }, base: { enabled: true }, user: { enabled: true }, revision: 3 },
    ])
    const handler = createSettingsHandler(deps, 'dsh-task-board')
    const res = fakeRes()
    await handler(fakeReq('GET'), res)
    const envelope = JSON.parse(res.state.body)
    expect(envelope.ok).toBe(true)
    expect(envelope.value.available).toBe(true)
    expect(envelope.value.value).toEqual({ enabled: true, announceToAgent: true })
    expect(envelope.value.base).toEqual({ enabled: true })
    expect(envelope.value.user).toEqual({ enabled: true })
    expect(envelope.value.revision).toBe(3)
    expect(envelope.value.writable).toBe(true)
  })

  it('GET returns available:false when the namespace is unregistered', async () => {
    const deps = fakeDeps([])
    const handler = createSettingsHandler(deps, 'dsh-task-board')
    const res = fakeRes()
    await handler(fakeReq('GET'), res)
    const envelope = JSON.parse(res.state.body)
    expect(envelope.ok).toBe(true)
    expect(envelope.value.available).toBe(false)
  })

  it('GET reports writable:false when the host document is read-only', async () => {
    const deps = fakeDeps([{ ns: 'dsh-task-board', value: { enabled: true }, revision: 1 }], false)
    const handler = createSettingsHandler(deps, 'dsh-task-board')
    const res = fakeRes()
    await handler(fakeReq('GET'), res)
    const envelope = JSON.parse(res.state.body)
    expect(envelope.ok).toBe(true)
    expect(envelope.value.available).toBe(true)
    expect(envelope.value.writable).toBe(false)
  })

  it('POST applies a set op and returns the fresh view', async () => {
    const deps = fakeDeps([
      { ns: 'dsh-task-board', value: { enabled: false }, revision: 2 },
    ])
    // After mutate, advance the descriptor to the accepted value.
    deps.setMutate(async (ns, ops) => {
      const entry = deps.describe().find(d => d.ns === ns) as { ns: string; value: unknown; base?: unknown; user?: unknown; revision: number }
      const user = { ...((entry as { user?: Record<string, unknown> }).user) } as Record<string, unknown>
      for (const op of ops as Array<{ op: string; path: string[]; value?: unknown }>) {
        const field = op.path[0]
        if (op.op === 'set') user[field] = op.value
        else delete user[field]
      }
      entry.user = user
      entry.value = { ...(entry.value as Record<string, unknown>), ...user }
      entry.revision += 1
      return undefined
    })
    const handler = createSettingsHandler(deps, 'dsh-task-board')
    const res = fakeRes()
    await handler(fakeReq('POST', { ops: [{ op: 'set', path: ['enabled'], value: true }], expectedRevision: 2 }), res)
    expect(deps.calls).toHaveLength(1)
    expect(deps.calls[0].expectedRevision).toBe(2)
    const envelope = JSON.parse(res.state.body)
    expect(envelope.ok).toBe(true)
    expect(envelope.value.available).toBe(true)
    expect(envelope.value.value).toEqual({ enabled: true })
    expect(envelope.value.revision).toBe(3)
  })

  it('POST applies an unset op', async () => {
    const deps = fakeDeps([
      { ns: 'dsh-task-board', value: { enabled: true, announceToAgent: false }, user: { announceToAgent: false }, revision: 4 },
    ])
    deps.setMutate(async (ns, ops) => {
      const entry = deps.describe().find(d => d.ns === ns) as { ns: string; value: unknown; user?: unknown; revision: number }
      const user = { ...((entry.user as Record<string, unknown>) ?? {}) }
      for (const op of ops as Array<{ op: string; path: string[] }>) {
        if (op.op === 'unset') delete user[op.path[0]]
      }
      entry.user = user
      entry.value = { enabled: true }
      entry.revision += 1
      return undefined
    })
    const handler = createSettingsHandler(deps, 'dsh-task-board')
    const res = fakeRes()
    await handler(fakeReq('POST', { ops: [{ op: 'unset', path: ['announceToAgent'] }] }), res)
    expect(deps.calls).toHaveLength(1)
    expect(deps.calls[0].ops).toEqual([{ op: 'unset', path: ['announceToAgent'] }])
    expect(deps.calls[0].expectedRevision).toBeUndefined()
    const envelope = JSON.parse(res.state.body)
    expect(envelope.ok).toBe(true)
    expect(envelope.value.value).toEqual({ enabled: true })
  })

  it('returns {ok:false, error} when mutate throws', async () => {
    const deps = fakeDeps([{ ns: 'dsh-task-board', value: {}, revision: 1 }])
    deps.setMutate(async () => { throw new Error('SETTINGS_CONFLICT: revision moved') })
    const handler = createSettingsHandler(deps, 'dsh-task-board')
    const res = fakeRes()
    await handler(fakeReq('POST', { ops: [{ op: 'set', path: ['enabled'], value: true }] }), res)
    expect(res.state.status).toBe(200)
    const envelope = JSON.parse(res.state.body)
    expect(envelope.ok).toBe(false)
    expect(envelope.error.code).toBe('settings')
    expect(envelope.error.message).toContain('SETTINGS_CONFLICT')
  })

  it('rejects a mutating (non-GET, non-POST) method with 405', async () => {
    const deps = fakeDeps([])
    const handler = createSettingsHandler(deps, 'dsh-task-board')
    const res = fakeRes()
    await handler(fakeReq('DELETE'), res)
    expect(res.state.status).toBe(405)
  })

  it('readJsonBody parses a JSON stream', async () => {
    const body = await readJsonBody(fakeReq('POST', { ops: [] }))
    expect(body).toEqual({ ops: [] })
  })

  it('readJsonBody returns null on unparseable input', async () => {
    const req = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      [Symbol.asyncIterator]() {
        return { next: () => Promise.resolve({ done: false as const, value: Buffer.from('not json') }) }
      },
    } as unknown as import('node:http').IncomingMessage
    expect(await readJsonBody(req)).toBeNull()
  })
})
