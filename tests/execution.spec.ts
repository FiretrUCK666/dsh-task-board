/**
 * Execution-service tests: real dsh session driving — session creation,
 * prompt delivery, rename, and settlement from the watched snapshot.
 */
import { describe, expect, it } from 'vitest'
import { ExecutionService, type ExecutionEnvironment, type ExecutionEvent, type SessionDriver } from '../src/core/execution.ts'
import { createTask, startExecution } from '../src/core/tasks.ts'
const NOW = 1_700_000_000_000

/** Controllable SessionDriver fake. */
class FakeDriver implements SessionDriver {
  renameCalls: string[] = []
  promptCalls: unknown[] = []
  promptResult: { ok: true } | { ok: false; error: unknown } = { ok: true }
  commandCalls: string[] = []
  commandResult: { ok: true; value: { matched: boolean } } | { ok: false; error: unknown } = { ok: true, value: { matched: true } }
  private snapshot: { running: boolean; lastAgentError: string | null; turnEnds: ReadonlyMap<number, number> } = {
    running: false,
    lastAgentError: null,
    turnEnds: new Map(),
  }
  private listeners = new Set<() => void>()

  async rename(title: string): Promise<unknown> {
    this.renameCalls.push(title)
    return { ok: true, value: { title, seq: 1 } }
  }

  async prompt(content: unknown[], _mode: 'queue'): Promise<{ ok: true } | { ok: false; error: unknown }> {
    this.promptCalls.push(content)
    return this.promptResult
  }

  async command(line: string): Promise<{ ok: true; value: { matched: boolean } } | { ok: false; error: unknown }> {
    this.commandCalls.push(line)
    return this.commandResult
  }

