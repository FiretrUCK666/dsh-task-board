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
  }
  const sessions = {
    list: { getSnapshot: () => ({ ids: [], byId: {}, current: undefined, phase: 'pending' as const }), subscribe: () => () => {} },
    create: vi.fn(async () => 'sess-fresh'),
    open: vi.fn(),
    binding: vi.fn(() => undefined),
  }
  const ctx = {
    effect: () => {},
    get: () => undefined,
    locale: { register: () => {} },
    slots: { inject: () => () => {}, register: () => {} },
    sessions,
    workspaces: {
      list: { getSnapshot: () => ({ items: [], archivedSessionIds: [], recentWorkspaceId: undefined }), subscribe: () => () => {} },
      connectWorkspace: vi.fn(),
    },
    remote: { session, skills: { list: named('skills')('list') }, agentPresets: { list: named('agentPresets')('list'), select: named('agentPresets')('select') } },
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

  it('history consumes the one-shot follow snapshot (records + projections)', async () => {
    const frames: FollowFrame[] = [
      { type: 'snapshot', cursor: 9, hasMore: false, records: [{ type: 'event', event: { type: 'turn/start', data: null } }, { type: 'event', event: { type: 'turn/end', data: null } }], projections: { asOfSeq: 9, values: { contextPressure: { pressureTokens: 100 } } } },
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
      { type: 'turn/start', data: null },
      { type: 'turn/end', data: null },
    ])
    expect(response.result.value.projections?.values).toEqual({ contextPressure: { pressureTokens: 100 } })
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