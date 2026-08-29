/**
 * Board sync client tests: boot/mode, migration (bootstrap + backup),
 * debounced commit with in-flight refire, failure retry, SSE-driven resync
 * and lease/command routing, poll convergence, and dispose teardown. All
 * transport/timer/clock seams are faked so every path is driven directly.
 */
import { describe, expect, it } from 'vitest'
import { BoardSyncClient, type BoardSyncTransport, type SyncFetchResult } from '../src/core/host-sync.ts'
import { emptyBoardDoc, applyCommit, type BoardCommit, type BoardDoc, type BoardEvent, type BoardView } from '../src/core/board-doc.ts'
import type { LeaseState } from '../src/core/board-doc.ts'
import { createTask, type TaskRecord } from '../src/core/tasks.ts'
import { BoardDataService } from '../src/host/board-service.ts'

const T0 = 1_700_000_000_000

/** A fake timer queue: `defer` collects callbacks; `flush` runs due ones. */
function fakeTimers() {
  const pending: Array<{ fn: () => void; ms: number; at: number; id: number }> = []
  let clock = T0
  let nextId = 1
  return {
    now: () => clock,
    defer: (fn: () => void, ms: number): (() => void) => {
      const id = nextId++
      pending.push({ fn, ms, at: clock + ms, id })
      return () => {
        const i = pending.findIndex(p => p.id === id)
        if (i >= 0) pending.splice(i, 1)
      }
    },
    /** Advance the clock and run everything due (re-entrant for self-loops). */
    async advance(ms: number): Promise<void> {
      clock += ms
      for (let guard = 0; guard < 100; guard++) {
        const due = pending.filter(p => p.at <= clock).sort((a, b) => a.at - b.at)
        if (due.length === 0) break
        for (const item of due) {
          const i = pending.indexOf(item)
          if (i >= 0) pending.splice(i, 1)
          item.fn()
        }
        // Drain the async chains the callbacks started (transport promises).
        await new Promise(resolve => setTimeout(resolve, 0))
        await new Promise(resolve => setTimeout(resolve, 0))
      }
    },
    pendingCount: () => pending.length,
  }
}

/** A controllable fake transport: tests queue responses and read calls. */
function fakeTransport() {
  const calls = { fetch: 0, commit: [] as BoardCommit[], lease: [] as Array<{ id: string; ttl?: number; release?: boolean }>, command: [] as string[], releases: 0 }
  let doc: BoardDoc = emptyBoardDoc(T0)
  let available = true
  let commitFails = false
  let leaseHeld = false
  let streamHandler: { onEvent(e: BoardEvent): void; onOpen(): void } | undefined
  const transport: BoardSyncTransport = {
    fetch: async (_clientId, since) => {
      calls.fetch += 1
      if (!available) return { available: false, revision: 0 }
      if (since !== undefined && since >= doc.revision) return { available: true, revision: doc.revision, unchanged: true }
      return { available: true, revision: doc.revision, doc }
    },
    commit: async commit => {
      calls.commit.push(commit)
      if (commitFails) return undefined
      doc = applyCommit(doc, commit, T0 + calls.commit.length)
      return { available: true, revision: doc.revision, doc }
    },
    lease: async (clientId, options) => {
      calls.lease.push({ id: clientId, ttl: options.ttlMs, release: options.release })
      const state: LeaseState = options.release
        ? { held: false, holder: undefined, expiresAt: undefined }
        : leaseHeld ? { held: false, holder: 'other', expiresAt: T0 + 99999 } : { held: true, holder: clientId, expiresAt: T0 + 99999 }
      return state
    },
    command: async (_clientId, command) => { calls.command.push(command.taskId) },
    openStream: (_clientId, handlers) => {
      streamHandler = handlers
      return () => { streamHandler = undefined }
    },
  }
  return {
    transport,
    calls,
    setDoc: (d: BoardDoc) => { doc = d },
    getDoc: () => doc,
    setAvailable: (v: boolean) => { available = v },
    setCommitFails: (v: boolean) => { commitFails = v },
    setLeaseHeld: (v: boolean) => { leaseHeld = v },
    emit: (event: BoardEvent) => streamHandler?.onEvent(event),
    open: () => streamHandler?.onOpen(),
  }
}

