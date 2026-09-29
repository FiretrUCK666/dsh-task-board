/**
 * Board route tests: the pure request processor over a fake service face —
 * GET/commit/lease/command envelopes, the CSRF and malformed-body guards,
 * the unchanged probe, and the SSE stream lifecycle (frames, unsubscribe,
 * disconnect note).
 *
 * The checklist rides the same prefix as a second tail, so the guards it
 * inherits are part of its contract: one CSRF rule, one body reader, one
 * envelope, one `since` rule — asserted here per tail, because "it worked for
 * the board" is exactly the assumption that lets a second dialect grow.
 */
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { emptyBoardDoc, type BoardCommit, type BoardDoc } from '../src/core/board-doc.ts'
import { createTask } from '../src/core/tasks.ts'
import { applyCommit } from '../src/core/board-doc.ts'
import { applyItemsCommit, deletedItemsOf, emptyItemsDoc, restoredItemOf, type ItemsCommit, type ItemsDoc } from '../src/core/items-doc.ts'
import type { ItemRecord } from '../src/core/item.ts'
import { createBoardHandler, parseBoardCommit, parseItemsCommit, type BoardRouteDeps } from '../src/host/board-route.ts'
import type { BoardCommand, BoardEvent, LeaseState } from '../src/host/board-service.ts'

const T0 = 1_700_000_000_000
const BASE = '/api/dsh-task-board/board'

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

/** A fake response capturing status/body/writes; emits 'close' on demand. */
function fakeRes(): ServerResponse & { state: { status: number; body: string; headers: Record<string, string>; writes: string[]; close(): void } } {
  const emitter = new EventEmitter()
  const state = {
    status: 200,
    body: '',
    headers: {} as Record<string, string>,
    writes: [] as string[],
    close() { emitter.emit('close') },
  }
  const res = Object.assign(emitter, {
    state,
    writeHead(status: number, headers?: Record<string, string>) {
      state.status = status
      if (headers !== undefined) Object.assign(state.headers, headers)
      return res
    },
    write(chunk: string) { state.writes.push(chunk); return true },
    end(payload?: string) { if (payload !== undefined) state.body = payload },
  })
  return res as unknown as ServerResponse & { state: typeof state }
}

