/**
 * Board data service tests: document load/persist through a fake KV unit,
 * commit serialization + broadcast, lease acquire/renew/disconnect-grace/
 * takeover, and the command relay (live-engine broadcast vs parked replay).
 */
import { describe, expect, it } from 'vitest'
import { applyCommit, emptyBoardDoc, type BoardCommit, type BoardDoc } from '../src/core/board-doc.ts'
import { createTask } from '../src/core/tasks.ts'
import {
  BoardDataService,
  clampLeaseTtl,
  LEASE_DEFAULT_TTL_MS,
  LEASE_DISCONNECT_GRACE_MS,
  LEASE_MAX_TTL_MS,
  LEASE_MIN_TTL_MS,
  type BoardEvent,
  type KvUnitLike,
} from '../src/host/board-service.ts'

const T0 = 1_700_000_000_000

/** A fake KV unit: in-memory global + a load counter + a throwing mode. */
class FakeUnit implements KvUnitLike {
  global: unknown = undefined
  loadCount = 0
  setCount = 0
  throwOnSet = false
  closed = false
  async loadAll(): Promise<{ global: unknown }> {
    this.loadCount += 1
    return { global: this.global }
  }
  async setGlobal(value: unknown): Promise<void> {
    if (this.throwOnSet) throw new Error('disk full')
    this.setCount += 1
    this.global = JSON.parse(JSON.stringify(value))
  }
  async close(): Promise<void> {
    this.closed = true
  }
}

function makeService(unit: FakeUnit | undefined, clock = { t: T0 }) {
  const events: BoardEvent[] = []
  const service = new BoardDataService({
    now: () => clock.t,
    openUnit: async () => unit,
    log: () => undefined,
  })
  return { service, events, clock, unit }
}

function commitOf(overrides: Partial<BoardCommit> = {}): BoardCommit {
  return {
    clientId: 'c-1',
    tasks: [],
    deleted: [],
    cruise: { value: { enabled: false, limit: 5, schedule: [] }, at: 0 },
    schedulePresets: { value: [], at: 0 },
    runPresets: { value: { presets: [] }, at: 0 },
    ...overrides,
  }
}

describe('BoardDataService init', () => {
  it('is unavailable when there is no persistence opener', async () => {
    const service = new BoardDataService({ now: () => T0, log: () => undefined })
    await service.init()
    expect(service.available).toBe(false)
  })

  it('is unavailable when the opener yields no unit', async () => {
    const { service } = makeService(undefined)
    await service.init()
    expect(service.available).toBe(false)
  })

  it('opens available with an empty document on a fresh medium', async () => {
    const unit = new FakeUnit()
    const { service } = makeService(unit)
    await service.init()
    expect(service.available).toBe(true)
    expect(service.getDoc().revision).toBe(0)
    expect(service.getDoc().bornAt).toBe(T0)
  })

  it('restores a persisted document from the medium', async () => {
    const unit = new FakeUnit()
    unit.global = emptyBoardDoc(T0)
    const seeded = applyCommit(unit.global as BoardDoc, commitOf({ tasks: [createTask({ title: 'A', description: '', prompt: '' }, T0, 't-a')] }), T0 + 1)
    unit.global = seeded
    const { service } = makeService(unit)
    await service.init()
    expect(service.getDoc().tasks.map(t => t.id)).toEqual(['t-a'])
    expect(service.getDoc().revision).toBe(seeded.revision)
  })

  it('init is idempotent', async () => {
    const unit = new FakeUnit()
    const { service } = makeService(unit)
    await service.init()
    await service.init()
    expect(unit.loadCount).toBe(1)
  })
})

describe('BoardDataService commit', () => {
  it('persists and broadcasts a real change; a no-op neither persists nor broadcasts', async () => {
    const unit = new FakeUnit()
    const { service } = makeService(unit)
    await service.init()
    const events: BoardEvent[] = []
    service.subscribe(e => events.push(e))
    const task = createTask({ title: 'A', description: '', prompt: '' }, T0, 't-a')
    const doc = await service.commit(commitOf({ tasks: [task] }))
    expect(doc.revision).toBe(1)
    expect(unit.setCount).toBe(1)
    expect(events).toEqual([{ type: 'commit', revision: 1, clientId: 'c-1' }])
    // Re-commit the same content: nothing moves.
    const again = await service.commit(commitOf({ tasks: [task] }))
    expect(again.revision).toBe(1)
    expect(unit.setCount).toBe(1)
    expect(events).toHaveLength(1)
  })

  it('serializes concurrent commits on the write lane (revision advances in order)', async () => {
    const unit = new FakeUnit()
    const { service } = makeService(unit)
    await service.init()
    const a = createTask({ title: 'A', description: '', prompt: '' }, T0, 't-a')
    const b = createTask({ title: 'B', description: '', prompt: '' }, T0, 't-b')
    const [docA, docB] = await Promise.all([
      service.commit(commitOf({ tasks: [a] })),
      service.commit(commitOf({ tasks: [b] })),
    ])
    expect(docA.revision).toBe(1)
    expect(docB.revision).toBe(2)
    expect(service.getDoc().tasks.map(t => t.id).sort()).toEqual(['t-a', 't-b'])
  })

  it('keeps serving from memory when the persist throws', async () => {
    const unit = new FakeUnit()
    const { service } = makeService(unit)
    await service.init()
    unit.throwOnSet = true
    const doc = await service.commit(commitOf({ tasks: [createTask({ title: 'A', description: '', prompt: '' }, T0, 't-a')] }))
    expect(doc.tasks).toHaveLength(1)
    expect(service.getDoc().tasks).toHaveLength(1)
  })
})

