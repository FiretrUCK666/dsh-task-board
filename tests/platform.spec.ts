/**
 * Platform adapter contract: `buildApi` must wire every domain face method to
 * the EXACT alpha.3 host Remote endpoint it was verified against (the Typert
 * manifests that ship with the host) — a wrong endpoint is not a config
 * error, it is a runtime TypeError. These tests pin the wiring so a host
 * upgrade that renames an endpoint surfaces here, not in the browser.
 *
 * Verified host endpoints (dsh 0.1.2-alpha.3):
 *   session/attachment | session/create | session/follow | session/modelCatalog
 *   session/prompt | session/rename | session/selectModel
 *   skills/list | agentPresets/list | agentPresets/select
 */
import { describe, expect, it, vi } from 'vitest'
import {
  buildApi,
  sessionDriverOf,
  type ApiFace,
  type ClientContext,
  type BoundSessionFace,
  type FollowFrame,
} from '../src/client/platform.ts'

interface Call {
  ns: string
  method: string
  args: unknown[]
}

/** Canned remote responses keyed by `ns.method`; functions receive the call args. */
type StubTable = Record<string, unknown>

function fakeApi(stubs: StubTable = {}): { ctx: ClientContext; api: ApiFace; calls: Call[] } {
  const calls: Call[] = []
  const named = (ns: string) => (method: string) => (...args: unknown[]): unknown => {
    calls.push({ ns, method, args })
    const stub = stubs[`${ns}.${method}`]
    if (stub === undefined) return Promise.resolve({ ok: true, value: {} })
    if (typeof stub === 'function') return (stub as (...a: unknown[]) => unknown)(...args)
    return Promise.resolve(stub)
  }
  const session = {
    prompt: named('session')('prompt'),
    selectModel: named('session')('selectModel'),
    create: named('session')('create'),
    rename: named('session')('rename'),
    attachment: named('session')('attachment'),
    modelCatalog: named('session')('modelCatalog'),
    follow: named('session')('follow'),
    page: named('session')('page'),
  }
  const skills = { list: named('skills')('list') }
  const agentPresets = { list: named('agentPresets')('list'), select: named('agentPresets')('select') }
  const fileUploads = { upload: named('fileUploads')('upload') }
  const sessions = {
    list: { getSnapshot: () => ({ ids: [], byId: {}, current: undefined, phase: 'pending' as const }), subscribe: () => () => {} },
    create: vi.fn(async () => 'sess-fresh'),
    open: vi.fn(),
    binding: vi.fn(() => undefined),
  }
  const ctx = {
    effect: () => {},
    get: (name: string) => {
      if (name === 'remote.session') return session
      if (name === 'remote.skills') return skills
      if (name === 'remote.agentPresets') return agentPresets
      if (name === 'remote.fileUploads') return fileUploads
      return undefined
    },
    locale: { register: () => {} },
    slots: { inject: () => () => {}, register: () => {} },
    sessions,
    workspaces: {
      list: { getSnapshot: () => ({ items: [], archivedSessionIds: [], recentWorkspaceId: undefined }), subscribe: () => () => {} },
      connectWorkspace: vi.fn(),
    },
    connection: { rpc: { call: named('connection')('call') } },
  } as unknown as ClientContext
  return { ctx, api: buildApi(ctx), calls }
}

