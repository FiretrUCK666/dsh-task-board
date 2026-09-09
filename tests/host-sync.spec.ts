/**
 * Board sync client tests: boot/mode, migration (bootstrap + backup),
 * debounced commit with in-flight refire, failure retry, SSE-driven resync
 * and lease/command routing, poll convergence, and dispose teardown. All
 * transport/timer/clock seams are faked so every path is driven directly.
 */
import { describe, expect, it } from 'vitest'
import { BoardSyncClient, SyncedPresetStore, SyncedRunPresetStore, SyncedTaskStore, type BoardSyncTransport, type SyncFetchResult, type SyncLedger } from '../src/core/host-sync.ts'
import { emptyBoardDoc, applyCommit, type BoardCommit, type BoardDoc, type BoardEvent, type BoardView } from '../src/core/board-doc.ts'
import { createTask, type TaskRecord } from '../src/core/tasks.ts'
import { BoardDataService } from '../src/host/board-service.ts'

const T0 = 1_700_000_000_000

/** A minimal in-memory KV unit (the real service persists through it). */
class FakeUnit {
  private global: unknown = undefined
  async loadAll(): Promise<{ global: unknown }> {
    return { global: this.global }
  }
  async setGlobal(value: unknown): Promise<void> {
    this.global = JSON.parse(JSON.stringify(value))
  }
  async close(): Promise<void> { /* no-op */ }
}

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
  const calls = {
    fetch: 0,
    commit: [] as BoardCommit[],
    lease: [] as Array<{ id: string; ttl?: number; release?: boolean; active?: boolean }>,
    command: [] as string[],
    releases: 0,
  }
  let doc: BoardDoc = emptyBoardDoc(T0)
  let available = true
  let commitFails = false
  let leaseHeld = false
  let leaseProto: number | undefined = 2
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
      calls.lease.push({ id: clientId, ttl: options.ttlMs, release: options.release, active: options.active })
      const base = options.release
        ? { held: false, holder: undefined, expiresAt: undefined }
        : leaseHeld ? { held: false, holder: 'other', expiresAt: T0 + 99999 } : { held: true, holder: clientId, expiresAt: T0 + 99999 }
      return { ...base, ...(leaseProto !== undefined ? { proto: leaseProto } : {}) }
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
    /** undefined = a host that predates the lease protocol version. */
    setLeaseProto: (v: number | undefined) => { leaseProto = v },
    emit: (event: BoardEvent) => streamHandler?.onEvent(event),
    open: () => streamHandler?.onOpen(),
  }
}