describe('BoardDataService lease', () => {
  it('grants a free lease, holds it for the holder, refuses others', async () => {
    const { service, clock } = makeService(new FakeUnit())
    await service.init()
    const first = service.acquireLease('a', 20_000)
    expect(first.held).toBe(true)
    expect(first.holder).toBe('a')
    const other = service.acquireLease('b', 20_000)
    expect(other.held).toBe(false)
    expect(other.holder).toBe('a')
    // Renewing the holder extends.
    clock.t += 10_000
    const renew = service.acquireLease('a', 20_000)
    expect(renew.held).toBe(true)
    // After expiry, b takes over.
    clock.t += 20_000
    const takeover = service.acquireLease('b', 20_000)
    expect(takeover.held).toBe(true)
    expect(takeover.holder).toBe('b')
  })

  it('noteActivity renews the holder only', async () => {
    const { service, clock } = makeService(new FakeUnit())
    await service.init()
    service.acquireLease('a', LEASE_MIN_TTL_MS)
    clock.t += 8_000
    service.noteActivity('a')
    clock.t += 8_000
    expect(service.leaseState().held).toBe(true)
    service.noteActivity('other')
  })

  it('a dropped SSE connection shortens the holder lease to the grace window', async () => {
    const { service, clock } = makeService(new FakeUnit())
    await service.init()
    service.acquireLease('a', 60_000)
    service.noteDisconnect('a')
    clock.t += LEASE_DISCONNECT_GRACE_MS + 1
    expect(service.leaseState().held).toBe(false)
  })

  it('release frees the seat immediately', async () => {
    const { service } = makeService(new FakeUnit())
    await service.init()
    service.acquireLease('a')
    service.releaseLease('a')
    expect(service.acquireLease('b').held).toBe(true)
  })
})

describe('BoardDataService command relay', () => {
  it('broadcasts to a live engine immediately', async () => {
    const { service } = makeService(new FakeUnit())
    await service.init()
    service.acquireLease('a')
    const events: BoardEvent[] = []
    service.subscribe(e => events.push(e))
    const { queued } = service.submitCommand({ type: 'run', taskId: 't-1', trigger: 'manual', clientId: 'x' })
    expect(queued).toBe(false)
    expect(events).toEqual([{ type: 'command', command: { type: 'run', taskId: 't-1', trigger: 'manual', clientId: 'x' } }])
  })

  it('parks when no engine holds the lease and replays on the next grant', async () => {
    const { service } = makeService(new FakeUnit())
    await service.init()
    const events: BoardEvent[] = []
    service.subscribe(e => events.push(e))
    const { queued } = service.submitCommand({ type: 'run', taskId: 't-1', trigger: 'manual', clientId: 'x' })
    expect(queued).toBe(true)
    expect(events.filter(e => e.type === 'command')).toHaveLength(0)
    // A lease grant drains the parked command.
    service.acquireLease('a')
    const commands = events.filter(e => e.type === 'command')
    expect(commands).toHaveLength(1)
  })

  it('dedups parked commands per task (newest wins)', async () => {
    const { service } = makeService(new FakeUnit())
    await service.init()
    service.submitCommand({ type: 'run', taskId: 't-1', trigger: 'manual', clientId: 'x' })
    service.submitCommand({ type: 'run', taskId: 't-1', trigger: 'schedule', clientId: 'y' })
    const events: BoardEvent[] = []
    service.subscribe(e => events.push(e))
    service.acquireLease('a')
    const commands = events.filter(e => e.type === 'command')
    expect(commands).toHaveLength(1)
    expect(commands[0]).toMatchObject({ command: { taskId: 't-1', trigger: 'schedule' } })
  })
})

describe('clampLeaseTtl', () => {
  it('bounds the requested TTL into the safe band', () => {
    expect(clampLeaseTtl(undefined)).toBe(LEASE_DEFAULT_TTL_MS)
    expect(clampLeaseTtl(1)).toBe(LEASE_MIN_TTL_MS)
    expect(clampLeaseTtl(1_000_000)).toBe(LEASE_MAX_TTL_MS)
    expect(clampLeaseTtl(NaN)).toBe(LEASE_DEFAULT_TTL_MS)
  })
})

describe('BoardDataService dispose', () => {
  it('closes the unit and stops broadcasting', async () => {
    const unit = new FakeUnit()
    const { service } = makeService(unit)
    await service.init()
    const events: BoardEvent[] = []
    service.subscribe(e => events.push(e))
    await service.dispose()
    expect(unit.closed).toBe(true)
    expect(service.available).toBe(false)
    await service.commit(commitOf({ tasks: [createTask({ title: 'A', description: '', prompt: '' }, T0, 't-a')] }))
    expect(events).toHaveLength(0)
  })
})