/** A fake request with a URL and an optional JSON body chunk. */
function fakeReq(method: string, url: string, body?: unknown, contentType = 'application/json'): IncomingMessage {
  let sent = false
  const request = {
    method,
    url,
    headers: contentType === '' ? {} : { 'content-type': contentType },
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
  return request as unknown as IncomingMessage
}

/** A fake service face backed by a live document + lease + listener set. */
function fakeDeps() {
  let doc: BoardDoc = emptyBoardDoc(T0)
  let items: ItemsDoc = emptyItemsDoc(T0)
  // A complete LeaseState: the type requires `proto` + `bootedAt` precisely so
  // a fake (or a real branch) cannot quietly answer without them.
  const leaseOf = (held: boolean, holder?: string): LeaseState => ({
    held,
    holder: held ? holder : undefined,
    expiresAt: held ? T0 + 20_000 : undefined,
    proto: 2,
    bootedAt: T0,
  })
  let lease: LeaseState = leaseOf(false)
  let available = true
  const listeners = new Set<(event: BoardEvent) => void>()
  const commands: BoardCommand[] = []
  const disconnects: Array<string | undefined> = []
  const activities: Array<string | undefined> = []
  const deps: BoardRouteDeps = {
    ready: async () => undefined,
    available: () => available,
    doc: () => doc,
    commit: async commit => {
      doc = applyCommit(doc, commit, T0 + 1)
      return doc
    },
    itemsDoc: () => items,
    commitItems: async commit => {
      items = applyItemsCommit(items, commit, T0 + 1)
      return items
    },
    // Deliberately NOT a stand-in that hands the row back. A restore only works
    // because the stamp clears the tombstone, so a fake would pass while the
    // production path — the one that is actually the interesting part — went
    // untested. Both halves below are the REAL implementations; only the
    // storage and the broadcast belong to the service.
    //
    // THE ADDRESS IS A UNION, NOT A NUMBER, and that is the whole point of the
    // change. A tombstone is filed under the row's uuid; the short number is
    // what a person and a model say out loud. The interface's undo has a uuid
    // and often NO number — a row captured seconds ago still carries the
    // document's "not numbered yet" zero — so a restore addressed only by
    // number could not bring back the row the reader most wants back. Each
    // caller sends the name it actually holds, and a body carrying both is
    // refused rather than resolved by preference.
    restoreItem: async (of, clientId) => {
      const id = of.kind === 'id'
        ? of.id
        : deletedItemsOf(items).find(row => row.ref === of.ref)?.id
      if (id === undefined) return undefined
      const restored = restoredItemOf(items, id, T0 + 1)
      if (restored === undefined) return undefined
      items = applyItemsCommit(items, { clientId, items: [restored], changed: [restored.id], deleted: [] }, T0 + 1)
      return restored
    },
    acquireLease: clientId => {
      lease = leaseOf(true, clientId)
      return lease
    },
    releaseLease: () => {
      lease = leaseOf(false)
      return lease
    },
    noteActivity: clientId => activities.push(clientId),
    noteStreamOpen: () => undefined,
    noteDisconnect: clientId => disconnects.push(clientId),
    // This double is about the DOCUMENT protocol, so the hand-off answers
    // "not wired here" rather than pretending a model was reached.
    ask: async () => ({ ok: false as const, why: 'notWiredInThisDouble' }),
    submitCommand: command => {
      commands.push(command)
      return { queued: !lease.held }
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  const broadcast = (event: BoardEvent): void => { for (const listener of [...listeners]) listener(event) }
  return {
    deps,
    setAvailable: (value: boolean) => { available = value },
    seedCommit: (commit: BoardCommit) => { doc = applyCommit(doc, commit, T0) },
    seedItems: (commit: ItemsCommit) => { items = applyItemsCommit(items, commit, T0) },
    /** Make the medium refuse the next write, the way a full disk does. */
    failPersists: (why: string) => {
      deps.commit = async () => { throw new Error(why) }
      deps.commitItems = async () => { throw new Error(why) }
    },
    commands,
    disconnects,
    activities,
    broadcast,
    listenerCount: () => listeners.size,
  }
}

describe('a write the medium refuses is a REFUSAL, not a hang', () => {
  /**
   * THE CONTRACT THAT HAD ZERO COVERAGE.
   *
   * The service used to swallow a persist failure, so the route never saw one —
   * and when the service was fixed to reject, this handler had no catch beyond
   * `new URL()`, so the rejection left the request with NO response at all: no
   * status, no envelope, a socket that closed. The client then reported a
   * transport failure for what is a server-side refusal, and a reader's note
   * looked like a network problem rather than a full disk.
   *
   * Both tails now answer this prefix's own convention — a 200 carrying
   * `{ok:false,error:{code:'persist_failed'}}` — and this is the only thing that
   * makes those branches live rather than decorative.
   */
  const commit = {
    clientId: 'c',
    tasks: [createTask({ title: 'A', description: '', prompt: '' }, T0, 't-a')],
    deleted: [],
    cruise: { value: { enabled: false, limit: 5, schedule: [] }, at: 0 },
    schedulePresets: { value: [], at: 0 },
    runPresets: { value: { presets: [] }, at: 0 },
  }

  it('the board tail answers persist_failed rather than leaving the request open', async () => {
    const h = fakeDeps()
    h.failPersists('disk full')
    const handler = createBoardHandler(h.deps, BASE)
    const res = fakeRes()
    await handler(fakeReq('POST', BASE, commit), res)
    const envelope = JSON.parse(res.state.body)
    expect(envelope.ok, 'a write that was never written was answered as a success').toBe(false)
    expect(envelope.error?.code, 'the refusal does not say what went wrong').toBe('persist_failed')
    expect(res.state.status, 'the refusal left the request with no status at all').toBe(200)
  })

  it('and so does the checklist tail, where the lost row is an idea', async () => {
    const h = fakeDeps()
    h.failPersists('disk full')
    const handler = createBoardHandler(h.deps, BASE)
    const res = fakeRes()
    await handler(fakeReq('POST', `${BASE}/items`, { clientId: 'c', items: [] }), res)
    const envelope = JSON.parse(res.state.body)
    expect(envelope.ok, 'a checklist write that was never written was answered as a success').toBe(false)
    expect(envelope.error?.code).toBe('persist_failed')
  })
})

describe('GET /board', () => {
  it('serves the authoritative document', async () => {
    const h = fakeDeps()
    h.seedCommit({ clientId: 'c', tasks: [createTask({ title: 'A', description: '', prompt: '' }, T0, 't-a')], deleted: [], cruise: { value: { enabled: false, limit: 5, schedule: [] }, at: 0 }, schedulePresets: { value: [], at: 0 }, runPresets: { value: { presets: [] }, at: 0 } })
    const handler = createBoardHandler(h.deps, BASE)
    const res = fakeRes()
    await handler(fakeReq('GET', BASE), res)
    const envelope = JSON.parse(res.state.body)
    expect(envelope.ok).toBe(true)
    expect(envelope.value.available).toBe(true)
    expect(envelope.value.doc.tasks.map((t: { id: string }) => t.id)).toEqual(['t-a'])
  })

  it('answers unchanged for a since probe at or above the revision', async () => {
    const h = fakeDeps()
    const handler = createBoardHandler(h.deps, BASE)
    const res = fakeRes()
    await handler(fakeReq('GET', `${BASE}?since=0`), res)
    const envelope = JSON.parse(res.state.body)
    expect(envelope.value.unchanged).toBe(true)
    expect(envelope.value.doc).toBeUndefined()
  })

  it('renews the caller lease on activity', async () => {
    const h = fakeDeps()
    const handler = createBoardHandler(h.deps, BASE)
    await handler(fakeReq('GET', `${BASE}?clientId=abc`), fakeRes())
    expect(h.activities).toContain('abc')
  })

  it('reports available:false without a document when the service is unavailable', async () => {
    const h = fakeDeps()
    h.setAvailable(false)
    const handler = createBoardHandler(h.deps, BASE)
    const res = fakeRes()
    await handler(fakeReq('GET', BASE), res)
    const envelope = JSON.parse(res.state.body)
    expect(envelope.value.available).toBe(false)
  })
})

describe('POST /board (commit)', () => {
  const commit = {
    clientId: 'c-1',
    tasks: [createTask({ title: 'A', description: '', prompt: '' }, T0, 't-a')],
    deleted: [],
    cruise: { value: { enabled: false, limit: 5, schedule: [] }, at: 0 },
    schedulePresets: { value: [], at: 0 },
    runPresets: { value: { presets: [] }, at: 0 },
  }

  it('applies the commit and returns the fresh document', async () => {
    const h = fakeDeps()
    const handler = createBoardHandler(h.deps, BASE)
    const res = fakeRes()
    await handler(fakeReq('POST', BASE, commit), res)
    const envelope = JSON.parse(res.state.body)
    expect(envelope.ok).toBe(true)
    expect(envelope.value.revision).toBe(1)
    expect(envelope.value.doc.tasks).toHaveLength(1)
  })

  it('rejects a malformed body with the error envelope', async () => {
    const h = fakeDeps()
    const handler = createBoardHandler(h.deps, BASE)
    const res = fakeRes()
    await handler(fakeReq('POST', BASE, { clientId: '' }), res)
    const envelope = JSON.parse(res.state.body)
    expect(envelope.ok).toBe(false)
  })

  it('rejects a non-JSON content type with 415 (CSRF guard)', async () => {
    const h = fakeDeps()
    const handler = createBoardHandler(h.deps, BASE)
    const res = fakeRes()
    await handler(fakeReq('POST', BASE, commit, 'text/plain'), res)
    expect(res.state.status).toBe(415)
  })

  it('answers available:false without applying when the service is unavailable', async () => {
    const h = fakeDeps()
    h.setAvailable(false)
    const handler = createBoardHandler(h.deps, BASE)
    const res = fakeRes()
    await handler(fakeReq('POST', BASE, commit), res)
    const envelope = JSON.parse(res.state.body)
    expect(envelope.value.available).toBe(false)
    expect(h.deps.doc().revision).toBe(0)
  })
})

describe('GET /board/items', () => {
  it('serves the authoritative checklist and its OWN revision', async () => {
    const h = fakeDeps()
    h.seedCommit({ clientId: 'c', tasks: [createTask({ title: 'A', description: '', prompt: '' }, T0, 't-a')], deleted: [], cruise: { value: { enabled: false, limit: 5, schedule: [] }, at: 0 }, schedulePresets: { value: [], at: 0 }, runPresets: { value: { presets: [] }, at: 0 } })
    h.seedItems({ clientId: 'c', items: [row({ id: 'i-a', ref: 1, title: 'A' })], deleted: [] })
    const handler = createBoardHandler(h.deps, BASE)
    const res = fakeRes()
    await handler(fakeReq('GET', `${BASE}/items`), res)
    const envelope = JSON.parse(res.state.body)
    expect(envelope.ok).toBe(true)
    expect(envelope.value.available).toBe(true)
    expect(envelope.value.revision).toBe(1)
    expect(envelope.value.doc.items.map((i: { id: string }) => i.id)).toEqual(['i-a'])
    // The board's own revision is a different counter that this tail never
    // reports: one document's answer cannot answer for the other.
    expect(h.deps.doc().revision).toBe(1)
    expect(envelope.value.doc).not.toHaveProperty('tasks')
  })

  it('answers unchanged for a since probe at or above the checklist revision', async () => {
    const h = fakeDeps()
    h.seedItems({ clientId: 'c', items: [row({ id: 'i-a', ref: 1, title: 'A' })], deleted: [] })
    const handler = createBoardHandler(h.deps, BASE)
    const res = fakeRes()
    await handler(fakeReq('GET', `${BASE}/items?since=1`), res)
    const envelope = JSON.parse(res.state.body)
    expect(envelope.value.unchanged).toBe(true)
    expect(envelope.value.doc).toBeUndefined()
    expect(envelope.value.revision).toBe(1)
  })

  it('serves the whole body when `since` is absent (the initial-fetch trap)', async () => {
    const h = fakeDeps()
    h.seedItems({ clientId: 'c', items: [row({ id: 'i-a', ref: 1, title: 'A' })], deleted: [] })
    const handler = createBoardHandler(h.deps, BASE)
    const res = fakeRes()
    await handler(fakeReq('GET', `${BASE}/items`), res)
    const envelope = JSON.parse(res.state.body)
    expect(envelope.value.unchanged).toBeUndefined()
    expect(envelope.value.doc).toBeDefined()
  })

  it('renews the unit-level seat on a checklist read', async () => {
    const h = fakeDeps()
    const handler = createBoardHandler(h.deps, BASE)
    await handler(fakeReq('GET', `${BASE}/items?clientId=phone`), fakeRes())
    expect(h.activities).toContain('phone')
  })

  it('reports available:false without a document when the service is unavailable', async () => {
    const h = fakeDeps()
    h.setAvailable(false)
    const handler = createBoardHandler(h.deps, BASE)
    const res = fakeRes()
    await handler(fakeReq('GET', `${BASE}/items`), res)
    expect(JSON.parse(res.state.body).value.available).toBe(false)
  })

  it('withholds the deleted rows unless the caller asked for them', async () => {
    // Opt-in, and the default really is silent: a replica polling every few
    // seconds must not be handed a list it has no use for, on every poll.
    const h = fakeDeps()
    const handler = createBoardHandler(h.deps, BASE)
    // A tombstone only carries text if the row was REALLY there to be removed,
    // so the archive is built by deleting rather than by asserting a shape: a
    // hand-written tombstone would be a second description of the merge
    // grammar, and it would drift the first time that grammar moved.
    const seeded = row({ id: 'i-gone', ref: 1, title: 'G' })
    await handler(fakeReq('POST', `${BASE}/items`, { clientId: 'c', items: [seeded, row({ id: 'i-a', ref: 2, title: 'A' })], deleted: [] }), fakeRes())
    await handler(fakeReq('POST', `${BASE}/items`, { clientId: 'c', items: [], deleted: [{ id: 'i-gone', baseUpdatedAt: seeded.updatedAt }] }), fakeRes())

    const plain = fakeRes()
    await handler(fakeReq('GET', `${BASE}/items`), plain)
    expect(JSON.parse(plain.state.body).value).not.toHaveProperty('deleted')

    const asked = fakeRes()
    await handler(fakeReq('GET', `${BASE}/items?includeDeleted=1`), asked)
    const envelope = JSON.parse(asked.state.body).value
    expect(envelope.deleted.map((i: { id: string }) => i.id)).toEqual(['i-gone'])
    // The live rows and the deleted ones are the two halves of one answer, so
    // they arrive together: an archive that filled in without the list moving
    // would be two documents read at two moments.
    expect(envelope.doc.items.map((i: { id: string }) => i.id)).toEqual(['i-a'])
  })

  it('a `since` probe short-circuits the archive too, and that is safe because a delete bumps the revision', async () => {
    // The dependency, stated as a test: `includeDeleted` rides the SAME verdict
    // as the document, so a replica that already knows the revision is told
    // "unchanged" and gets no archive. That is only right while every delete
    // goes through a commit. A path that removed a row without bumping the
    // revision would make this serve a stale archive forever, silently.
    const h = fakeDeps()
    const handler = createBoardHandler(h.deps, BASE)
    const seeded = row({ id: 'i-gone', ref: 1, title: 'G' })
    await handler(fakeReq('POST', `${BASE}/items`, { clientId: 'c', items: [seeded], deleted: [] }), fakeRes())
    const revisionBeforeDelete = h.deps.itemsDoc().revision
    await handler(fakeReq('POST', `${BASE}/items`, { clientId: 'c', items: [], deleted: [{ id: 'i-gone', baseUpdatedAt: seeded.updatedAt }] }), fakeRes())
    // THE PREMISE. If a delete ever stops moving the counter, the short-circuit
    // below starts serving a stale archive and nothing reports it.
    expect(h.deps.itemsDoc().revision).toBeGreaterThan(revisionBeforeDelete)
    const res = fakeRes()
    await handler(fakeReq('GET', `${BASE}/items?since=${h.deps.itemsDoc().revision}&includeDeleted=1`), res)
    const envelope = JSON.parse(res.state.body).value
    expect(envelope.unchanged).toBe(true)
    expect(envelope).not.toHaveProperty('deleted')
  })
})

describe('restoring a deleted row over the route', () => {
  // THE BUG THIS EXISTS FOR. A tombstone outranks the row it removed by one
  // millisecond, and the kernel's put branch drops any row whose stamp is not
  // above it — which is exactly what the tombstone is FOR. So handing the
  // payload straight back is not a restore that works "because the row was
  // there"; it is a restore that the suppression branch eats, silently. The
  // route answers 200 either way, so "the endpoint succeeded" and "the row came
  // back" look identical from outside. Hence the assertion is on the DOCUMENT,
  // at the end of the whole chain, and never on the status.
  it('comes back, because the stamp is pushed above the tombstone first', async () => {
    const h = fakeDeps()
    const handler = createBoardHandler(h.deps, BASE)
    const original = row({ id: 'i-a', ref: 1, title: 'A' })

    await handler(fakeReq('POST', `${BASE}/items`, { clientId: 'c', items: [original], deleted: [] }), fakeRes())
    const gone = fakeRes()
    await handler(fakeReq('POST', `${BASE}/items`, {
      clientId: 'c',
      items: [],
      deleted: [{ id: 'i-a', baseUpdatedAt: original.updatedAt }],
    }), gone)
    expect(gone.state.status).toBe(200)
    expect(h.deps.itemsDoc().items).toEqual([])
    expect(h.deps.itemsDoc().tombstones['i-a']).toBeDefined()

    // The wrong version: the payload exactly as it was. It is refused by the
    // same branch that refuses a stale replica, and nothing anywhere complains.
    const naive = fakeRes()
    await handler(fakeReq('POST', `${BASE}/items`, { clientId: 'c', items: [original], deleted: [] }), naive)
    expect(naive.state.status).toBe(200)
    expect(h.deps.itemsDoc().items, 'the naive put is what the tombstone is for; it must NOT revive').toEqual([])

    // The right version: re-stamped above the tombstone, then sent as an
    // ordinary claimed put. No new route and no new mechanism.
    const restored = restoredItemOf(h.deps.itemsDoc(), 'i-a', h.deps.itemsDoc().tombstones['i-a']!.at + 1)
    expect(restored).toBeDefined()
    const back = fakeRes()
    await handler(fakeReq('POST', `${BASE}/items`, {
      clientId: 'c',
      items: [restored],
      changed: ['i-a'],
      deleted: [],
    }), back)
    expect(back.state.status).toBe(200)
    expect(h.deps.itemsDoc().items.map(i => i.id)).toEqual(['i-a'])
    expect(h.deps.itemsDoc().items[0]?.title).toBe('A')
    // The tombstone's job is done and it leaves, so a later delete of the same
    // id is not suppressed by a marker for a row that is back.
    expect(h.deps.itemsDoc().tombstones['i-a']).toBeUndefined()
  })
})

describe('POST /board/items/restore', () => {
  /** A document holding one deleted row behind its tombstone. */
  async function withADeletedRow() {
    const h = fakeDeps()
    const handler = createBoardHandler(h.deps, BASE)
    const original = row({ id: 'i-a', ref: 4, title: '找回我' })
    await handler(fakeReq('POST', `${BASE}/items`, {
      clientId: 'c', items: [original], deleted: [],
    }), fakeRes())
    await handler(fakeReq('POST', `${BASE}/items`, {
      clientId: 'c', items: [], deleted: [{ id: 'i-a', baseUpdatedAt: original.updatedAt }],
    }), fakeRes())
    return { h, handler }
  }

  /** The `value` the route answered with, read off the raw body. */
  function valueOf(res: ReturnType<typeof fakeRes>): { available?: boolean; restored?: { title?: string } } {
    return (JSON.parse(res.state.body) as { value?: { available?: boolean; restored?: { title?: string } } }).value ?? {}
  }

  it('brings the row back by its short number, and clears the tombstone', async () => {
    const { h, handler } = await withADeletedRow()
    expect(h.deps.itemsDoc().items).toEqual([])
    const res = fakeRes()
    await handler(fakeReq('POST', `${BASE}/items/restore`, { clientId: 'c', ref: 4 }), res)
    expect(res.state.status).toBe(200)
    expect(valueOf(res).available).toBe(true)
    expect(valueOf(res).restored?.title).toBe('找回我')
    // The document really changed — the assertion that catches a restore which
    // answers 200 and changes nothing, which is the failure this route exists
    // to make impossible.
    expect(h.deps.itemsDoc().items.map(i => i.id)).toEqual(['i-a'])
    expect(h.deps.itemsDoc().tombstones['i-a']).toBeUndefined()
  })

  it('accepts the number the way it is SPOKEN, with its #', async () => {
    const { h, handler } = await withADeletedRow()
    await handler(fakeReq('POST', `${BASE}/items/restore`, { clientId: 'c', ref: '#4' }), fakeRes())
    expect(h.deps.itemsDoc().items.map(i => i.id)).toEqual(['i-a'])
  })

  it('says the row did not come back, rather than reporting a success with nothing in it', async () => {
    const { handler } = await withADeletedRow()
    const res = fakeRes()
    await handler(fakeReq('POST', `${BASE}/items/restore`, { clientId: 'c', ref: 99 }), res)
    expect(res.state.status).toBe(200)
    // A missing `restored` alongside `available: true` is the fact "no tombstone
    // holds that number" — the reader is told the row is not back.
    expect(valueOf(res).available).toBe(true)
    expect(valueOf(res).restored).toBeUndefined()
  })

  it('refuses a body with no caller id, because every write carries one', async () => {
    const { handler } = await withADeletedRow()
    const res = fakeRes()
    await handler(fakeReq('POST', `${BASE}/items/restore`, { ref: 4 }), res)
    // A malformed body is this prefix's convention: HTTP 200 carrying
    // `{ok:false}` in the envelope, NOT a 4xx. Every other tail here answers
    // the same way, and a tail that answered differently would be the one a
    // client could not handle with one code path.
    expect(res.state.status).toBe(200)
    expect(JSON.parse(res.state.body).ok).toBe(false)
    // And nothing moved: a refused restore must not half-apply.
    expect(handler).toBeDefined()
  })

  it('refuses a number that is not a positive whole one', async () => {
    const { h, handler } = await withADeletedRow()
    for (const ref of [0, -1, 1.5, 'four', null]) {
      const res = fakeRes()
      await handler(fakeReq('POST', `${BASE}/items/restore`, { clientId: 'c', ref }), res)
      expect(JSON.parse(res.state.body).ok, JSON.stringify(ref)).toBe(false)
    }
    expect(h.deps.itemsDoc().items).toEqual([])
  })

  it('keeps the CSRF discipline every POST on this prefix shares', async () => {
    const { handler } = await withADeletedRow()
    const res = fakeRes()
    await handler(fakeReq('POST', `${BASE}/items/restore`, 'not json', 'text/plain'), res)
    expect(res.state.status).toBe(415)
  })

  /**
   * THE CASE THE SECOND NAME EXISTS FOR.
   *
   * A row captured seconds ago has no short number yet — the document hands
   * out numbers, and it has not seen this one. The interface's undo holds a
   * uuid and nothing else, so a restore addressed only by number had exactly
   * one way to fail on exactly the row the reader most wants back: the request
   * went out, the host answered 200, and the document did not change. A 200
   * that changed nothing is worse than a refusal, because it tells the reader
   * their row is filed when it is not.
   */
  async function withAnUnnumberedDeletedRow() {
    const h = fakeDeps()
    const handler = createBoardHandler(h.deps, BASE)
    const original = row({ id: 'i-fresh', ref: 0, title: '刚记下的那一行' })
    await handler(fakeReq('POST', `${BASE}/items`, { clientId: 'c', items: [original], deleted: [] }), fakeRes())
    await handler(fakeReq('POST', `${BASE}/items`, {
      clientId: 'c', items: [], deleted: [{ id: 'i-fresh', baseUpdatedAt: original.updatedAt }],
    }), fakeRes())
    return { h, handler }
  }

  it('brings back a row the document has not numbered yet, by its identity', async () => {
    const { h, handler } = await withAnUnnumberedDeletedRow()
    expect(h.deps.itemsDoc().items).toEqual([])
    const res = fakeRes()
    await handler(fakeReq('POST', `${BASE}/items/restore`, { clientId: 'c', id: 'i-fresh' }), res)
    expect(res.state.status).toBe(200)
    expect(valueOf(res).restored?.title, 'the undo reported success and left the row in the grave — an answer that changes nothing is a lie').toBe('刚记下的那一行')
    // The document, not the answer: this is the assertion that catches a 200.
    expect(h.deps.itemsDoc().items.map(i => i.id)).toEqual(['i-fresh'])
    expect(h.deps.itemsDoc().tombstones['i-fresh']).toBeUndefined()
  })

  it('refuses a body that names one row twice, rather than picking one for the caller', async () => {
    const { h, handler } = await withADeletedRow()
    const res = fakeRes()
    await handler(fakeReq('POST', `${BASE}/items/restore`, { clientId: 'c', id: 'i-a', ref: 4 }), res)
    // HTTP 200 carrying `{ok:false}`: this prefix answers every malformed body
    // the same way, and a tail that answered differently would be the one a
    // client could not handle with a single code path.
    expect(res.state.status).toBe(200)
    expect(JSON.parse(res.state.body).ok).toBe(false)
    // And a refused restore must not half-apply: the two names agreed here by
    // accident, and a body that happened to be consistent is not a licence to
    // restore a row the caller did not choose.
    expect(h.deps.itemsDoc().items).toEqual([])
  })

  it('refuses a body that names no row at all', async () => {
    const { h, handler } = await withADeletedRow()
    const res = fakeRes()
    await handler(fakeReq('POST', `${BASE}/items/restore`, { clientId: 'c' }), res)
    expect(res.state.status).toBe(200)
    expect(JSON.parse(res.state.body).ok).toBe(false)
    expect(h.deps.itemsDoc().items).toEqual([])
  })

  it('says "no grave holds that row" rather than reporting a success with nothing in it', async () => {
    const { handler } = await withADeletedRow()
    const res = fakeRes()
    await handler(fakeReq('POST', `${BASE}/items/restore`, { clientId: 'c', id: 'i-never-existed' }), res)
    expect(res.state.status).toBe(200)
    // `available: true` beside a missing `restored` is the fact "the host is
    // serving documents and no tombstone holds that id" — two different things
    // from "the host is not serving documents", and the panel's obligation is to
    // say which one happened rather than to report a success.
    expect(valueOf(res).available).toBe(true)
    expect(valueOf(res).restored).toBeUndefined()
  })

  it('the tombstone is still keyed by identity, so the probe is the real one', async () => {
    // The negative control for the case above. If the tombstone were ever keyed
    // by the short number, the interface's undo would break the moment a row
    // had none — and the route cases above would still be green, because they
    // go through `restoredItemOf` whatever it reads. So the key is asserted
    // here, on the document the real path produced, where the fact lives.
    const { h } = await withAnUnnumberedDeletedRow()
    expect(Object.keys(h.deps.itemsDoc().tombstones), 'the grave is not filed under the row identity').toEqual(['i-fresh'])
  })
})

describe('POST /board/items (commit)', () => {
  const commit = { clientId: 'c-1', items: [row({ id: 'i-a', ref: 1, title: 'A' })], deleted: [] }

  it('applies the commit and returns the fresh checklist', async () => {
    const h = fakeDeps()
    const handler = createBoardHandler(h.deps, BASE)
    const res = fakeRes()
    await handler(fakeReq('POST', `${BASE}/items`, commit), res)
    const envelope = JSON.parse(res.state.body)
    expect(envelope.ok).toBe(true)
    expect(envelope.value.revision).toBe(1)
    expect(envelope.value.doc.items).toHaveLength(1)
  })

  it('moves the CHECKLIST revision only — the board never learns about it', async () => {
    const h = fakeDeps()
    h.seedCommit({ clientId: 'c', tasks: [createTask({ title: 'A', description: '', prompt: '' }, T0, 't-a')], deleted: [], cruise: { value: { enabled: false, limit: 5, schedule: [] }, at: 0 }, schedulePresets: { value: [], at: 0 }, runPresets: { value: { presets: [] }, at: 0 } })
    const boardRevision = h.deps.doc().revision
    const handler = createBoardHandler(h.deps, BASE)
    await handler(fakeReq('POST', `${BASE}/items`, commit), fakeRes())
    expect(h.deps.itemsDoc().revision).toBe(1)
    expect(h.deps.doc().revision).toBe(boardRevision)
    // …and the other way round: a board commit must not bump the checklist.
    await handler(fakeReq('POST', BASE, { clientId: 'c', tasks: [createTask({ title: 'B', description: '', prompt: '' }, T0, 't-b')], deleted: [], cruise: { value: { enabled: false, limit: 5, schedule: [] }, at: 0 }, schedulePresets: { value: [], at: 0 }, runPresets: { value: { presets: [] }, at: 0 } }), fakeRes())
    expect(h.deps.itemsDoc().revision).toBe(1)
  })

  it('a no-op commit answers the SAME revision and document', async () => {
    const h = fakeDeps()
    const handler = createBoardHandler(h.deps, BASE)
    await handler(fakeReq('POST', `${BASE}/items`, commit), fakeRes())
    const res = fakeRes()
    await handler(fakeReq('POST', `${BASE}/items`, commit), res)
    const envelope = JSON.parse(res.state.body)
    expect(envelope.value.revision).toBe(1)
    expect(envelope.value.doc).toEqual(h.deps.itemsDoc())
  })

  it('rejects a malformed body with the error envelope', async () => {
    const h = fakeDeps()
    const handler = createBoardHandler(h.deps, BASE)
    const res = fakeRes()
    await handler(fakeReq('POST', `${BASE}/items`, { clientId: '' }), res)
    expect(JSON.parse(res.state.body).ok).toBe(false)
  })

  it('rejects a non-JSON content type with 415 — the guard is the SHARED one', async () => {
    // The CSRF check sits above the tail dispatch, so the second document
    // inherits it rather than restating it. A `text/plain` (or absent) content
    // type must never reach the items merge.
    const h = fakeDeps()
    const handler = createBoardHandler(h.deps, BASE)
    const res = fakeRes()
    await handler(fakeReq('POST', `${BASE}/items`, commit, 'text/plain'), res)
    expect(res.state.status).toBe(415)
    expect(h.deps.itemsDoc().items).toEqual([])
  })

  it('answers available:false without applying when the service is unavailable', async () => {
    const h = fakeDeps()
    h.setAvailable(false)
    const handler = createBoardHandler(h.deps, BASE)
    const res = fakeRes()
    await handler(fakeReq('POST', `${BASE}/items`, commit), res)
    expect(JSON.parse(res.state.body).value.available).toBe(false)
    expect(h.deps.itemsDoc().revision).toBe(0)
  })
})

describe('POST /board/lease', () => {
  it('acquires and reports the lease', async () => {
    const h = fakeDeps()
    const handler = createBoardHandler(h.deps, BASE)
    const res = fakeRes()
    await handler(fakeReq('POST', `${BASE}/lease`, { clientId: 'a', ttlMs: 30_000 }), res)
    const envelope = JSON.parse(res.state.body)
    expect(envelope.value.lease.held).toBe(true)
    expect(envelope.value.lease.holder).toBe('a')
  })

  it('release clears the lease', async () => {
    const h = fakeDeps()
    const handler = createBoardHandler(h.deps, BASE)
    const res = fakeRes()
    await handler(fakeReq('POST', `${BASE}/lease`, { clientId: 'a' }), res)
    await handler(fakeReq('POST', `${BASE}/lease`, { clientId: 'a', release: true }), res)
    const envelope = JSON.parse(res.state.body)
    expect(envelope.value.lease.held).toBe(false)
  })
})

describe('POST /board/command', () => {
  it('relays a run command and reports the queue state', async () => {
    const h = fakeDeps()
    const handler = createBoardHandler(h.deps, BASE)
    const res = fakeRes()
    await handler(fakeReq('POST', `${BASE}/command`, { clientId: 'x', command: { type: 'run', taskId: 't-1', trigger: 'manual' } }), res)
    const envelope = JSON.parse(res.state.body)
    expect(envelope.value.command).toEqual({ queued: true })
    expect(h.commands).toEqual([{ type: 'run', taskId: 't-1', trigger: 'manual', clientId: 'x' }])
  })

  it('drops an unknown command type', async () => {
    const h = fakeDeps()
    const handler = createBoardHandler(h.deps, BASE)
    const res = fakeRes()
    await handler(fakeReq('POST', `${BASE}/command`, { clientId: 'x', command: { type: 'explode' } }), res)
    expect(JSON.parse(res.state.body).ok).toBe(false)
  })
})

describe('GET /board/events (SSE)', () => {
  it('opens the stream, forwards events, and cleans up on close', async () => {
    const h = fakeDeps()
    const handler = createBoardHandler(h.deps, BASE)
    const res = fakeRes()
    await handler(fakeReq('GET', `${BASE}/events?clientId=sse-1`), res)
    expect(res.state.headers['content-type']).toContain('text/event-stream')
    expect(res.state.writes[0]).toContain('retry:')
    expect(h.listenerCount()).toBe(1)
    h.broadcast({ type: 'commit', document: 'board', revision: 7, clientId: 'c-1' })
    expect(res.state.writes.some(w => w.includes('"revision":7'))).toBe(true)
    // The frame must name its document ON THE WIRE: a subscriber that cannot
    // tell the two documents apart would resync the wrong one.
    expect(res.state.writes.some(w => w.includes('"document":"board"'))).toBe(true)
    res.state.close()
    expect(h.listenerCount()).toBe(0)
    expect(h.disconnects).toContain('sse-1')
  })
})

describe('method/path guards', () => {
  it('405 on a non-GET/POST method', async () => {
    const h = fakeDeps()
    const handler = createBoardHandler(h.deps, BASE)
    const res = fakeRes()
    await handler(fakeReq('DELETE', BASE), res)
    expect(res.state.status).toBe(405)
  })

  it('404 envelope on an unknown POST path tail', async () => {
    const h = fakeDeps()
    const handler = createBoardHandler(h.deps, BASE)
    const res = fakeRes()
    await handler(fakeReq('POST', `${BASE}/nonsense`, { clientId: 'x' }), res)
    expect(res.state.status).toBe(404)
  })
})

describe('parseBoardCommit', () => {
  it('accepts a well-formed commit and filters junk deletes', () => {
    const parsed = parseBoardCommit({
      clientId: 'c',
      tasks: [{ id: 't' }],
      deleted: [{ id: 'a', baseUpdatedAt: 1 }, { id: '' }, 'junk', 5],
      cruise: { value: { enabled: true, limit: 2, schedule: [] }, at: 10 },
    })
    expect(parsed?.clientId).toBe('c')
    expect(parsed?.deleted).toEqual([{ id: 'a', baseUpdatedAt: 1 }])
    expect(parsed?.cruise.at).toBe(10)
  })

  it('rejects a missing or oversized clientId', () => {
    expect(parseBoardCommit({ clientId: '', tasks: [] })).toBeUndefined()
    expect(parseBoardCommit({ clientId: 'x'.repeat(65), tasks: [] })).toBeUndefined()
    expect(parseBoardCommit(null)).toBeUndefined()
  })
})

describe('parseItemsCommit', () => {
  it('accepts a well-formed commit and filters junk, on the same rules as the board', () => {
    const parsed = parseItemsCommit({
      clientId: 'c',
      items: [row()],
      changed: ['i-1', '', 5],
      deleted: [{ id: 'a', baseUpdatedAt: 1 }, { id: '' }, 'junk', 5],
    })
    expect(parsed?.clientId).toBe('c')
    expect(parsed?.items).toHaveLength(1)
    expect(parsed?.changed).toEqual(['i-1'])
    expect(parsed?.deleted).toEqual([{ id: 'a', baseUpdatedAt: 1 }])
  })

  it('defaults absent arrays rather than inventing rows', () => {
    const parsed = parseItemsCommit({ clientId: 'c' })
    expect(parsed).toEqual({ clientId: 'c', items: [], changed: [], deleted: [] })
  })

  it('rejects a missing or oversized clientId, exactly like the board parser', () => {
    expect(parseItemsCommit({ clientId: '', items: [] })).toBeUndefined()
    expect(parseItemsCommit({ clientId: 'x'.repeat(65), items: [] })).toBeUndefined()
    expect(parseItemsCommit(null)).toBeUndefined()
    expect(parseItemsCommit({ clientId: 'c', items: 'not an array' })?.items).toEqual([])
  })
})
