/**
 * Document service tests: document load/persist through a fake KV unit,
 * commit serialization + broadcast, lease acquire/renew/disconnect-grace/
 * takeover, and the command relay (live-engine broadcast vs parked replay).
 *
 * The checklist (the second document) rides the same service and the same
 * handle, so what is pinned here about the board is pinned about it too: a
 * document of its own, its own revision, its own no-op rule.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { applyCommit, emptyBoardDoc, type BoardCommit, type BoardDoc } from '../src/core/board-doc.ts'
import { createTask } from '../src/core/tasks.ts'
import { applyItemsCommit, emptyItemsDoc, type ItemsCommit, type ItemsDoc } from '../src/core/items-doc.ts'
import type { ItemRecord } from '../src/core/item.ts'
import {
  DocumentService,
  clampLeaseTtl,
  BOARD_DOCUMENT,
  BOARD_UNIT_TABLE,
  BOARD_UNIT_VERSION,
  ITEMS_DOCUMENT,
  META_DOCUMENT,
  openBoardUnit,
  LEASE_DEFAULT_TTL_MS,
  LEASE_DISCONNECT_GRACE_MS,
  LEASE_PROTOCOL_ACTIVE,
  STREAM_ALIVE_MAX_MS,
  LEASE_MAX_TTL_MS,
  LEASE_MIN_TTL_MS,
  type BoardEvent,
  type BoardUnitDescriptor,
  type KvUnitLike,
} from '../src/host/board-service.ts'
import type { RetireOptions, RetireOutcome } from '../src/host/data-root.ts'

const T0 = 1_700_000_000_000

/** A fake KV unit over the real document tree: in-memory records per table, a
 *  load counter, a write counter, and a throwing mode.
 *
 *  It starts ALREADY MIGRATED (the tree carries the `meta` marker), so tests
 *  that are not about the layout migration do not pay for its probe. A test
 *  that IS about it empties the tree with `unit.tables = {}`. */
class FakeUnit implements KvUnitLike {
  tables: Record<string, Record<string, unknown>> = {
    [BOARD_UNIT_TABLE]: { [META_DOCUMENT]: { schemaVersion: BOARD_UNIT_VERSION, legacyImported: false, legacyProbedAt: 0 } },
  }
  loadCount = 0
  putCount = 0
  /** The record key of every write, in order — the granularity assertion
   *  ("an item write touches the items file and nothing else") reads this. */
  writes: string[] = []
  throwOnWrite = false
  closed = false
  /** The board record, or undefined when the tree holds none. */
  get board(): unknown {
    return this.tables[BOARD_UNIT_TABLE]?.[BOARD_DOCUMENT]
  }
  set board(value: unknown) {
    this.record(BOARD_DOCUMENT, value)
  }
  /** The checklist record, or undefined when the tree holds none. */
  get items(): unknown {
    return this.tables[BOARD_UNIT_TABLE]?.[ITEMS_DOCUMENT]
  }
  set items(value: unknown) {
    this.record(ITEMS_DOCUMENT, value)
  }
  private record(key: string, value: unknown): void {
    const table = this.tables[BOARD_UNIT_TABLE] ?? {}
    table[key] = JSON.parse(JSON.stringify(value))
    this.tables[BOARD_UNIT_TABLE] = table
  }
  async loadAll(): Promise<{ tables: Record<string, Record<string, unknown>> }> {
    this.loadCount += 1
    return { tables: this.tables }
  }
  async putRecord(table: string, key: string, value: unknown): Promise<void> {
    if (this.throwOnWrite) throw new Error('disk full')
    this.putCount += 1
    this.writes.push(key)
    const records = this.tables[table] ?? {}
    records[key] = JSON.parse(JSON.stringify(value))
    this.tables[table] = records
  }
  async close(): Promise<void> {
    this.closed = true
  }
}