function makeClient(over: { leaseHeldByOther?: boolean } = {}) {
  const timers = fakeTimers()
  const t = fakeTransport()
  const logs: string[] = []
  const client = new BoardSyncClient({
    transport: t.transport,
    defer: timers.defer,
    now: timers.now,
    uuid: () => 'tab-1',
    commitDebounceMs: 250,
    leaseRenewMs: 7_000,
    pollMs: 30_000,
    resyncCoalesceMs: 120,
    log: msg => logs.push(msg),
  })
  if (over.leaseHeldByOther) t.setLeaseHeld(true)
  return { client, timers, t, logs }
}

const task = (id: string, updatedAt = T0): TaskRecord => createTask({ title: id, description: '', prompt: 'p' }, updatedAt, id)

describe('BoardSyncClient boot', () => {
  it('settles into synced mode on a reachable host', async () => {
    const { client, t } = makeClient()
    t.setDoc(applyCommit(emptyBoardDoc(T0), commitOf({ tasks: [task('a')] }), T0))
    expect(await client.start()).toBe('synced')
    expect(client.view().tasks.map(x => x.id)).toEqual(['a'])
  })

  it('settles into unavailable mode after the retry budget', async () => {
    const { client, t, timers } = makeClient()
    t.setAvailable(false)
    const mode = client.start()
    for (let i = 0; i < 6; i++) await timers.advance(1_000)
    expect(await mode).toBe('unavailable')
    expect(t.calls.fetch).toBe(3)
  })

  it('in unavailable mode local writes never touch the transport', async () => {
    const { client, t, timers } = makeClient()
    t.setAvailable(false)
    const mode = client.start()
    for (let i = 0; i < 6; i++) await timers.advance(1_000)
    expect(await mode).toBe('unavailable')
    client.setTasks([task('a')])
    expect(t.calls.commit).toHaveLength(0)
  })
})

describe('BoardSyncClient migration', () => {
  it('bootstraps an empty host from a non-empty legacy view', async () => {
    const { client, t } = makeClient()
    const legacy: BoardView = {
      tasks: [task('a'), task('b')],
      cruise: { enabled: true, limit: 3, schedule: [] },
      schedulePresets: [{ id: 'p', label: 'L', cron: '0 9 * * *' }],
      runPresets: { presets: [] },
    }
    expect(await client.start(() => legacy)).toBe('synced')
    expect(t.calls.commit).toHaveLength(1)
    expect(t.calls.commit[0].tasks.map(x => x.id)).toEqual(['a', 'b'])
    expect(t.calls.commit[0].cruise.value.enabled).toBe(true)
    expect(client.view().tasks.map(x => x.id)).toEqual(['a', 'b'])
  })

  it('does not bootstrap when the legacy view is all-defaults', async () => {
    const { client, t } = makeClient()
    const legacy: BoardView = { tasks: [], cruise: { enabled: false, limit: 5, schedule: [] }, schedulePresets: [], runPresets: { presets: [] } }
    await client.start(() => legacy)
    expect(t.calls.commit).toHaveLength(0)
  })

  it('backs up a diverging local ledger when the host already has truth', async () => {
    const { client, t } = makeClient()
    t.setDoc(applyCommit(emptyBoardDoc(T0), commitOf({ tasks: [task('host')] }), T0))
    const backups: BoardView[] = []
    client.onBackup(v => backups.push(v))
    await client.start(() => ({ tasks: [task('local')], cruise: { enabled: false, limit: 5, schedule: [] }, schedulePresets: [], runPresets: { presets: [] } }))
    expect(backups).toHaveLength(1)
    expect(backups[0].tasks.map(x => x.id)).toEqual(['local'])
    // Host truth is what the replica serves.
    expect(client.view().tasks.map(x => x.id)).toEqual(['host'])
  })

  it('no backup when local matches host', async () => {
    const { client, t } = makeClient()
    const doc = applyCommit(emptyBoardDoc(T0), commitOf({ tasks: [task('a')] }), T0)
    t.setDoc(doc)
    const backups: BoardView[] = []
    client.onBackup(v => backups.push(v))
    await client.start(() => boardView(doc))
    expect(backups).toHaveLength(0)
  })
})