describe('buildApi endpoint wiring', () => {
  it('prompt routes to session/prompt with the official request shape', async () => {
    const { api, calls } = fakeApi()
    const result = await api.sessions.prompt({
      sessionId: 's1' as never,
      mode: 'queue',
      content: [{ type: 'text', text: 'hello' }],
    })
    expect(calls[0]).toMatchObject({ ns: 'session', method: 'prompt' })
    const request = calls[0].args[0] as Record<string, unknown>
    expect(request.sessionId).toBe('s1')
    expect(request.mode).toBe('queue')
    expect(request.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(typeof request.requestId).toBe('string')
    expect(result.result.ok).toBe(true)
  })

  it('selectModel routes to session/selectModel', async () => {
    const { api, calls } = fakeApi()
    await api.sessions.selectModel({
      sessionId: 's1' as never,
      provider: 'deepseek',
      model: 'deepseek-v4',
      reasoningEffort: 'high',
    })
    expect(calls[0]).toMatchObject({ ns: 'session', method: 'selectModel' })
    expect(calls[0].args[0]).toMatchObject({ sessionId: 's1', provider: 'deepseek', model: 'deepseek-v4', reasoningEffort: 'high' })
  })

  it('create routes through the sessions object layer, not a wire endpoint', async () => {
    const { api, ctx, calls } = fakeApi()
    const result = await api.sessions.create({ workspaceId: 'w1' as never })
    expect(calls).toHaveLength(0)
    expect(ctx.sessions.create).toHaveBeenCalledWith({ workspaceId: 'w1' })
    expect(result.result).toEqual({ ok: true, value: { sessionId: 'sess-fresh' } })
  })

  it('rename routes to session/rename', async () => {
    const { api, calls } = fakeApi()
    await api.sessions.rename({ sessionId: 's1' as never, title: 'New title' })
    expect(calls[0]).toMatchObject({ ns: 'session', method: 'rename' })
    expect(calls[0].args[0]).toEqual({ sessionId: 's1', title: 'New title' })
  })

  it('attachment routes to session/attachment', async () => {
    const { api, calls } = fakeApi()
    await api.sessions.attachment({ sessionId: 's1' as never, attachmentId: 'att-1' })
    expect(calls[0]).toMatchObject({ ns: 'session', method: 'attachment' })
    expect(calls[0].args[0]).toEqual({ sessionId: 's1', attachmentId: 'att-1' })
  })

  it('models routes to session/modelCatalog and maps default -> current', async () => {
    const { api, calls } = fakeApi({
      'session.modelCatalog': {
        ok: true,
        value: {
          default: { provider: 'deepseek', model: 'deepseek-v4', reasoningEffort: 'high' },
          groups: [{ id: 'deepseek', models: [{ id: 'deepseek-v4', name: 'V4', reasoning: { efforts: [{ id: 'high', name: 'High' }] } }] }],
        },
      },
    })
    const response = await api.sessions.models({ sessionId: 's1' as never })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ ns: 'session', method: 'modelCatalog' })
    expect(calls[0].args).toHaveLength(0)
    expect(response.result.ok).toBe(true)
    if (!response.result.ok) return
    expect(response.result.value.current).toEqual({ provider: 'deepseek', model: 'deepseek-v4', reasoningEffort: 'high' })
    expect(response.result.value.groups).toHaveLength(1)
  })

  it('history consumes the one-shot follow snapshot (records + hasMore + projections)', async () => {
    const frames: FollowFrame[] = [
      { type: 'snapshot', cursor: 9, hasMore: true, records: [{ type: 'event', event: { type: 'turn/start', data: null, seq: 8 } }, { type: 'event', event: { type: 'turn/end', data: null, seq: 9 } }], projections: { asOfSeq: 9, values: { contextPressure: { pressureTokens: 100 } } } },
    ]
    const { api, calls } = fakeApi({
      'session.follow': async function* (): AsyncGenerator<FollowFrame> {
        for (const frame of frames) yield frame
      },
    })
    const response = await api.sessions.history({ sessionId: 's1' as never, maxMessages: 20 })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ ns: 'session', method: 'follow' })
    const request = calls[0].args[0] as Record<string, unknown>
    expect(request.address).toEqual({ kind: 'session', sessionId: 's1' })
    expect(request.maxMessages).toBe(20)
    expect(response.result.ok).toBe(true)
    if (!response.result.ok) return
    expect(response.result.value.events.map(entry => entry.event)).toEqual([
      { type: 'turn/start', data: null, seq: 8 },
      { type: 'turn/end', data: null, seq: 9 },
    ])
    expect(response.result.value.hasMore).toBe(true)
    expect(response.result.value.floorSeq).toBe(8)
    expect(response.result.value.projections?.values).toEqual({ contextPressure: { pressureTokens: 100 } })
  })

  it('page routes to session/page with the backward window (beforeSeq + maxMessages)', async () => {    const { api, calls } = fakeApi({
      'session.page': {
        ok: true,
        value: {
          records: [{ type: 'event', event: { type: 'user/message', seq: 3 } }],
          hasMore: false,
        },
      },
    })
    const response = await api.sessions.page({ sessionId: 's1' as never, beforeSeq: 9, maxMessages: 50 })
    expect(calls[0]).toMatchObject({ ns: 'session', method: 'page' })
    expect(calls[0].args[0]).toEqual({
      address: { kind: 'session', sessionId: 's1' },
      beforeSeq: 9,
      maxMessages: 50,
    })
    expect(response.result.ok).toBe(true)
    if (!response.result.ok) return
    expect(response.result.value.hasMore).toBe(false)
    expect(response.result.value.floorSeq).toBe(3)
  })

  it('history reports a stream failure as a failed result, never a throw', async () => {
    const { api } = fakeApi({
      'session.follow': async function* (): AsyncGenerator<FollowFrame> {
        throw { code: 'gateway/internal', message: 'log cut unavailable' }
      },
    })
    const response = await api.sessions.history({ sessionId: 's1' as never, maxMessages: 5 })
    expect(response.result.ok).toBe(false)
    if (response.result.ok) return
    expect(response.result.error.code).toBe('gateway/internal')
  })

  it('skills routes to skills/list with the session id', async () => {
    const { api, calls } = fakeApi()
    await api.skills.list({ sessionId: 's1' as never })
    expect(calls[0]).toMatchObject({ ns: 'skills', method: 'list' })
    expect(calls[0].args[0]).toEqual({ sessionId: 's1' })
  })

  it('agentPresets.list calls the endpoint with NO arguments', async () => {
    const { api, calls } = fakeApi()
    await api.agentPresets.list({})
    expect(calls[0]).toMatchObject({ ns: 'agentPresets', method: 'list' })
    expect(calls[0].args).toHaveLength(0)
  })

  it('agentPresets.select calls the endpoint positionally (sessionId, preset)', async () => {
    const { api, calls } = fakeApi()
    await api.agentPresets.select({ sessionId: 's1' as never, agentPreset: 'deploy-default' })
    expect(calls[0]).toMatchObject({ ns: 'agentPresets', method: 'select' })
    expect(calls[0].args).toEqual(['s1', 'deploy-default'])
  })

  it('fileUploads.upload stages exact bytes on the session and returns the receipt', async () => {
    const { api, calls } = fakeApi({
      'fileUploads.upload': { ok: true, value: { receiptId: 'rcpt-1', file: { attachmentId: 'a', name: 'a.pdf', bytes: 10 } } },
    })
    const response = await api.fileUploads.upload({ sessionId: 's1' as never, data: 'QUJD', name: 'a.pdf' })
    expect(calls[0]).toMatchObject({ ns: 'fileUploads', method: 'upload' })
    expect(calls[0].args[0]).toBe('s1')
    expect(calls[0].args[1]).toEqual({ data: 'QUJD', name: 'a.pdf' })
    expect(response.result.ok).toBe(true)
    if (!response.result.ok) return
    expect(response.result.value.receiptId).toBe('rcpt-1')
  })

  it('fileUploads.upload rejects an empty receipt as a named failure, never a pass-through', async () => {
    const { api } = fakeApi({
      'fileUploads.upload': { ok: true, value: { receiptId: '' } },
    })
    const response = await api.fileUploads.upload({ sessionId: 's1' as never, data: 'QUJD' })
    expect(response.result.ok).toBe(false)
  })

  it('reports a missing remote method as a named unavailable result, not a crash', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    // A context whose get() resolves no namespace: every method degrades.
    const api = buildApi({
      ...fakeApi().ctx,
      get: () => undefined,
    } as unknown as ClientContext)
    const response = await api.sessions.models({})
    expect(response.result.ok).toBe(false)
    if (response.result.ok) return
    expect(response.result.error.code).toBe('remote/unavailable')
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('session.modelCatalog'),
    )
    error.mockRestore()
  })

  it('warns the named endpoint when a remote call returns a failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { api } = fakeApi({
      'session.modelCatalog': {
        ok: false,
        error: { code: 'gateway/invocation-unavailable', message: 'no active Remote method exports this endpoint' },
      },
    })
    const response = await api.sessions.models({})
    expect(response.result.ok).toBe(false)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('session.modelCatalog failed -> gateway/invocation-unavailable'),
    )
    warn.mockRestore()
  })

  it('respond is a degraded stub: warns and never accepts', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { api } = fakeApi()
    await expect(api.respond({} as never)).resolves.toEqual({ accepted: false })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('sessionDriverOf', () => {
  type Snap = { running: boolean; lastAgentError: string | null; awaitingFirstTurn?: boolean }

  function fakeSession(initial: Snap): { session: BoundSessionFace; notify(snapshot: Snap): void } {
    let current: Snap = initial
    const listeners = new Set<() => void>()
    const session: BoundSessionFace = {
      prompt: vi.fn(async () => ({ ok: true as const, value: { accepted: true as const } })),
      rename: vi.fn(async () => ({ ok: true as const })),
      command: vi.fn(async () => ({ ok: true as const, value: { matched: true } })),
      getSnapshot: () => current,
      subscribe: fn => {
        listeners.add(fn)
        return () => { listeners.delete(fn) }
      },
    }
    return {
      session,
      notify: snapshot => {
        current = snapshot
        for (const listener of [...listeners]) listener()
      },
    }
  }

  it('derives exactly one turn end from the blank-session first-turn edge', () => {
    const { session, notify } = fakeSession({ running: false, lastAgentError: null, awaitingFirstTurn: true })
    const { driver, dispose } = sessionDriverOf(session)
    expect(driver.getSnapshot().turnEnds.size).toBe(0)
    notify({ running: true, lastAgentError: null, awaitingFirstTurn: false })
    expect(driver.getSnapshot().turnEnds.size).toBe(0)
    notify({ running: false, lastAgentError: null })
    expect(driver.getSnapshot().turnEnds.size).toBe(1)
    expect(driver.getSnapshot().lastAgentError).toBeNull()
    dispose()
  })

  it('never fabricates a turn end for reused sessions (conservative fallback)', () => {
    const { session, notify } = fakeSession({ running: false, lastAgentError: null })
    const { driver, dispose } = sessionDriverOf(session)
    notify({ running: true, lastAgentError: null })
    notify({ running: false, lastAgentError: null })
    expect(driver.getSnapshot().turnEnds.size).toBe(0)
    dispose()
  })
})