function makeService(unit: FakeUnit | undefined, clock = { t: T0 }) {
  const events: BoardEvent[] = []
  const service = new DocumentService({
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

/** One checklist row, with only what a test cares about overridden. */
function row(patch: Partial<ItemRecord> = {}): ItemRecord {
  return {
    id: 'i-1',
    ref: 1,
    title: 'a thing',
    body: '',
    notes: '',
    steps: [],
    status: 'open',
    priority: 'normal',
    tags: [],
    startsAfter: undefined,
    dueAt: undefined,
    hardDueAt: undefined,
    taskId: undefined,
    origin: { source: 'human', at: T0 },
    createdAt: T0,
    updatedAt: T0,
    ...patch,
  }
}

/** A checklist commit carrying only what changed. */
function itemsCommitOf(overrides: Partial<ItemsCommit> = {}): ItemsCommit {
  return { clientId: 'c-1', items: [], deleted: [], ...overrides }
}

describe('DocumentService init', () => {
  it('is unavailable when there is no persistence opener', async () => {
    const service = new DocumentService({ now: () => T0, log: () => undefined })
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
    unit.board = emptyBoardDoc(T0)
    const seeded = applyCommit(unit.board as BoardDoc, commitOf({ tasks: [createTask({ title: 'A', description: '', prompt: '' }, T0, 't-a')] }), T0 + 1)
    unit.board = seeded
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

describe('DocumentService commit', () => {
  it('persists and broadcasts a real change; a no-op neither persists nor broadcasts', async () => {
    const unit = new FakeUnit()
    const { service } = makeService(unit)
    await service.init()
    const events: BoardEvent[] = []
    service.subscribe(e => events.push(e))
    const task = createTask({ title: 'A', description: '', prompt: '' }, T0, 't-a')
    const doc = await service.commit(commitOf({ tasks: [task] }))
    expect(doc.revision).toBe(1)
    expect(unit.putCount).toBe(1)
    // The frame NAMES its document: two documents share one stream, so a
    // frame that does not say which one moved is a frame two devices can read
    // two different ways.
    expect(events).toEqual([{ type: 'commit', document: 'board', revision: 1, clientId: 'c-1' }])
    // Re-commit the same content: nothing moves.
    const again = await service.commit(commitOf({ tasks: [task] }))
    expect(again.revision).toBe(1)
    expect(unit.putCount).toBe(1)
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
    unit.throwOnWrite = true
    const doc = await service.commit(commitOf({ tasks: [createTask({ title: 'A', description: '', prompt: '' }, T0, 't-a')] }))
    expect(doc.tasks).toHaveLength(1)
    expect(service.getDoc().tasks).toHaveLength(1)
  })
})

describe('DocumentService lease', () => {
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

  it('every lease answer — granted, renewing, REJECTED, released — carries proto and bootedAt', async () => {
    // The whole stale-host confusion came from ONE branch that hand-built its
    // own `{ held, holder, expiresAt }` and forgot the evidence fields: every
    // non-engine device read "old server" from a current server. The type now
    // requires both fields, and this pins the behaviour across all branches.
    const { service, clock } = makeService(new FakeUnit())
    await service.init()
    const granted = service.acquireLease('a', 20_000)
    const rejected = service.acquireLease('b', 20_000)
    clock.t += 10_000
    const renewing = service.acquireLease('a', 20_000)
    const released = service.releaseLease('a')
    for (const answer of [granted, rejected, renewing, released, service.leaseState()]) {
      expect(answer.proto).toBe(LEASE_PROTOCOL_ACTIVE)
      expect(answer.bootedAt).toBe(service.bootedAt)
      expect(Number.isFinite(answer.bootedAt)).toBe(true)
    }
    // The rejected answer is the SAME authoritative view with only the
    // caller-relative flag flipped (holder/expiresAt still name the engine).
    expect(rejected.held).toBe(false)
    expect(rejected.holder).toBe(granted.holder)
    expect(rejected.expiresAt).toBe(granted.expiresAt)
  })

  it('leaseState is the ONLY place a LeaseState literal is built (one construction site)', () => {
    // A second construction site is how the bug was born; the ban is mechanical
    // so nobody can re-introduce a partial seat answer "just this once".
    const source = readFileSync(fileURLToPath(new URL('../src/host/board-service.ts', import.meta.url)), 'utf8')
    const bodies = source.match(/\{\s*held:/g) ?? []
    const spreads = source.match(/\{\s*\.\.\.current/g) ?? []
    expect(bodies).toHaveLength(4)
    // The one rejection branch is a spread of the authoritative view, never a
    // re-typed literal.
    expect(spreads.length).toBeGreaterThan(0)
    expect(source).not.toMatch(/\{\s*held:\s*false,\s*holder:\s*current\.holder/)
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

  it('an open SSE stream keeps the lease alive only while the holder still touches the API', async () => {
    const { service, clock } = makeService(new FakeUnit())
    await service.init()
    service.acquireLease('a', LEASE_MIN_TTL_MS)
    service.noteStreamOpen('a')
    // A THROTTLED tab (timers crawl, JS alive): its touches keep the seat, and
    // the live stream bridges the gaps between them.
    clock.t += LEASE_MIN_TTL_MS * 2
    service.noteActivity('a')
    clock.t += LEASE_MIN_TTL_MS * 2
    expect(service.leaseState().held).toBe(true)
    expect(service.acquireLease('b').held).toBe(false)
    // A FROZEN tab touches nothing: past the stream-alive bound the half-open
    // socket stops proving liveness, and a visible device takes the seat (the
    // zombie-holder starvation this used to cause forever).
    clock.t += STREAM_ALIVE_MAX_MS + 1
    expect(service.leaseState().held).toBe(false)
    expect(service.acquireLease('b', undefined, true).held).toBe(true)
  })

  it('release clears the lease even with a live stream', async () => {
    const { service } = makeService(new FakeUnit())
    await service.init()
    service.acquireLease('a')
    service.noteStreamOpen('a')
    service.releaseLease('a')
    expect(service.leaseState().held).toBe(false)
    expect(service.acquireLease('b').held).toBe(true)
  })

  it('release frees the seat immediately', async () => {
    const { service } = makeService(new FakeUnit())
    await service.init()
    service.acquireLease('a')
    service.releaseLease('a')
    expect(service.acquireLease('b').held).toBe(true)
  })

  it('a VISIBLE replica preempts a hidden holder; two visible replicas never flip-flop', async () => {
    const { service } = makeService(new FakeUnit())
    await service.init()
    // Phone opens first (visible) and takes the seat, then goes hidden.
    expect(service.acquireLease('phone', 20_000, true).held).toBe(true)
    service.acquireLease('phone', 20_000, false) // phone hides (renews inactive)
    // PC (the user is chatting here) is visible: it preempts the hidden phone.
    const pc = service.acquireLease('pc', 20_000, true)
    expect(pc.held).toBe(true)
    expect(pc.holder).toBe('pc')
    // The hidden phone can no longer take it back from the visible PC.
    expect(service.acquireLease('phone', 20_000, false).holder).toBe('pc')
    // A SECOND visible replica does NOT steal from a visible holder (no flap).
    expect(service.acquireLease('other', 20_000, true).holder).toBe('pc')
    // An all-hidden fleet keeps the last holder: an inactive request does not preempt.
    service.acquireLease('pc', 20_000, false)
    expect(service.acquireLease('other', 20_000, false).holder).toBe('pc')
  })

  it('preemption broadcasts the lease change (the old holder learns it lost the seat)', async () => {
    const { service } = makeService(new FakeUnit())
    await service.init()
    service.acquireLease('phone', 20_000, false)
    const seen: BoardEvent[] = []
    const off = service.subscribe(event => {
      if (event.type === 'lease') seen.push(event)
    })
    service.acquireLease('pc', 20_000, true)
    off()
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ type: 'lease', holder: 'pc' })
  })
})

describe('DocumentService command relay', () => {
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

  it('the lease and command frames name NO document — a seat belongs to the unit', async () => {
    // The type says it; nothing checked it. A `document` key on either frame
    // would read as true today (one holder drives both documents) and as a
    // lie the day a second engine or a document-scoped seat appears, so the
    // guarantee has to be measured on what actually goes out on the wire.
    const { service } = makeService(new FakeUnit())
    await service.init()
    const seen: BoardEvent[] = []
    service.subscribe(e => seen.push(e))
    service.acquireLease('a', 20_000)
    service.submitCommand({ type: 'run', taskId: 't-1', trigger: 'manual', clientId: 'x' })
    service.releaseLease('a')
    expect(seen.map(frame => frame.type)).toEqual(['lease', 'command', 'lease'])
    for (const frame of seen) {
      expect(JSON.parse(JSON.stringify(frame)) as Record<string, unknown>).not.toHaveProperty('document')
    }
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

describe('DocumentService dispose', () => {
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

describe('openBoardUnit layout migration', () => {
  /** Two mediums in one — the document tree and the pre-tree whole-unit file
   *  — with the backend's one-live-handle-per-unit-name rule ENFORCED, so an
   *  implementation that overlapped the two opens fails here instead of on the
   *  user's disk. */
  class FakeMedium {
    tree: Record<string, Record<string, unknown>> = {}
    legacyGlobal: unknown = undefined
    openCount = 0
    live = false
    writes: { table: string; key: string }[] = []
    readonly opener = async (descriptor: BoardUnitDescriptor): Promise<KvUnitLike> => {
      if (this.live) throw new Error(`unit '${descriptor.name}' is already open`)
      this.live = true
      this.openCount += 1
      const medium = this
      return {
        loadAll: async () => (descriptor.layout === 'single'
          ? { global: medium.legacyGlobal }
          : { tables: medium.tree }),
        putRecord: async (table, key, value) => {
          const records = medium.tree[table] ?? {}
          records[key] = JSON.parse(JSON.stringify(value))
          medium.tree[table] = records
          medium.writes.push({ table, key })
        },
        close: async () => { medium.live = false },
      }
    }
    /** A process restart: the previous boot's handle is gone, the medium is not. */
    restart(): void { this.live = false }
  }

  const noopRetire = async (options: RetireOptions): Promise<RetireOutcome> =>
    ({ status: 'retired', legacyPath: options.unitName, retiredPath: `${options.unitName}.migrated` })

  it('imports the pre-tree document, marks the tree, and retires the old file', async () => {
    const medium = new FakeMedium()
    medium.legacyGlobal = applyCommit(
      emptyBoardDoc(T0),
      commitOf({ tasks: [createTask({ title: 'A', description: '', prompt: '' }, T0, 't-a')] }),
      T0 + 1,
    )
    const retired: RetireOptions[] = []
    const opened = await openBoardUnit(medium.opener, T0, () => undefined, async (options) => {
      retired.push(options)
      return noopRetire(options)
    })
    expect((opened?.documents[BOARD_DOCUMENT] as BoardDoc).tasks.map(t => t.id)).toEqual(['t-a'])
    expect(medium.tree[BOARD_UNIT_TABLE]?.[META_DOCUMENT]).toMatchObject({
      schemaVersion: BOARD_UNIT_VERSION,
      legacyImported: true,
      legacyProbedAt: T0,
    })
    expect(retired).toHaveLength(1)
    // Three opens: the tree, the legacy whole-unit file, the tree again —
    // never two at once, because one unit name has one live handle.
    expect(medium.openCount).toBe(3)
  })

  it('never probes the legacy file again once the tree holds any record', async () => {
    const medium = new FakeMedium()
    medium.legacyGlobal = emptyBoardDoc(T0)
    await openBoardUnit(medium.opener, T0, () => undefined, noopRetire)
    expect(medium.openCount).toBe(3)
    // The old file is gone (it was retired), and the tree holding records means
    // this boot never looks for it: without that, every boot would re-read the
    // whole-unit file, and a user who DELETED the data root to reset would
    // watch the old board come straight back.
    medium.restart()
    medium.legacyGlobal = undefined
    const again = await openBoardUnit(medium.opener, T0 + 1, () => undefined, noopRetire)
    expect(medium.openCount).toBe(4)
    expect(again?.documents[BOARD_DOCUMENT]).toBeDefined()
  })

  it('marks a virgin tree as probed even when there is nothing to import', async () => {
    const medium = new FakeMedium()
    const opened = await openBoardUnit(medium.opener, T0, () => undefined, noopRetire)
    expect(opened?.documents[BOARD_DOCUMENT]).toBeUndefined()
    expect(medium.tree[BOARD_UNIT_TABLE]?.[META_DOCUMENT]).toMatchObject({ legacyImported: false })
    expect(medium.writes.map(w => w.key)).toEqual([META_DOCUMENT])
  })

  it('skips the whole probe when the tree already carries a board', async () => {
    const medium = new FakeMedium()
    medium.tree = { [BOARD_UNIT_TABLE]: { [BOARD_DOCUMENT]: emptyBoardDoc(T0) } }
    medium.legacyGlobal = emptyBoardDoc(T0)
    const opened = await openBoardUnit(medium.opener, T0, () => undefined, noopRetire)
    expect(medium.openCount).toBe(1)
    expect(opened?.documents[BOARD_DOCUMENT]).toBeDefined()
  })

  it('reports no unit when the deployment composes no storage hub', async () => {
    const opened = await openBoardUnit(async () => undefined, T0, () => undefined, noopRetire)
    expect(opened).toBeUndefined()
  })

  // THE TWO WAYS A DOCUMENT USED TO VANISH. Both are the same bug seen from
  // two directions: the question was asked about one document instead of about
  // the tree, so a checklist could be dropped while its own file sat on disk.
  // A marker is a record like any other — losing it changes nothing now.
  it('hands back EVERY record a marker-less tree holds (board + items, no meta)', async () => {
    const medium = new FakeMedium()
    const board = applyCommit(emptyBoardDoc(T0), commitOf({ tasks: [createTask({ title: 'A', description: '', prompt: '' }, T0, 't-a')] }), T0 + 1)
    const items = applyItemsCommit(emptyItemsDoc(T0), itemsCommitOf({ items: [row()] }), T0 + 1)
    medium.tree = { [BOARD_UNIT_TABLE]: { [BOARD_DOCUMENT]: board, [ITEMS_DOCUMENT]: items } }
    // A legacy file that really is still there must NOT be re-imported over the
    // newer tree — the tree is the truth the moment it holds anything.
    medium.legacyGlobal = emptyBoardDoc(T0)
    const opened = await openBoardUnit(medium.opener, T0, () => undefined, noopRetire)
    expect(medium.openCount).toBe(1)
    expect(opened?.documents[BOARD_DOCUMENT]).toBe(board)
    expect(opened?.documents[ITEMS_DOCUMENT]).toBe(items)
    expect(medium.writes).toEqual([])
  })

  it('hands back an items-only tree (no board, no meta) without probing the old file', async () => {
    const medium = new FakeMedium()
    const items = applyItemsCommit(emptyItemsDoc(T0), itemsCommitOf({ items: [row()] }), T0 + 1)
    medium.tree = { [BOARD_UNIT_TABLE]: { [ITEMS_DOCUMENT]: items } }
    medium.legacyGlobal = emptyBoardDoc(T0)
    const opened = await openBoardUnit(medium.opener, T0, () => undefined, noopRetire)
    expect(medium.openCount).toBe(1)
    expect(opened?.documents[ITEMS_DOCUMENT]).toBe(items)
    // No board document exists yet — that is the empty board, not a lost one.
    expect(opened?.documents[BOARD_DOCUMENT]).toBeUndefined()
  })
})

describe('DocumentService checklist (the second document)', () => {
  it('restores the checklist from the medium on init, beside the board', async () => {
    const unit = new FakeUnit()
    unit.items = applyItemsCommit(emptyItemsDoc(T0), itemsCommitOf({ items: [row({ id: 'i-a', ref: 1, title: 'A' }), row({ id: 'i-b', ref: 2, title: 'B' })] }), T0 + 1)
    unit.board = applyCommit(emptyBoardDoc(T0), commitOf({ tasks: [createTask({ title: 'A', description: '', prompt: '' }, T0, 't-a')] }), T0 + 1)
    const { service } = makeService(unit)
    await service.init()
    expect(service.getItemsDoc().items.map(i => i.id)).toEqual(['i-a', 'i-b'])
    expect(service.getItemsDoc().nextRef).toBe(3)
    expect(service.getDoc().tasks.map(t => t.id)).toEqual(['t-a'])
  })

  it('writes ONLY the items record, and never moves the board (revision, file or frame)', async () => {
    const unit = new FakeUnit()
    const { service } = makeService(unit)
    await service.init()
    await service.commit(commitOf({ tasks: [createTask({ title: 'A', description: '', prompt: '' }, T0, 't-a')] }))
    const boardAfterCommit = service.getDoc()
    const writesBefore = unit.writes.length
    const events: BoardEvent[] = []
    service.subscribe(e => events.push(e))

    const doc = await service.commitItems(itemsCommitOf({ items: [row({ id: 'i-a', ref: 1, title: 'A' })] }))
    expect(doc.revision).toBe(1)
    expect(doc.items.map(i => i.ref)).toEqual([1])
    // One record, and it is the checklist's: a checklist write must not rewrite
    // the board's file, must not bump the board's revision, and must not wake
    // every replica to resync a board that did not move.
    expect(unit.writes.slice(writesBefore)).toEqual([ITEMS_DOCUMENT])
    expect(service.getDoc()).toBe(boardAfterCommit)
    expect(service.getDoc().revision).toBe(1)
    expect(events).toEqual([])
  })

  it('a checklist no-op neither persists nor mints a number', async () => {
    const unit = new FakeUnit()
    const { service } = makeService(unit)
    await service.init()
    const first = await service.commitItems(itemsCommitOf({ items: [row({ id: 'i-a', ref: 1, title: 'A' })] }))
    const writesBefore = unit.writes.length
    const again = await service.commitItems(itemsCommitOf({ items: [row({ id: 'i-a', ref: 1, title: 'A' })] }))
    expect(again).toBe(first)
    expect(unit.writes).toHaveLength(writesBefore)
    expect(service.getItemsDoc().nextRef).toBe(2)
  })

  it('both documents share ONE write lane (a board commit cannot overtake an item commit)', async () => {
    const unit = new FakeUnit()
    const { service } = makeService(unit)
    await service.init()
    // The item write is the slower one: if the lanes were per document, the
    // board's record would land first and `writes` would show it.
    const slow = unit.putRecord.bind(unit)
    unit.putRecord = async (table, key, value) => {
      if (key === ITEMS_DOCUMENT) await new Promise(resolve => setTimeout(resolve, 5))
      return slow(table, key, value)
    }
    const [, itemsDoc] = await Promise.all([
      service.commit(commitOf({ tasks: [createTask({ title: 'A', description: '', prompt: '' }, T0, 't-a')] })),
      service.commitItems(itemsCommitOf({ items: [row({ id: 'i-a', ref: 1, title: 'A' })] })),
    ])
    expect(unit.writes).toEqual([BOARD_DOCUMENT, ITEMS_DOCUMENT])
    expect(itemsDoc.revision).toBe(1)
    expect(service.getDoc().revision).toBe(1)
  })

  it('keeps serving the checklist from memory when its persist throws', async () => {
    const unit = new FakeUnit()
    const { service } = makeService(unit)
    await service.init()
    unit.throwOnWrite = true
    const doc = await service.commitItems(itemsCommitOf({ items: [row({ id: 'i-a', ref: 1, title: 'A' })] }))
    expect(doc.items).toHaveLength(1)
    expect(service.getItemsDoc().items).toHaveLength(1)
  })

  it('a corrupt checklist record degrades to an empty document, never a failed boot', async () => {
    const unit = new FakeUnit()
    unit.items = { revision: 'nonsense', items: 42 }
    const { service } = makeService(unit)
    await service.init()
    expect(service.available).toBe(true)
    const doc: ItemsDoc = service.getItemsDoc()
    expect(doc.items).toEqual([])
    expect(doc.revision).toBe(0)
    expect(doc.nextRef).toBe(1)
  })
})