describe('BoardSyncClient commit', () => {
  it('debounces a burst of local writes into one commit', async () => {
    const { client, t, timers } = makeClient()
    await client.start()
    client.setTasks([task('a')])
    client.setTasks([task('a'), task('b')])
    client.setCruise({ enabled: true, limit: 2, schedule: [] })
    await timers.advance(300)
    expect(t.calls.commit).toHaveLength(1)
    expect(t.calls.commit[0].tasks.map(x => x.id)).toEqual(['a', 'b'])
    expect(t.calls.commit[0].cruise.value.enabled).toBe(true)
  })

  it('refires when a write lands mid-flight', async () => {
    const { client, t, timers } = makeClient()
    await client.start()
    let resolveCommit: ((r: SyncFetchResult) => void) | undefined
    t.transport.commit = async commit => {
      t.calls.commit.push(commit)
      return await new Promise<SyncFetchResult>(r => { resolveCommit = r })
    }
    client.setTasks([task('a')])
    await timers.advance(300) // fires the first commit (in flight)
    expect(t.calls.commit).toHaveLength(1)
    client.setTasks([task('a'), task('b')]) // dirty again mid-flight
    resolveCommit?.({ available: true, revision: 1, doc: applyCommit(emptyBoardDoc(T0), commitOf({ tasks: [task('a')] }), T0) })
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))
    await timers.advance(300) // refire the second commit
    expect(t.calls.commit).toHaveLength(2)
    expect(t.calls.commit[1].tasks.map(x => x.id)).toEqual(['a', 'b'])
  })

  it('retries a failed commit after a beat', async () => {
    const { client, t, timers } = makeClient()
    await client.start()
    t.setCommitFails(true)
    client.setTasks([task('a')])
    await timers.advance(300)
    expect(t.calls.commit).toHaveLength(1)
    t.setCommitFails(false)
    await timers.advance(2_100) // the retry beat
    expect(t.calls.commit).toHaveLength(2)
  })

  it('computes deletions against the baseline', async () => {
    const { client, t, timers } = makeClient()
    t.setDoc(applyCommit(emptyBoardDoc(T0), commitOf({ tasks: [task('a'), task('b')] }), T0))
    await client.start()
    client.setTasks([task('a')]) // dropped b
    await timers.advance(300)
    expect(t.calls.commit.at(-1)?.deleted).toEqual([{ id: 'b', baseUpdatedAt: T0 }])
  })
})