function makeClient(over: { leaseHeldByOther?: boolean; visibility?: boolean } = {}) {
  const timers = fakeTimers()
  const t = fakeTransport()
  const logs: string[] = []
  let visible = over.visibility !== false
  const visibleCbs: Array<() => void> = []
  const hiddenCbs: Array<() => void> = []
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
    visibility: {
      is: () => visible,
      onVisible: cb => { visibleCbs.push(cb); return () => { visibleCbs.splice(visibleCbs.indexOf(cb), 1) } },
      onHidden: cb => { hiddenCbs.push(cb); return () => { hiddenCbs.splice(hiddenCbs.indexOf(cb), 1) } },
    },
  })
  if (over.leaseHeldByOther) t.setLeaseHeld(true)
  const setHidden = (): void => {
    visible = false
    for (const cb of [...hiddenCbs]) cb()
  }
  const setVisible = (): void => {
    visible = true
    for (const cb of [...visibleCbs]) cb()
  }
  return { client, timers, t, logs, setHidden, setVisible }
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

  it('unions a diverging local ledger into a non-empty host and parks a backup', async () => {
    const { client, t } = makeClient()
    t.setDoc(applyCommit(emptyBoardDoc(T0), commitOf({ tasks: [task('host')] }), T0))
    const backups: BoardView[] = []
    client.onBackup(v => backups.push(v))
    await client.start(() => ({ tasks: [task('local')], cruise: { enabled: true, limit: 9, schedule: [] }, schedulePresets: [], runPresets: { presets: [] } }))
    // The diverging local copy is parked (forensics), and BOTH records live on
    // the shared board — a late device's own tasks are never hidden behind
    // the first device's bootstrap.
    expect(backups).toHaveLength(1)
    expect(backups[0].tasks.map(x => x.id)).toEqual(['local'])
    expect(client.view().tasks.map(x => x.id).sort()).toEqual(['host', 'local'])
    expect(t.getDoc().tasks.map(x => x.id).sort()).toEqual(['host', 'local'])
    // Sections stay the host's (the late device's stale cruise must not stomp).
    expect(client.view().cruise.enabled).toBe(false)
  })

  it('an older local copy of a host task never overwrites the newer host record', async () => {
    const { client, t } = makeClient()
    const fresh = { ...task('a'), title: 'host-new', updatedAt: T0 + 100 }
    t.setDoc(applyCommit(emptyBoardDoc(T0), commitOf({ tasks: [fresh] }), T0))
    // The replica still holds a stale copy of the SAME task (older updatedAt).
    await client.start(() => ({ tasks: [task('a')], cruise: { enabled: false, limit: 5, schedule: [] }, schedulePresets: [], runPresets: { presets: [] } }))
    expect(client.view().tasks).toHaveLength(1)
    expect(client.view().tasks[0].title).toBe('host-new')
  })

  it('no backup and no commit when local matches host', async () => {
    const { client, t } = makeClient()
    const doc = applyCommit(emptyBoardDoc(T0), commitOf({ tasks: [task('a')] }), T0)
    t.setDoc(doc)
    const backups: BoardView[] = []
    client.onBackup(v => backups.push(v))
    await client.start(() => boardView(doc))
    expect(backups).toHaveLength(0)
    expect(t.calls.commit).toHaveLength(0)
  })

  it('backs up when tasks match but sections diverged (late-device cruise is never silently dropped)', async () => {
    const { client, t } = makeClient()
    const doc = applyCommit(emptyBoardDoc(T0), commitOf({ tasks: [task('a')] }), T0)
    t.setDoc(doc)
    const backups: BoardView[] = []
    client.onBackup(v => backups.push(v))
    const local = boardView(doc)
    await client.start(() => ({ ...local, cruise: { enabled: true, limit: 9, schedule: [] } }))
    expect(backups).toHaveLength(1)
    expect(backups[0].cruise.enabled).toBe(true)
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

  it('backs off exponentially and parks after the retry budget', async () => {
    const { client, t, timers } = makeClient()
    await client.start()
    t.setCommitFails(true)
    client.setTasks([task('a')])
    await timers.advance(300)
    expect(t.calls.commit).toHaveLength(1)
    // 2s → 4s → 8s → 16s → 30s(cap): five retries, then silence.
    await timers.advance(2_100)
    expect(t.calls.commit).toHaveLength(2)
    await timers.advance(4_100)
    expect(t.calls.commit).toHaveLength(3)
    await timers.advance(8_100)
    expect(t.calls.commit).toHaveLength(4)
    await timers.advance(16_100)
    expect(t.calls.commit).toHaveLength(5)
    await timers.advance(30_100)
    expect(t.calls.commit).toHaveLength(6)
    // Budget spent: no more timers spin against the dead host…
    await timers.advance(120_000)
    expect(t.calls.commit).toHaveLength(6)
    // …but the dirty state is kept: the view still serves the local edit…
    expect(client.view().tasks.map(entry => entry.id)).toEqual(['a'])
    // …and the next local write reopens the cycle with a fresh budget.
    t.setCommitFails(false)
    client.setTasks([task('a'), task('b')])
    await timers.advance(300)
    expect(t.calls.commit).toHaveLength(7)
  })

  it('a parked replica keeps reading remote arrivals (never a phantom delete)', async () => {
    const { client, t, timers } = makeClient()
    await client.start()
    t.setCommitFails(true)
    client.setTasks([task('a')])
    await timers.advance(300)
    expect(t.calls.commit).toHaveLength(1)
    // Park the replica (five failed retries, stepped so each async chain lands).
    await timers.advance(2_100)
    await timers.advance(4_100)
    await timers.advance(8_100)
    await timers.advance(16_100)
    await timers.advance(30_100)
    expect(t.calls.commit).toHaveLength(6)
    // A remote row lands while parked: the poll adopts it…
    const remote = applyCommit(t.getDoc(), commitOf({ clientId: 'other', tasks: [task('b', T0 + 10)] }), T0 + 10)
    t.setDoc(remote)
    await timers.advance(30_100) // the poll beat
    // …and the parked view serves BOTH rows (no phantom delete, reads converge).
    expect(client.view().tasks.map(entry => entry.id).sort()).toEqual(['a', 'b'])
    // Recovery: the next flush carries no deletion for the remote row.
    t.setCommitFails(false)
    client.setTasks(client.view().tasks)
    await timers.advance(300)
    const last = t.calls.commit.at(-1)!
    expect(last.deleted ?? []).toEqual([])
    expect(last.tasks.map(entry => entry.id).sort()).toEqual(['a', 'b'])
  })

  it('a user-intended delete rides the accrued stamp (never a recomputed one)', async () => {
    const { client, t, timers } = makeClient()
    t.setDoc(applyCommit(emptyBoardDoc(T0), commitOf({ tasks: [task('a'), task('b')] }), T0))
    await client.start()
    t.setCommitFails(true)
    client.setTasks([task('a')]) // the user drops b
    await timers.advance(300)
    expect(t.calls.commit).toHaveLength(1)
    expect(t.calls.commit[0].deleted).toEqual([{ id: 'b', baseUpdatedAt: T0 }])
    // Parked with the delete still unacked…
    await timers.advance(2_100 + 4_100 + 8_100 + 16_100 + 30_100)
    // …the view hides b (the user's intent), and recovery transmits it once.
    expect(client.view().tasks.map(entry => entry.id)).toEqual(['a'])
    t.setCommitFails(false)
    client.setTasks(client.view().tasks)
    await timers.advance(300)
    expect(t.calls.commit.at(-1)?.deleted).toEqual([{ id: 'b', baseUpdatedAt: T0 }])
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

  it('heartbeats carry visibility, and going HIDDEN hands the flag over immediately', async () => {
    const { client, t, setHidden, setVisible } = makeClient()
    await client.start()
    expect(t.calls.lease.at(-1)?.active).toBe(true)
    // Backgrounded: an immediate active:false write, so a visible device may
    // preempt at once (a frozen tab can never renew anything itself).
    setHidden()
    await Promise.resolve()
    expect(t.calls.lease.at(-1)?.active).toBe(false)
    // Foreground again: renew active:true immediately (no heartbeat wait).
    setVisible()
    await Promise.resolve()
    expect(t.calls.lease.at(-1)?.active).toBe(true)
  })

  it('a host without the lease protocol version reads as stale (proto 1)', async () => {
    const { client, t } = makeClient()
    t.setLeaseProto(undefined) // a pre-visibility host answers no version
    await client.start()
    expect(client.hostProtoVersion()).toBe(1)
    t.setLeaseProto(2)
    await client.renewLease()
    expect(client.hostProtoVersion()).toBe(2)
  })

  it('the protocol is UNKNOWN (not "stale") until the first lease answers', async () => {
    // "No evidence yet" must never read as "old host" — a failed first probe
    // used to flash a false 「服务端未重启」 banner.
    const { client } = makeClient()
    expect(client.hostProtoVersion()).toBeUndefined()
  })

  it('a PROTOCOL-ONLY change fires the seat listener (the stale-banner clear)', async () => {
    // The exact bug: a host restart moves the protocol WITHOUT moving the
    // seat. Notifying only on held changes left every viewer staring at the
    // stale banner until a manual refresh.
    const { client, t } = makeClient({ leaseHeldByOther: true })
    t.setLeaseProto(1)
    await client.start()
    const seats: boolean[] = []
    client.onEngine(held => seats.push(held))
    t.setLeaseProto(2) // the host restarted; this replica stays a viewer
    await client.renewLease()
    expect(client.isEngine()).toBe(false)
    expect(seats).toEqual([false])
    expect(client.hostProtoVersion()).toBe(2)
    // A heartbeat with nothing moved fires nothing (no notify storms).
    await client.renewLease()
    expect(seats).toHaveLength(1)
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

  it('section edits ride claims and converge both ways', async () => {
    const { timers, a, b } = await twoNodes()
    a.setCruise({ enabled: true, limit: 3, schedule: [] })
    await settle(timers)
    // B (fresh on A's flip) writes the section back — claimed, accepted, and
    // A converges on B's value.
    b.setCruise({ enabled: false, limit: 9, schedule: [] })
    await settle(timers)
    expect(a.view().cruise.enabled).toBe(false)
    expect(a.view().cruise.limit).toBe(9)
    // A task-only commit from B carries its baseline cruise copy UNCLAIMED —
    // the section must not move.
    b.setTasks([createTask({ title: 'T', description: '', prompt: 'p' }, timers.now(), 't-x')])
    await settle(timers)
    expect(a.view().cruise.limit).toBe(9)
    expect(a.view().tasks.map(task => task.id)).toEqual(['t-x'])
  })

  it('a clock-skewed reorder on B still lands (authorship claim, not timestamp)', async () => {
    const { timers, a, b } = await twoNodes()
    // A establishes a two-session task on the shared row (A's clock is ahead).
    const base = createTask({ title: 'S', description: '', prompt: 'p' }, timers.now(), 't-s')
    a.setTasks([{ ...base, sessionsOrder: ['s-1', 's-2'] }])
    await settle(timers)
    // B reorders, but its record carries an OLDER updatedAt (skewed clock):
    // LWW alone would reject it; the content diff claims it, so the host takes
    // B's order and it reaches A.
    b.setTasks([{ ...a.view().tasks[0]!, sessionsOrder: ['s-2', 's-1'], updatedAt: 10 }])
    await settle(timers)
    expect(a.view().tasks[0].sessionsOrder).toEqual(['s-2', 's-1'])
    expect(b.view().tasks[0].sessionsOrder).toEqual(['s-2', 's-1'])
  })

  it('a stale full-array write does not clobber a newer remote row it never edited', async () => {
    const { timers, a, b } = await twoNodes()
    const shared = createTask({ title: 'S', description: '', prompt: 'p' }, timers.now(), 't-s')
    const other = createTask({ title: 'O', description: '', prompt: 'p' }, timers.now(), 't-o')
    a.setTasks([shared, other])
    await settle(timers)
    // B now holds both. B edits ONLY t-o (its t-s copy is untouched).
    b.setTasks([shared, { ...other, title: 'O-from-B', updatedAt: timers.now() + 5 }])
    // Meanwhile A renames t-s (a row B's snapshot still carries stale).
    a.setTasks([{ ...shared, title: 'S-from-A', updatedAt: timers.now() + 1 }, other])
    await settle(timers)
    // B's stale t-s copy must not resurrect over A's rename; B's real t-o edit lands.
    const byId = (id: string) => a.view().tasks.find(task => task.id === id)!.title
    expect(byId('t-s')).toBe('S-from-A')
    expect(byId('t-o')).toBe('O-from-B')
    expect(b.view().tasks.find(task => task.id === 't-s')!.title).toBe('S-from-A')
  })
})

// -- helpers ----------------------------------------------------------------
function commitOf(overrides: Partial<BoardCommit> = {}): BoardCommit {  return {
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

describe('synced store seams (offline-first mount)', () => {
  function task(id: string, title: string): TaskRecord {
    return createTask({ title, description: '', prompt: 'p' }, T0, id)
  }
  function ledger(opts: { synced: boolean; tasks: TaskRecord[] }): SyncLedger & { pushed: TaskRecord[][] } {
    const pushed: TaskRecord[][] = []
    return {
      pushed,
      isSynced: () => opts.synced,
      view: (): BoardView => ({
        tasks: opts.tasks,
        cruise: { enabled: false, limit: 5, schedule: [] },
        schedulePresets: [],
        runPresets: { presets: [] },
      }),
      setTasks: (tasks: readonly TaskRecord[]) => { pushed.push([...tasks]) },
      setCruise: () => {},
      setSchedulePresets: () => {},
      setRunPresets: () => {},
    }
  }
  function mirror(tasks: TaskRecord[]): { load(): TaskRecord[]; save(t: readonly TaskRecord[]): void; clear(): void; saved: TaskRecord[][] } {
    let rows = [...tasks]
    const saved: TaskRecord[][] = []
    return {
      saved,
      load: () => [...rows],
      save: (next: readonly TaskRecord[]) => { rows = [...next]; saved.push([...next]) },
      clear: () => { rows = [] },
    }
  }

  it('reads the mirror before adoption, the host truth after (first paint never waits)', () => {
    const local = [task('local-1', 'Local')]
    const remote = [task('host-1', 'Host')]
    const unsynced = ledger({ synced: false, tasks: remote })
    const store = new SyncedTaskStore(unsynced, mirror(local))
    // Pre-sync: the entry opens on local data even though a host doc exists.
    expect(store.load().map(t => t.id)).toEqual(['local-1'])
    const synced = ledger({ synced: true, tasks: remote })
    const adopted = new SyncedTaskStore(synced, mirror(local))
    expect(adopted.load().map(t => t.id)).toEqual(['host-1'])
  })

  it('writes always warm the mirror AND mark the synced view (pre-sync writes ride migration)', () => {
    const sync = ledger({ synced: false, tasks: [] })
    const local = mirror([])
    const store = new SyncedTaskStore(sync, local)
    const rows = [task('fresh', 'Fresh')]
    store.save(rows)
    // The mirror has it (migration reads the mirror); the sync face got it too.
    expect(local.saved).toEqual([rows])
    expect(sync.pushed).toEqual([rows])
  })

  it('preset seams follow the same fallback (mirror before adoption, view after)', () => {
    const unsynced = ledger({ synced: false, tasks: [] })
    const presets = new SyncedPresetStore(unsynced, {
      load: () => [{ id: 'local', label: 'Local', cron: '' }],
      save: () => {},
      clear: () => {},
    })
    expect(presets.load().map(p => p.id)).toEqual(['local'])
    const runs = new SyncedRunPresetStore(unsynced, {
      load: () => ({ presets: [{ id: 'r', name: 'R', config: {} }], defaultId: undefined }),
      save: () => {},
      clear: () => {},
    })
    expect(runs.load().presets.map(p => p.id)).toEqual(['r'])
  })
})