  getSnapshot(): { running: boolean; lastAgentError: string | null; turnEnds: ReadonlyMap<number, number> } {
    return this.snapshot
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  setSnapshot(snapshot: { running: boolean; lastAgentError?: string | null; turns?: number }): void {
    const turns = new Map<number, number>()
    for (let i = 1; i <= (snapshot.turns ?? 0); i += 1) turns.set(i, i * 10)
    this.snapshot = { running: snapshot.running, lastAgentError: snapshot.lastAgentError ?? null, turnEnds: turns }
    for (const fn of [...this.listeners]) fn()
  }
}

/** Fake env: workspace list, session creation, and one driver per session id. */
function makeEnv(overrides: {
  recentWorkspaceId?: string | undefined
  items?: Array<{ workspaceId: string; sessionIds?: readonly string[] }>
  promptResult?: { ok: true } | { ok: false; error: unknown }
  commandResult?: { ok: true; value: { matched: boolean } } | { ok: false; error: unknown }
  sendCommand?: ExecutionEnvironment['sendCommand']
  commandGraceMs?: number
  /** Pre-register the workspace session as host-blank (reusable). "Session
   *  vanished" cases pass false so the id stays absent from the list. */
  blankSummary?: boolean
} = {}) {
  const drivers = new Map<string, FakeDriver>()
  const summaries = new Map<string, { running: boolean; blank?: boolean }>()
  const listListeners = new Set<() => void>()
  const createSessionCalls: string[] = []
  const makeDriver = (): FakeDriver => {
    const driver = new FakeDriver()
    if (overrides.promptResult !== undefined) driver.promptResult = overrides.promptResult
    if (overrides.commandResult !== undefined) driver.commandResult = overrides.commandResult
    return driver
  }
  // The default workspace owns its session (official sessionIds): the reuse
  // path hands the SAME driver back on every run, mirroring the real runtime
  // where the bound Session object is stable per host session. Reuse only
  // ever happens for a host-BLANK session, so the default summary carries
  // blank:true; a "session vanished" case opts out (blankSummary:false).
  drivers.set('s-1', makeDriver())
  if (overrides.blankSummary !== false) summaries.set('s-1', { running: false, blank: true })
  const env: ExecutionEnvironment = {
    ...overrides.commandGraceMs !== undefined ? { commandGraceMs: overrides.commandGraceMs } : {},
    sessions: {
      list: {
        getSnapshot: () => ({ phase: 'ready', byId: Object.fromEntries(summaries) }),
        subscribe: (fn: () => void): (() => void) => {
          listListeners.add(fn)
          return () => { listListeners.delete(fn) }
        },
      },
      binding: (id: string) => {
        const driver = drivers.get(id)
        return driver === undefined ? undefined : { session: driver }
      },
    },
    workspaces: {
      list: {
        getSnapshot: () => ({
          items: overrides.items ?? [{ workspaceId: 'ws-1', sessionIds: ['s-1'] }],
          recentWorkspaceId: overrides.recentWorkspaceId,
        }),
      },
    },
    createSession: async (workspaceId: string | undefined) => {
      createSessionCalls.push(workspaceId ?? '')
      const driver = makeDriver()
      drivers.set('s-1', driver)
      summaries.set('s-1', { running: false, blank: true })
      return 's-1'
    },
    ...overrides.sendCommand !== undefined ? { sendCommand: overrides.sendCommand } : {},
  }
  /** Flip the host-list summary of a session and notify every list subscriber. */
  const setSummary = (id: string, running: boolean): void => {
    summaries.set(id, { running })
    for (const fn of [...listListeners]) fn()
  }
  return { env, drivers, summaries, createSessionCalls, setSummary }
}

function sampleTask() {
  return createTask({ title: '写个脚本', description: '', prompt: '写一个 bash 脚本，打印 hello' }, NOW, 'task-1')
}

describe('ExecutionService.run', () => {
  it('creates a session in the recent workspace, sends the task prompt, and settles succeeded on turn completion', async () => {
    const { env, drivers, createSessionCalls } = makeEnv({ recentWorkspaceId: 'ws-recent' })
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { execution } = startExecution(task, NOW, 'exec-1')
    const events: string[] = []
    const promise = service.run(task, execution, event => { events.push(event.kind) })

    await promise
    expect(createSessionCalls).toEqual(['ws-recent'])
    expect(drivers.get('s-1')?.renameCalls).toEqual(['写个脚本'])
    expect(drivers.get('s-1')?.promptCalls).toEqual([[{ type: 'text', text: '写一个 bash 脚本，打印 hello' }]])
    expect(events).toEqual(['started'])

    // Turn starts…
    drivers.get('s-1')?.setSnapshot({ running: true, turns: 0 })
    // …and completes.
    drivers.get('s-1')?.setSnapshot({ running: false, turns: 1 })
    expect(events).toEqual(['started', 'settled'])
  })

  it('sends the task prompt WITH its persisted prompt images on every run', async () => {
    const { env, drivers } = makeEnv()
    const service = new ExecutionService(env)
    const task = {
      ...sampleTask(),
      promptImages: [{ mediaType: 'image/webp', data: 'QUJD', name: '参考.webp' }],
    }
    const { execution } = startExecution(task, NOW, 'exec-1')
    await service.run(task, execution, () => { /* no events under test */ })
    // The OFFICIAL parts order: text first, then the image part (temporary
    // bytes the host admits). A plain run takes the TASK's own images — this
    // is what makes scheduled/cruise/chain runs send the same picture.
    expect(drivers.get('s-1')?.promptCalls).toEqual([[
      { type: 'text', text: '写一个 bash 脚本，打印 hello' },
      { type: 'image', mediaType: 'image/webp', data: 'QUJD', name: '参考.webp' },
    ]])
  })

  it('a run-options image override replaces the task prompt images (refine answers)', async () => {
    const { env, drivers } = makeEnv()
    drivers.set('s-refine', new FakeDriver())
    const service = new ExecutionService(env)
    const task = {
      ...sampleTask(),
      promptImages: [{ mediaType: 'image/png', data: 'RkZG' }],
    }
    const { execution } = startExecution(task, NOW, 'exec-1')
    await service.run(task, execution, () => { /* ignore */ }, {
      prompt: '回答文本',
      sessionId: 's-refine',
      fresh: false,
      images: [{ mediaType: 'image/jpeg', data: 'QUJD' }],
    })
    expect(drivers.get('s-refine')?.promptCalls).toEqual([[
      { type: 'text', text: '回答文本' },
      { type: 'image', mediaType: 'image/jpeg', data: 'QUJD' },
    ]])
  })

  it('falls back to the task title when the prompt is blank', async () => {    const { env, drivers } = makeEnv()
    const service = new ExecutionService(env)
    const task = createTask({ title: '只是标题', description: '', prompt: '  ' }, NOW, 'task-2')
    const { execution } = startExecution(task, NOW, 'exec-1')
    const promise = service.run(task, execution, () => {})
    await promise
    expect(drivers.get('s-1')?.promptCalls[0]).toEqual([{ type: 'text', text: '只是标题' }])
  })

  it('settles failed when the agent reports an error', async () => {
    const { env, drivers } = makeEnv()
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { execution } = startExecution(task, NOW, 'exec-1')
    const events: Array<{ kind: string; outcome?: string; error?: string }> = []
    const promise = service.run(task, execution, event => { events.push(event) })
    await promise
    drivers.get('s-1')?.setSnapshot({ running: true })
    drivers.get('s-1')?.setSnapshot({ running: false, lastAgentError: '模型调用失败', turns: 1 })
    expect(events.at(-1)).toEqual({
      kind: 'settled', taskId: 'task-1', executionId: 'exec-1', outcome: 'failed', error: '模型调用失败',
    })
  })

  it('settles failed when the prompt is rejected', async () => {
    const { env } = makeEnv({ promptResult: { ok: false, error: { code: 'bad-request', message: 'nope' } } })
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { execution } = startExecution(task, NOW, 'exec-1')
    const events: Array<{ kind: string; outcome?: string; error?: string }> = []
    await service.run(task, execution, event => { events.push(event) })
    expect(events.at(-1)?.kind).toBe('settled')
    expect(events.at(-1)?.outcome).toBe('failed')
  })

  it('applies a task agent preset to the execution session before prompting', async () => {
    const { env, drivers } = makeEnv()
    const applied: Array<{ sessionId: string; agentPreset: string }> = []
    const service = new ExecutionService({
      ...env,
      selectAgentPreset: async (sessionId, agentPreset) => {
        applied.push({ sessionId, agentPreset })
        return { ok: true }
      },
    })
    const task = { ...sampleTask(), agentPreset: 'butler' }
    const { execution } = startExecution(task, NOW, 'exec-1')
    const events: string[] = []
    await service.run(task, execution, event => { events.push(event.kind) })
    expect(applied).toEqual([{ sessionId: 's-1', agentPreset: 'butler' }])
    // The prompt still went out after the preset switch.
    expect(drivers.get('s-1')?.promptCalls).toHaveLength(1)
    expect(events).toEqual(['started'])
  })

  it('settles failed when the agent preset switch is rejected', async () => {
    const { env, drivers } = makeEnv()
    const reported: Array<{ sessionId: string; preset: string }> = []
    const service = new ExecutionService({
      ...env,
      selectAgentPreset: async () => ({ ok: false as const, error: 'session already started' }),
      onAgentApplied: (sessionId, preset) => { reported.push({ sessionId, preset }) },
    })
    const task = { ...sampleTask(), agentPreset: 'butler' }
    const { execution } = startExecution(task, NOW, 'exec-1')
    const events: Array<{ kind: string; outcome?: string; error?: string }> = []
    await service.run(task, execution, event => { events.push(event) })
    expect(events.at(-1)).toMatchObject({ kind: 'settled', outcome: 'failed' })
    expect(events.at(-1)?.error).toContain('preset')
    // No prompt was sent to the session.
    expect(drivers.get('s-1')?.promptCalls).toHaveLength(0)
    // A rejected switch is never reported (the session kept its preset).
    expect(reported).toEqual([])
  })

  it('reports a successful preset switch (both run paths feed the ledger)', async () => {
    const { env } = makeEnv()
    const reported: Array<{ sessionId: string; preset: string }> = []
    const service = new ExecutionService({
      ...env,
      selectAgentPreset: async () => ({ ok: true as const }),
      onAgentApplied: (sessionId, preset) => { reported.push({ sessionId, preset }) },
    })
    const task = { ...sampleTask(), agentPreset: 'butler' }
    const { execution } = startExecution(task, NOW, 'exec-1')
    await service.run(task, execution, () => {})
    expect(reported).toEqual([{ sessionId: 's-1', preset: 'butler' }])
    // The createSession path reports the same way.
    reported.length = 0
    const created = await service.createSession({ agentPreset: 'butler' })
    expect(created.ok).toBe(true)
    if (created.ok) expect(reported).toEqual([{ sessionId: created.sessionId, preset: 'butler' }])
  })

  it('skips the preset switch when the task names no preset', async () => {
    const { env, drivers } = makeEnv()
    let selectCalls = 0
    const service = new ExecutionService({
      ...env,
      selectAgentPreset: async () => { selectCalls += 1; return { ok: true } },
    })
    const task = sampleTask()
    const { execution } = startExecution(task, NOW, 'exec-1')
    await service.run(task, execution, () => {})
    expect(selectCalls).toBe(0)
    expect(drivers.get('s-1')?.promptCalls).toHaveLength(1)
  })

  it('applies a task permission preset via the /permission command before prompting', async () => {
    const { env, drivers } = makeEnv()
    const service = new ExecutionService(env)
    const task = { ...sampleTask(), permission: 'danger-full-access' }
    const { execution } = startExecution(task, NOW, 'exec-1')
    const events: string[] = []
    await service.run(task, execution, event => { events.push(event.kind) })
    expect(drivers.get('s-1')?.commandCalls).toEqual(['/permission danger-full-access'])
    // The prompt still went out after the permission switch.
    expect(drivers.get('s-1')?.promptCalls).toHaveLength(1)
    expect(events).toEqual(['started'])
  })

  it('settles failed when the permission switch is rejected', async () => {
    const { env, drivers } = makeEnv({ commandResult: { ok: false, error: 'no such preset' } })
    const service = new ExecutionService(env)
    const task = { ...sampleTask(), permission: 'read-only' }
    const { execution } = startExecution(task, NOW, 'exec-1')
    const events: Array<{ kind: string; outcome?: string; error?: string }> = []
    await service.run(task, execution, event => { events.push(event) })
    expect(events.at(-1)).toMatchObject({ kind: 'settled', outcome: 'failed' })
    expect(events.at(-1)?.error).toContain('permission')
    // No prompt was sent to the session.
    expect(drivers.get('s-1')?.promptCalls).toHaveLength(0)
  })

  it('settles failed when the host does not recognize the /permission command', async () => {
    const { env, drivers } = makeEnv({ commandResult: { ok: true, value: { matched: false } } })
    const service = new ExecutionService(env)
    const task = { ...sampleTask(), permission: 'workspace-write' }
    const { execution } = startExecution(task, NOW, 'exec-1')
    const events: Array<{ kind: string; outcome?: string; error?: string }> = []
    await service.run(task, execution, event => { events.push(event) })
    expect(events.at(-1)).toMatchObject({ kind: 'settled', outcome: 'failed' })
    expect(events.at(-1)?.error).toContain('/permission')
    expect(drivers.get('s-1')?.promptCalls).toHaveLength(0)
  })

  it('skips the permission switch when the task names no permission', async () => {
    const { env, drivers } = makeEnv()
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { execution } = startExecution(task, NOW, 'exec-1')
    await service.run(task, execution, () => {})
    expect(drivers.get('s-1')?.commandCalls).toHaveLength(0)
    expect(drivers.get('s-1')?.promptCalls).toHaveLength(1)
  })

  it('settles a turn that completes while the prompt round-trip is in flight', async () => {
    // A driver whose prompt() advances the turn to completion before it
    // resolves: the watch must catch it without a later subscription change.
    const connected = new FakeDriver()
    const env: ExecutionEnvironment = {
      sessions: {
        list: { getSnapshot: () => ({ phase: 'ready', byId: { 's-1': { running: false, blank: true } } }), subscribe: () => () => {} },
        binding: () => ({ session: connected }),
      },
      workspaces: {
        list: { getSnapshot: () => ({ items: [{ workspaceId: 'ws-1', sessionIds: ['s-1'] }], recentWorkspaceId: undefined }) },
      },
    }
    connected.prompt = async () => {
      connected.setSnapshot({ running: false, turns: 1 })
      return { ok: true }
    }
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { execution } = startExecution(task, NOW, 'exec-1')
    const events: Array<{ kind: string; outcome?: string }> = []
    await service.run(task, execution, event => { events.push(event) })
    expect(events.map(e => e.kind)).toEqual(['started', 'settled'])
    expect(events[1]).toMatchObject({ kind: 'settled', outcome: 'succeeded' })
  })

  it('settles failed when no workspace is available', async () => {
    const { env } = makeEnv({ items: [], recentWorkspaceId: undefined })
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { execution } = startExecution(task, NOW, 'exec-1')
    const events: Array<{ kind: string; outcome?: string; error?: string }> = []
    await service.run(task, execution, event => { events.push(event) })
    expect(events.at(-1)).toMatchObject({ kind: 'settled', outcome: 'failed' })
    expect(events.at(-1)?.error).toContain('workspace')
  })

  it('settles failed when the execution session never becomes ready', async () => {
    const env: ExecutionEnvironment = {
      sessions: {
        list: { getSnapshot: () => ({ phase: 'ready', byId: { 's-1': { running: false, blank: true } } }), subscribe: () => () => {} },
        binding: () => undefined,
      },
      workspaces: {
        list: { getSnapshot: () => ({ items: [{ workspaceId: 'ws-1', sessionIds: ['s-1'] }], recentWorkspaceId: undefined }) },
      },
    }
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { execution } = startExecution(task, NOW, 'exec-1')
    const events: Array<{ kind: string; outcome?: string }> = []
    await service.run(task, execution, event => { events.push(event) })
    expect(events.at(-1)).toMatchObject({ kind: 'settled', outcome: 'failed' })
  })

  it('never rejects — thrown wiring failures become settled-failed events', async () => {
    const env: ExecutionEnvironment = {
      sessions: { list: { getSnapshot: () => ({ phase: 'ready', byId: {} }), subscribe: () => () => {} }, binding: () => undefined },
      workspaces: {
        list: { getSnapshot: () => ({ items: [{ workspaceId: 'ws-1', sessionIds: [] }], recentWorkspaceId: undefined }) },
      },
    }
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { execution } = startExecution(task, NOW, 'exec-1')
    const events: string[] = []
    await expect(service.run(task, execution, event => { events.push(event.kind) })).resolves.toBeUndefined()
    expect(events).toEqual(['settled'])
  })

  it('settles a cold execution session when the host list reports it finished', async () => {
    // A session that is not the UI's current one never advances its driver
    // snapshot (turnEnds stays at baseline). The host list flip is the
    // completion signal; the raw history tail proves the turn ran.
    const connected = new FakeDriver()
    const summaries = new Map<string, { running: boolean; blank?: boolean }>()
    summaries.set('s-1', { running: true, blank: true })
    const listeners = new Set<() => void>()
    const env: ExecutionEnvironment = {
      sessions: {
        list: {
          getSnapshot: () => ({ phase: 'ready', byId: Object.fromEntries(summaries) }),
          subscribe: (fn: () => void): (() => void) => {
            listeners.add(fn)
            return () => { listeners.delete(fn) }
          },
        },
        binding: () => ({ session: connected }),
      },
      workspaces: {
        list: { getSnapshot: () => ({ items: [{ workspaceId: 'ws-1', sessionIds: ['s-1'] }], recentWorkspaceId: undefined }) },
      },
      history: {
        loadTail: async () => ({
          events: [
            { type: 'user/message' },
            { type: 'turn/end', data: { reason: { kind: 'completed' } } },
          ],
        }),
      },
    }
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { execution } = startExecution(task, NOW, 'exec-1')
    const events: Array<{ kind: string; outcome?: string }> = []
    const promise = service.run(task, execution, event => { events.push(event) })
    await promise
    expect(events.map(e => e.kind)).toEqual(['started'])

    // The host flips the session to finished → the watch settles.
    summaries.set('s-1', { running: false, blank: true })
    for (const fn of [...listeners]) fn()
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(events.at(-1)).toMatchObject({ kind: 'settled', outcome: 'succeeded' })
  })

  it('settles a cold execution session as failed from an error turn in the history tail', async () => {
    const connected = new FakeDriver()
    const summaries = new Map<string, { running: boolean; blank?: boolean }>()
    summaries.set('s-1', { running: false, blank: true })
    const env: ExecutionEnvironment = {
      sessions: {
        list: {
          getSnapshot: () => ({ phase: 'ready', byId: Object.fromEntries(summaries) }),
          subscribe: () => () => {},
        },
        binding: () => ({ session: connected }),
      },
      workspaces: {
        list: { getSnapshot: () => ({ items: [{ workspaceId: 'ws-1', sessionIds: ['s-1'] }], recentWorkspaceId: undefined }) },
      },
      history: {
        loadTail: async () => ({
          events: [{ type: 'turn/end', data: { reason: { kind: 'error', message: '模型超时' } } }],
        }),
      },
    }
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { execution } = startExecution(task, NOW, 'exec-1')
    const events: Array<{ kind: string; outcome?: string }> = []
    await service.run(task, execution, event => { events.push(event) })
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(events.at(-1)).toMatchObject({ kind: 'settled', outcome: 'failed' })
  })

  it('does not settle a cold session that was created but never ran (queue window)', async () => {
    // The list reports not-running, but the history tail has no turn/end:
    // the prompt may still be queued, so the watch must stay pending.
    const connected = new FakeDriver()
    const summaries = new Map<string, { running: boolean; blank?: boolean }>()
    summaries.set('s-1', { running: false, blank: true })
    const listeners = new Set<() => void>()
    const env: ExecutionEnvironment = {
      sessions: {
        list: {
          getSnapshot: () => ({ phase: 'ready', byId: Object.fromEntries(summaries) }),
          subscribe: (fn: () => void): (() => void) => {
            listeners.add(fn)
            return () => { listeners.delete(fn) }
          },
        },
        binding: () => ({ session: connected }),
      },
      workspaces: {
        list: { getSnapshot: () => ({ items: [{ workspaceId: 'ws-1', sessionIds: ['s-1'] }], recentWorkspaceId: undefined }) },
      },
      history: {
        loadTail: async () => ({ events: [{ type: 'user/message' }] }),
      },
    }
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { execution } = startExecution(task, NOW, 'exec-1')
    const events: Array<{ kind: string; outcome?: string }> = []
    const promise = service.run(task, execution, event => { events.push(event) })
    await promise
    expect(events.map(e => e.kind)).toEqual(['started'])

    summaries.set('s-1', { running: false, blank: true })
    for (const fn of [...listeners]) fn()
    await new Promise(resolve => { setTimeout(resolve, 0) })
    // Still no turn evidence → no settle.
    expect(events.map(e => e.kind)).toEqual(['started'])
  })
})

describe('ExecutionService.createSession (新建会话)', () => {
  it('creates a FRESH session via the createSession face (never blank-reuse) and applies no config when none given', async () => {
    const { env, drivers, createSessionCalls } = makeEnv()
    const createdWorkspaces: Array<string | undefined> = []
    const service = new ExecutionService({
      ...env,
      createSession: async workspaceId => {
        createdWorkspaces.push(workspaceId)
        drivers.set('s-new', new FakeDriver())
        return 's-new'
      },
    })
    const result = await service.createSession({ workspaceId: 'ws-9' })
    expect(result).toEqual({ ok: true, sessionId: 's-new' })
    expect(createdWorkspaces).toEqual(['ws-9'])
    expect(createSessionCalls).toEqual([])
  })

  it('applies the model route, agent preset and permission in order to the new session', async () => {
    const { env, drivers } = makeEnv()
    const order: string[] = []
    const service = new ExecutionService({
      ...env,
      createSession: async () => {
        order.push('create')
        drivers.set('s-new', new FakeDriver())
        return 's-new'
      },
      selectModel: async () => {
        order.push('model')
        return { ok: true }
      },
      selectAgentPreset: async () => {
        order.push('preset')
        return { ok: true }
      },
    })
    const result = await service.createSession({
      workspaceId: 'ws-1',
      provider: 'deepseek',
      model: 'chat',
      reasoningEffort: 'high',
      agentPreset: 'butler',
      permission: 'read-only',
    })
    expect(result).toEqual({ ok: true, sessionId: 's-new' })
    expect(order).toEqual(['create', 'model', 'preset'])
    expect(drivers.get('s-new')?.commandCalls).toEqual(['/permission read-only'])
  })

  it('surfaces a config failure after creation as a partial success (the session stays usable)', async () => {
    const { env, drivers } = makeEnv()
    drivers.set('s-new', new FakeDriver())
    const service = new ExecutionService({
      ...env,
      createSession: async () => 's-new',
      selectAgentPreset: async () => ({ ok: false as const, error: 'preset missing' }),
    })
    const result = await service.createSession({ workspaceId: 'ws-1', agentPreset: 'butler' })
    expect(result).toMatchObject({ ok: true, sessionId: 's-new' })
    expect((result as { configError?: string }).configError).toContain('preset')
  })

  it('fails cleanly when the session cannot be created (no workspace available)', async () => {
    const { env } = makeEnv({ items: [], recentWorkspaceId: undefined })
    const service = new ExecutionService(env)
    const result = await service.createSession({})
    expect(result).toMatchObject({ ok: false })
    expect(result.ok === false && result.error).toContain('workspace')
  })

  it('falls back to the workspace session when no createSession face is wired', async () => {
    const { env, createSessionCalls } = makeEnv()
    const service = new ExecutionService({ ...env, createSession: undefined })
    const result = await service.createSession({ workspaceId: 'ws-1' })
    expect(result).toMatchObject({ ok: true, sessionId: 's-1' })
    expect(createSessionCalls).toEqual([])
  })
})

describe('ExecutionService.renameSession (会话重命名)', () => {
  it('routes through the host-level rename face', async () => {
    const calls: Array<[string, string]> = []
    const { env } = makeEnv()
    const service = new ExecutionService({
      ...env,
      renameSession: async (sessionId, title) => {
        calls.push([sessionId, title])
        return { ok: true }
      },
    })
    const result = await service.renameSession('s-9', ' 新标题 ')
    expect(result).toEqual({ ok: true })
    expect(calls).toEqual([['s-9', '新标题']])
  })

  it('rejects a blank title before any channel is touched', async () => {
    const { env } = makeEnv()
    let called = 0
    const service = new ExecutionService({
      ...env,
      renameSession: async () => { called += 1; return { ok: true } },
    })
    expect(await service.renameSession('s-9', '   ')).toMatchObject({ ok: false })
    expect(called).toBe(0)
  })

  it('degrades to the binding driver when no face is wired', async () => {
    const { env, drivers } = makeEnv()
    const driver = new FakeDriver()
    drivers.set('s-9', driver)
    const service = new ExecutionService(env)
    const result = await service.renameSession('s-9', '驱动改名')
    expect(result).toEqual({ ok: true })
    expect(driver.renameCalls).toEqual(['驱动改名'])
  })

  it('reports unavailable when neither face nor binding exists', async () => {
    const { env } = makeEnv()
    const service = new ExecutionService(env)
    expect(await service.renameSession('s-none', 'x')).toMatchObject({ ok: false })
  })
})

describe('ExecutionService.reconcile', () => {
  it('settles a task whose execution session no longer exists', async () => {
    const { env } = makeEnv()
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { task: running } = startExecution(task, NOW, 'exec-1')
    const withSession = { ...running, executions: running.executions.map(e => ({ ...e, sessionId: 's-gone' })) }
    // A single absent snapshot never cancels (list race) — the verdict needs
    // two consecutive misses.
    expect(await service.reconcile(withSession)).toBeUndefined()
    const event = await service.reconcile(withSession)
    expect(event).toMatchObject({ kind: 'settled', outcome: 'cancelled' })
  })

  it('settles a finished session by its agent error (warm snapshot)', async () => {
    const { env, drivers, summaries } = makeEnv()
    drivers.set('s-1', new FakeDriver())
    summaries.set('s-1', { running: false, blank: true })
    drivers.get('s-1')!.setSnapshot({ running: false, lastAgentError: 'x', turns: 1 })
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { task: running } = startExecution(task, NOW, 'exec-1')
    const withSession = {
      ...running,
      executions: running.executions.map(e => ({ ...e, sessionId: 's-1' })),
    }
    expect(await service.reconcile(withSession)).toMatchObject({ kind: 'settled', outcome: 'failed' })
  })

  it('settles a finished cold session as succeeded via the list summary', async () => {
    const { env, summaries } = makeEnv()
    summaries.set('s-1', { running: false, blank: true })
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { task: running } = startExecution(task, NOW, 'exec-1')
    const withSession = { ...running, executions: running.executions.map(e => ({ ...e, sessionId: 's-1' })) }
    expect(await service.reconcile(withSession)).toMatchObject({ kind: 'settled', outcome: 'succeeded' })
  })

  it('detects failure of a cold session from the raw history tail', async () => {
    const { env, summaries } = makeEnv()
    summaries.set('s-1', { running: false, blank: true })
    const service = new ExecutionService({
      ...env,
      history: {
        loadTail: async () => ({
          events: [
            { type: 'user/message' },
            { type: 'turn/end', data: { reason: { kind: 'error' } } },
          ],
        }),
      },
    })
    const task = sampleTask()
    const { task: running } = startExecution(task, NOW, 'exec-1')
    const withSession = { ...running, executions: running.executions.map(e => ({ ...e, sessionId: 's-1' })) }
    expect(await service.reconcile(withSession)).toMatchObject({ kind: 'settled', outcome: 'failed' })
  })

  it('falls back to succeeded when the history tail has no error turn', async () => {
    const { env, summaries } = makeEnv()
    summaries.set('s-1', { running: false, blank: true })
    const service = new ExecutionService({
      ...env,
      history: {
        loadTail: async () => ({
          events: [
            { type: 'user/message' },
            { type: 'turn/end', data: { reason: { kind: 'completed' } } },
          ],
        }),
      },
    })
    const task = sampleTask()
    const { task: running } = startExecution(task, NOW, 'exec-1')
    const withSession = { ...running, executions: running.executions.map(e => ({ ...e, sessionId: 's-1' })) }
    expect(await service.reconcile(withSession)).toMatchObject({ kind: 'settled', outcome: 'succeeded' })
  })

  it('stays pending while the session is still running', async () => {
    const { env, drivers, summaries } = makeEnv()
    drivers.set('s-1', new FakeDriver())
    summaries.set('s-1', { running: true, blank: true })
    drivers.get('s-1')!.setSnapshot({ running: true, turns: 1 })
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { task: running } = startExecution(task, NOW, 'exec-1')
    const withSession = { ...running, executions: running.executions.map(e => ({ ...e, sessionId: 's-1' })) }
    expect(await service.reconcile(withSession)).toBeUndefined()
  })

  it('waits for the session-list baseline before judging a session missing', async () => {
    const { env, summaries } = makeEnv()
    // Baseline not ready yet: even though byId is empty, no cancel verdict.
    const pendingEnv: ExecutionEnvironment = {
      ...env,
      sessions: {
        ...env.sessions,
        list: { getSnapshot: () => ({ phase: 'pending' as const, byId: {} }), subscribe: () => () => {} },
      },
    }
    const service = new ExecutionService(pendingEnv)
    const task = sampleTask()
    const { task: running } = startExecution(task, NOW, 'exec-1')
    const withSession = { ...running, executions: running.executions.map(e => ({ ...e, sessionId: 's-1' })) }
    expect(await service.reconcile(withSession)).toBeUndefined()

    // Once ready with the session present, the finished session settles.
    summaries.set('s-1', { running: false, blank: true })
    const readyService = new ExecutionService(env)
    expect(await readyService.reconcile(withSession)).toMatchObject({ kind: 'settled', outcome: 'succeeded' })

    // A ready list without the session is a genuine cancel — but only on the
    // second consecutive miss (one absent snapshot is a list race).
    const missingEnv: ExecutionEnvironment = {
      ...env,
      sessions: {
        ...env.sessions,
        list: { getSnapshot: () => ({ phase: 'ready' as const, byId: {} }), subscribe: () => () => {} },
      },
    }
    const missingService = new ExecutionService(missingEnv)
    expect(await missingService.reconcile(withSession)).toBeUndefined()
    expect(await missingService.reconcile(withSession)).toMatchObject({ kind: 'settled', outcome: 'cancelled' })
  })

  it('ignores tasks with no open execution', async () => {
    const { env } = makeEnv()
    const service = new ExecutionService(env)
    expect(await service.reconcile(sampleTask())).toBeUndefined()
    const { task: running } = startExecution(sampleTask(), NOW, 'exec-1')
    const settled = {
      ...running,
      executions: running.executions.map(e => ({ ...e, endedAt: NOW, result: 'succeeded' as const })),
    }
    expect(await service.reconcile(settled)).toBeUndefined()
  })
})

describe('ExecutionService.commentRun', () => {
  it('sends the comment and settles as cancelled when the session vanishes', async () => {
    const { env, setSummary } = makeEnv({ blankSummary: false })
    env.sendComment = async () => ({ ok: true })
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { task: running } = startExecution(task, NOW, 'exec-1')
    const round = {
      ...running.executions[0],
      sessionId: 's-1',
      comment: '继续干活',
    }
    const events: ExecutionEvent[] = []
    // The session is absent from the host list (deleted/archived): the
    // watch settles the round as cancelled instead of waiting forever —
    // but only on the second consecutive miss (one absent snapshot is a
    // list race, never proof).
    const pending = service.commentRun(running, round, 's-1', '继续干活', event => { events.push(event) })
    await new Promise(resolve => setTimeout(resolve, 0))
    setSummary('s-noise', false)
    await pending
    expect(events).toEqual([
      { kind: 'settled', taskId: task.id, executionId: 'exec-1', outcome: 'cancelled', error: 'comment session no longer exists' },
    ])
  })

  it('a queued comment round delivers its text AND its images together through the comment face', async () => {
    const { env } = makeEnv({ blankSummary: false })
    const seen: Array<{ text: string; images?: readonly unknown[] }> = []
    env.sendComment = async (_id, text, _mode, images) => {
      seen.push({ text, images })
      return { ok: true }
    }
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { task: running } = startExecution(task, NOW, 'exec-1')
    const round = {
      ...running.executions[0],
      sessionId: 's-1',
      comment: '看图',
      promptImages: [{ mediaType: 'image/png', data: 'RkZG', name: 'a.png' }],
    }
    await service.commentRun(running, round, 's-1', '看图', () => {})
    // The pictures ride the round and go out with the text when the lane frees
    // — the send mode is the toggle, never forced to steer by having images.
    expect(seen).toHaveLength(1)
    expect(seen[0]?.text).toBe('看图')
    expect(seen[0]?.images).toEqual([{ mediaType: 'image/png', data: 'RkZG', name: 'a.png' }])
  })

  it('a queued comment round delivers its file refs together through the comment face', async () => {
    const { env } = makeEnv({ blankSummary: false })
    const seen: Array<{ text: string; files?: readonly unknown[] }> = []
    env.sendComment = async (_id, text, _mode, _images, files) => {
      seen.push({ text, files })
      return { ok: true }
    }
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { task: running } = startExecution(task, NOW, 'exec-1')
    const round = {
      ...running.executions[0],
      sessionId: 's-1',
      comment: '看文件',
      promptFiles: [{ receiptId: 'rcpt-1', name: 'a.pdf', bytes: 10 }],
    }
    await service.commentRun(running, round, 's-1', '看文件', () => {})
    expect(seen).toHaveLength(1)
    expect(seen[0]?.text).toBe('看文件')
    expect(seen[0]?.files).toEqual([{ receiptId: 'rcpt-1', name: 'a.pdf', bytes: 10 }])
  })

  it('settles a rejected comment send as failed', async () => {
    const { env } = makeEnv()
    env.sendComment = async () => ({ ok: false, error: 'prompt rejected' })
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { task: running } = startExecution(task, NOW, 'exec-1')
    const round = { ...running.executions[0], sessionId: 's-1', comment: '继续' }
    const events: ExecutionEvent[] = []
    await service.commentRun(running, round, 's-1', '继续', event => { events.push(event) })
    expect(events).toEqual([
      { kind: 'settled', taskId: task.id, executionId: 'exec-1', outcome: 'failed', error: 'comment rejected: prompt rejected' },
    ])
  })

  it('settles a matched pure-configuration command right after the detection window', async () => {
    const { env } = makeEnv({ commandGraceMs: 0 })
    env.sendComment = async () => { throw new Error('plain path must not run for a command round') }
    env.sendCommand = async () => ({ ok: true, matched: true, outcome: { kind: 'success' as const, text: 'preset read-only' } })
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { task: running } = startExecution(task, NOW, 'exec-1')
    const round = { ...running.executions[0], sessionId: 's-1', comment: '/permission read-only', command: true }
    const events: ExecutionEvent[] = []
    await service.commentRun(running, round, 's-1', '/permission read-only', event => { events.push(event) })
    expect(events).toEqual([
      { kind: 'settled', taskId: task.id, executionId: 'exec-1', outcome: 'succeeded', error: 'preset read-only' },
    ])
  })

  it('watches a matched command that opened a real turn to its end (the /plan fake-completion regression)', async () => {
    const { env, drivers, setSummary } = makeEnv({ commandGraceMs: 500 })
    env.sendComment = async () => { throw new Error('plain path must not run for a command round') }
    env.sendCommand = async () => ({ ok: true, matched: true, outcome: { kind: 'success' as const, text: 'Plan mode on.' } })
    const driver = new FakeDriver()
    drivers.set('s-1', driver)
    setSummary('s-1', false)
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { task: running } = startExecution(task, NOW, 'exec-1')
    const round = { ...running.executions[0], sessionId: 's-1', comment: '/plan 继续干活', command: true }
    const events: ExecutionEvent[] = []
    const promise = service.commentRun(running, round, 's-1', '/plan 继续干活', event => { events.push(event) })
    await new Promise(resolve => { setTimeout(resolve, 0) })
    // The command matched but the session is idle: the round must NOT settle —
    // the host has not started the plan turn yet.
    expect(events).toEqual([])
    // The plan turn starts (running flip) — the round settles only when the
    // turn REALLY ends, not on the match.
    setSummary('s-1', true)
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(events).toEqual([])
    // The plan review keeps the session running — still no settle.
    setSummary('s-1', true)
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(events).toEqual([])
    // The turn truly ends only after the review is approved and the model
    // finishes: session stops running, its turn counter advanced past the
    // pre-command baseline.
    driver.setSnapshot({ running: false, turns: 1 })
    setSummary('s-1', false)
    await promise
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(events).toEqual([
      { kind: 'settled', taskId: task.id, executionId: 'exec-1', outcome: 'succeeded' },
    ])
  })

  it('end-to-end: a /plan <message> comment stays open through plan review and settles only when the turn ends', async () => {
    const { env, drivers, setSummary } = makeEnv({ commandGraceMs: 500 })
    env.sendComment = async () => { throw new Error('plain path must not run for a command round') }
    // The host mirrors DSH's real /plan handler: it logs the command AND
    // steers the message — the plan turn is already starting by the time the
    // RPC resolves.
    env.sendCommand = async () => {
      setSummary('s-1', true)
      return { ok: true, matched: true, outcome: { kind: 'success' as const, text: 'Plan mode on.' } }
    }
    const driver = new FakeDriver()
    drivers.set('s-1', driver)
    setSummary('s-1', false)
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { task: running } = startExecution(task, NOW, 'exec-1')
    const round = { ...running.executions[0], sessionId: 's-1', comment: '/plan 帮我完善', command: true }
    const events: ExecutionEvent[] = []
    const promise = service.commentRun(running, round, 's-1', '/plan 帮我完善', event => { events.push(event) })
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(events).toEqual([])
    // Plan review wait: the session stays running — no "瞬间完成".
    setSummary('s-1', true)
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(events).toEqual([])
    // The user approves and the model finishes the turn.
    driver.setSnapshot({ running: false, turns: 1 })
    setSummary('s-1', false)
    await promise
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(events).toEqual([
      { kind: 'settled', taskId: task.id, executionId: 'exec-1', outcome: 'succeeded' },
    ])
  })

  it('a settled configuration command is never re-settled by later list changes', async () => {
    const { env, setSummary } = makeEnv({ commandGraceMs: 0 })
    env.sendCommand = async () => ({ ok: true, matched: true, outcome: { kind: 'success' as const, text: 'done' } })
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { task: running } = startExecution(task, NOW, 'exec-1')
    const round = { ...running.executions[0], sessionId: 's-1', comment: '/goal 目标', command: true }
    const events: ExecutionEvent[] = []
    await service.commentRun(running, round, 's-1', '/goal 目标', event => { events.push(event) })
    expect(events).toHaveLength(1)
    // List noise after the settle must not produce a second event (the
    // detection watcher's subscriptions were disposed).
    setSummary('s-1', false)
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(events).toHaveLength(1)
  })

  it('settles a matched-but-failing command round as failed with its native outcome', async () => {
    const { env } = makeEnv()
    env.sendCommand = async () => ({ ok: true, matched: true, outcome: { kind: 'error' as const, text: 'unknown preset "nope"' } })
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { task: running } = startExecution(task, NOW, 'exec-1')
    const round = { ...running.executions[0], sessionId: 's-1', comment: '/permission nope', command: true }
    const events: ExecutionEvent[] = []
    await service.commentRun(running, round, 's-1', '/permission nope', event => { events.push(event) })
    expect(events).toEqual([
      { kind: 'settled', taskId: task.id, executionId: 'exec-1', outcome: 'failed', error: 'unknown preset "nope"' },
    ])
  })

  it('falls back to plain text for an unmatched command line (native default-sink)', async () => {
    const { env, setSummary } = makeEnv({ blankSummary: false })
    env.sendCommand = async () => ({ ok: true, matched: false })
    env.sendComment = async () => ({ ok: true })
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { task: running } = startExecution(task, NOW, 'exec-1')
    const round = { ...running.executions[0], sessionId: 's-1', comment: '/not-a-command 你好', command: true }
    const events: ExecutionEvent[] = []
    // The session is absent from the host list: the text fallback runs the
    // normal watch, which settles as cancelled (deleted session) — on the
    // second consecutive miss.
    const pending = service.commentRun(running, round, 's-1', '/not-a-command 你好', event => { events.push(event) })
    await new Promise(resolve => setTimeout(resolve, 0))
    setSummary('s-noise', false)
    await pending
    expect(events).toEqual([
      { kind: 'settled', taskId: task.id, executionId: 'exec-1', outcome: 'cancelled', error: 'comment session no longer exists' },
    ])
  })

  it('falls back to plain text when no command face is wired', async () => {
    const { env, setSummary } = makeEnv({ blankSummary: false })
    env.sendComment = async () => ({ ok: true })
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { task: running } = startExecution(task, NOW, 'exec-1')
    const round = { ...running.executions[0], sessionId: 's-1', comment: '/plan 继续', command: true }
    const events: ExecutionEvent[] = []
    const pending = service.commentRun(running, round, 's-1', '/plan 继续', event => { events.push(event) })
    await new Promise(resolve => setTimeout(resolve, 0))
    setSummary('s-noise', false)
    await pending
    expect(events).toEqual([
      { kind: 'settled', taskId: task.id, executionId: 'exec-1', outcome: 'cancelled', error: 'comment session no longer exists' },
    ])
  })

  it('settles a rejected command transport as failed', async () => {
    const { env } = makeEnv()
    env.sendCommand = async () => ({ ok: false, error: 'rpc down' })
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { task: running } = startExecution(task, NOW, 'exec-1')
    const round = { ...running.executions[0], sessionId: 's-1', comment: '/permission read-only', command: true }
    const events: ExecutionEvent[] = []
    await service.commentRun(running, round, 's-1', '/permission read-only', event => { events.push(event) })
    expect(events).toEqual([
      { kind: 'settled', taskId: task.id, executionId: 'exec-1', outcome: 'failed', error: 'command rejected: rpc down' },
    ])
  })
})

describe('ExecutionService.run slash prompts (native command registry path)', () => {
  it('routes a /plan prompt through the command registry and watches its real turn (the plan-mode regression)', async () => {
    const { env, drivers, setSummary } = makeEnv({ commandGraceMs: 500 })
    const sent: string[] = []
    env.sendCommand = async (_sessionId, line) => {
      sent.push(line)
      return { ok: true, matched: true, outcome: { kind: 'success' as const, text: 'Plan mode on.' } }
    }
    const service = new ExecutionService(env)
    const task = createTask({ title: '规划任务', description: '', prompt: '/plan 帮我实现一个登录页' }, NOW, 'task-1')
    const { execution } = startExecution(task, NOW, 'exec-1')
    const events: ExecutionEvent[] = []
    const promise = service.run(task, execution, event => { events.push(event) })
    await new Promise(resolve => { setTimeout(resolve, 0) })
    // The connected execution session is the driver the service watches.
    const driver = drivers.get('s-1')!
    // The whole line went through the registry — never as a model prompt.
    expect(sent).toEqual(['/plan 帮我实现一个登录页'])
    expect(driver.promptCalls).toHaveLength(0)
    // The plan turn starts (running flip) — the run stays open.
    setSummary('s-1', true)
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(events.map(e => e.kind)).toEqual(['started'])
    await promise
    // The turn truly ends → the run settles succeeded.
    driver.setSnapshot({ running: false, turns: 1 })
    setSummary('s-1', false)
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(events.at(-1)).toMatchObject({ kind: 'settled', outcome: 'succeeded' })
  })

  it('settles a task whose whole prompt is a pure configuration command right after the detection window', async () => {
    const { env, drivers } = makeEnv({ commandGraceMs: 0 })
    env.sendCommand = async () => ({ ok: true, matched: true, outcome: { kind: 'success' as const, text: 'preset read-only' } })
    const service = new ExecutionService(env)
    const task = createTask({ title: '切权限', description: '', prompt: '/permission read-only' }, NOW, 'task-1')
    const { execution } = startExecution(task, NOW, 'exec-1')
    const events: ExecutionEvent[] = []
    await service.run(task, execution, event => { events.push(event) })
    expect(drivers.get('s-1')?.promptCalls).toHaveLength(0)
    expect(events.map(e => e.kind)).toEqual(['started', 'settled'])
    expect(events.at(-1)).toMatchObject({ kind: 'settled', outcome: 'succeeded' })
  })

  it('falls back to plain text for an unmatched slash prompt (native default-sink)', async () => {
    const { env, drivers } = makeEnv({ commandGraceMs: 0 })
    env.sendCommand = async () => ({ ok: true, matched: false })
    const service = new ExecutionService(env)
    const task = createTask({ title: '未知命令', description: '', prompt: '/not-a-command 帮帮忙' }, NOW, 'task-1')
    const { execution } = startExecution(task, NOW, 'exec-1')
    const events: ExecutionEvent[] = []
    const promise = service.run(task, execution, event => { events.push(event) })
    await promise
    expect(drivers.get('s-1')?.promptCalls).toEqual([[{ type: 'text', text: '/not-a-command 帮帮忙' }]])
    expect(events.map(e => e.kind)).toEqual(['started'])
    drivers.get('s-1')?.setSnapshot({ running: false, turns: 1 })
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(events.map(e => e.kind)).toEqual(['started', 'settled'])
  })

  it('sends a slash prompt as plain text when no command registry is wired', async () => {
    const { env, drivers } = makeEnv()
    const service = new ExecutionService(env)
    const task = createTask({ title: '无注册表', description: '', prompt: '/plan 继续' }, NOW, 'task-1')
    const { execution } = startExecution(task, NOW, 'exec-1')
    await service.run(task, execution, () => {})
    expect(drivers.get('s-1')?.promptCalls).toEqual([[{ type: 'text', text: '/plan 继续' }]])
  })

  it('gives a task whose title fills in for a blank prompt the same slash routing', async () => {
    const { env, drivers } = makeEnv({ commandGraceMs: 0 })
    const sent: string[] = []
    env.sendCommand = async (_sessionId, line) => {
      sent.push(line)
      return { ok: true, matched: true, outcome: { kind: 'success' as const } }
    }
    const service = new ExecutionService(env)
    const task = createTask({ title: '/remind 午饭', description: '', prompt: '   ' }, NOW, 'task-1')
    const { execution } = startExecution(task, NOW, 'exec-1')
    await service.run(task, execution, () => {})
    expect(sent).toEqual(['/remind 午饭'])
    expect(drivers.get('s-1')?.promptCalls).toHaveLength(0)
  })
})

describe('ExecutionService.run options (requirement-refinement rounds)', () => {
  it('reuses the provided session, renames it, and sends the prompt override', async () => {
    const { env, drivers, createSessionCalls } = makeEnv({ recentWorkspaceId: 'ws-recent' })
    const driver = new FakeDriver()
    drivers.set('s-refine', driver)
    const service = new ExecutionService(env)
    const task = sampleTask()
    const { execution } = startExecution(task, NOW, 'exec-1')
    const events: string[] = []
    await service.run(task, execution, event => { events.push(event.kind) }, {
      sessionId: 's-refine',
      prompt: '完善指令文本',
      fresh: false,
      renameTo: '写个脚本 · 完善需求',
    })
    // The session is reused: no workspace connect happens.
    expect(createSessionCalls).toEqual([])
    expect(driver.renameCalls).toEqual(['写个脚本 · 完善需求'])
    expect(driver.promptCalls).toEqual([[{ type: 'text', text: '完善指令文本' }]])
    expect(events).toEqual(['started'])
  })

  it('skips the blank-session-only agent preset switch on a reused session', async () => {
    const { env, drivers } = makeEnv()
    drivers.set('s-1', new FakeDriver())
    let selectCalls = 0
    const service = new ExecutionService({
      ...env,
      selectAgentPreset: async () => { selectCalls += 1; return { ok: true } },
    })
    const task = { ...sampleTask(), agentPreset: 'butler' }
    const { execution } = startExecution(task, NOW, 'exec-1')
    await service.run(task, execution, () => {}, {
      sessionId: 's-1',
      fresh: false,
    })
    expect(selectCalls).toBe(0)
    expect(drivers.get('s-1')?.promptCalls).toHaveLength(1)
  })

  it('still applies the preset on a fresh session even with a provided sessionId', async () => {
    const { env, drivers } = makeEnv()
    drivers.set('s-1', new FakeDriver())
    let selectCalls = 0
    const service = new ExecutionService({
      ...env,
      selectAgentPreset: async () => { selectCalls += 1; return { ok: true } },
    })
    const task = { ...sampleTask(), agentPreset: 'butler' }
    const { execution } = startExecution(task, NOW, 'exec-1')
    await service.run(task, execution, () => {}, { sessionId: 's-1' })
    expect(selectCalls).toBe(1)
  })
})