describe('BoardSyncClient watch', () => {
  it('resyncs on a remote commit frame and applies the new truth', async () => {
    const { client, t, timers } = makeClient()
    await client.start()
    const remote = applyCommit(t.getDoc(), commitOf({ clientId: 'other', tasks: [task('x')] }), T0)
    t.setDoc(remote)
    const seen: number[] = []
    client.onRemote((_v, rev) => seen.push(rev))
    t.emit({ type: 'commit', revision: remote.revision, clientId: 'other' })
    await timers.advance(200)
    expect(client.view().tasks.map(x => x.id)).toEqual(['x'])
    expect(seen).toContain(remote.revision)
  })

  it('ignores its own commit frame (no echo resync)', async () => {
    const { client, t, timers } = makeClient()
    await client.start()
    const before = t.calls.fetch
    t.emit({ type: 'commit', revision: 5, clientId: 'tab-1' })
    await timers.advance(200)
    expect(t.calls.fetch).toBe(before)
  })

  it('takes a freed lease immediately on the lease frame', async () => {
    const { client, t } = makeClient({ leaseHeldByOther: true })
    await client.start()
    expect(client.isEngine()).toBe(false)
    t.setLeaseHeld(false)
    const engines: boolean[] = []
    client.onEngine(h => engines.push(h))
    t.emit({ type: 'lease', holder: undefined, expiresAt: undefined })
    await new Promise(resolve => setTimeout(resolve, 0))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(client.isEngine()).toBe(true)
    expect(engines).toContain(true)
  })

  it('delivers commands only while engine', async () => {
    const { client, t } = makeClient()
    await client.start()
    const got: string[] = []
    client.onCommand(c => got.push(c.taskId))
    t.emit({ type: 'command', command: { type: 'run', taskId: 'a', trigger: 'manual', clientId: 'x' } })
    expect(got).toEqual(['a'])
  })

  it('poll converges even without SSE frames', async () => {
    const { client, t, timers } = makeClient()
    await client.start()
    t.setDoc(applyCommit(emptyBoardDoc(T0), commitOf({ clientId: 'other', tasks: [task('z')] }), T0))
    await timers.advance(30_100) // a poll tick
    expect(client.view().tasks.map(x => x.id)).toEqual(['z'])
  })
})

describe('BoardSyncClient lease loop', () => {
  it('renews on the heartbeat and reports engine transitions', async () => {
    const { client, t, timers } = makeClient()
    await client.start()
    expect(client.isEngine()).toBe(true)
    const n = t.calls.lease.length
    await timers.advance(7_100)
    expect(t.calls.lease.length).toBeGreaterThan(n)
  })

  it('reports non-engine when another replica holds the lease', async () => {
    const { client } = makeClient({ leaseHeldByOther: true })
    await client.start()
    expect(client.isEngine()).toBe(false)
  })
})

describe('BoardSyncClient requestLaunch + dispose', () => {
  it('relays a launch command', async () => {
    const { client, t } = makeClient()
    await client.start()
    client.requestLaunch('t-9', 'manual')
    expect(t.calls.command).toEqual(['t-9'])
  })

  it('dispose releases the lease and stops the loops', async () => {
    const { client, t, timers } = makeClient()
    await client.start()
    client.dispose()
    expect(t.calls.lease.at(-1)?.release).toBe(true)
    const n = t.calls.lease.length
    await timers.advance(60_000)
    expect(t.calls.lease.length).toBe(n)
  })
})

// ── end-to-end convergence over the REAL host service ──────────────────────
//
// Two sync clients share one BoardDataService (a service-direct transport,
// no HTTP): this exercises the whole loop — commit → merge → persist → SSE
// broadcast → coalesced resync → adopt — exactly as two browsers would, and
// pins the guarantees the multi-device fix rests on: writes converge both
// ways, a delete propagates as a tombstone (no stale replica resurrects it),
// and concurrent edits to different rows coexist.

/** A transport that calls the real service directly (shared-clock harness). */
function serviceTransport(service: BoardDataService): BoardSyncTransport {
  return {
    async fetch(_clientId, since) {
      await service.ensureInit()
      const doc = service.getDoc()
      if (since !== undefined && since >= doc.revision) return { available: true, revision: doc.revision, unchanged: true }
      return { available: true, revision: doc.revision, doc }
    },
    async commit(commit) {
      const doc = await service.commit(commit)
      return { available: true, revision: doc.revision, doc }
    },
    async lease(clientId, options) {
      return options.release ? service.releaseLease(clientId) : service.acquireLease(clientId, options.ttlMs)
    },
    async command(_clientId, cmd) { service.submitCommand(cmd) },
    openStream(_clientId, handlers) {
      const off = service.subscribe(event => handlers.onEvent(event))
      handlers.onOpen()
      return off
    },
  }
}

function makeNode(service: BoardDataService, timers: ReturnType<typeof fakeTimers>, id: string): BoardSyncClient {
  return new BoardSyncClient({
    transport: serviceTransport(service),
    defer: timers.defer,
    now: timers.now,
    uuid: () => id,
    commitDebounceMs: 250,
    resyncCoalesceMs: 120,
    leaseRenewMs: 7_000,
    pollMs: 30_000,
  })
}

/** Advance until every scheduled commit/resync (and its follow-on) has run. */
async function settle(timers: ReturnType<typeof fakeTimers>): Promise<void> {
  for (let i = 0; i < 6; i++) await timers.advance(400)
}

describe('two replicas over one host service', () => {
  async function twoNodes() {
    const timers = fakeTimers()
    const service = new BoardDataService({ now: timers.now, openUnit: async () => new FakeUnit(), log: () => undefined })
    await service.init()
    const a = makeNode(service, timers, 'A')
    const b = makeNode(service, timers, 'B')
    await a.start()
    await b.start()
    return { timers, service, a, b }
  }

  it('a write on one replica converges on the other', async () => {
    const { timers, a, b } = await twoNodes()
    a.setTasks([createTask({ title: 'A', description: '', prompt: 'p' }, timers.now(), 't-1')])
    await settle(timers)
    expect(b.view().tasks.map(x => x.id)).toEqual(['t-1'])
  })

  it('a delete on one replica tombstones it for the other (no resurrection)', async () => {
    const { timers, a, b } = await twoNodes()
    const original = createTask({ title: 'A', description: '', prompt: 'p' }, timers.now(), 't-1')
    a.setTasks([original])
    await settle(timers)
    expect(b.view().tasks.map(x => x.id)).toEqual(['t-1'])
    b.setTasks([]) // B deletes it
    await settle(timers)
    expect(a.view().tasks).toHaveLength(0)
    // A's later re-commit of its stale copy (same original updatedAt) must
    // NOT resurrect it — the tombstone outranks the stale write.
    a.setTasks([original])
    await settle(timers)
    expect(b.view().tasks).toHaveLength(0)
  })

  it('concurrent edits to different rows coexist; the newer row wins its own', async () => {
    const { timers, a, b } = await twoNodes()
    const shared = createTask({ title: 'S', description: '', prompt: 'p' }, timers.now(), 't-s')
    a.setTasks([shared])
    await settle(timers)
    // Both now hold [shared]. A adds one row, B adds another (neither sees the other yet).
    a.setTasks([shared, createTask({ title: 'from-A', description: '', prompt: 'p' }, timers.now(), 't-a')])
    b.setTasks([shared, createTask({ title: 'from-B', description: '', prompt: 'p' }, timers.now(), 't-b')])
    await settle(timers)
    const idsA = a.view().tasks.map(x => x.id).sort()
    const idsB = b.view().tasks.map(x => x.id).sort()
    expect(idsA).toEqual(['t-a', 't-b', 't-s'])
    expect(idsB).toEqual(['t-a', 't-b', 't-s'])
  })

  it('exactly one replica holds the engine seat at a time', async () => {
    const { a, b } = await twoNodes()
    // A started first and took the lease on open; B is a viewer.
    expect(a.isEngine()).toBe(true)
    expect(b.isEngine()).toBe(false)
  })

  it('a cruise change on one replica reaches the other', async () => {
    const { timers, a, b } = await twoNodes()
    a.setCruise({ enabled: true, limit: 3, schedule: [] })
    await settle(timers)
    expect(b.view().cruise.enabled).toBe(true)
    expect(b.view().cruise.limit).toBe(3)
  })
})

// -- helpers ----------------------------------------------------------------

function commitOf(overrides: Partial<BoardCommit> = {}): BoardCommit {
  return {
    clientId: 'c',
    tasks: [],
    deleted: [],
    cruise: { value: { enabled: false, limit: 5, schedule: [] }, at: 0 },
    schedulePresets: { value: [], at: 0 },
    runPresets: { value: { presets: [] }, at: 0 },
    ...overrides,
  }
}

function boardView(doc: BoardDoc): BoardView {
  return { tasks: doc.tasks, cruise: doc.cruise.value, schedulePresets: doc.schedulePresets.value, runPresets: doc.runPresets.value }
}
