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
import { applyItemsCommit, emptyItemsDoc, type ItemsCommit, type ItemsDoc } from '../src/core/items-doc.ts'
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
    commands,
    disconnects,
    activities,
    broadcast,
    listenerCount: () => listeners.size,
  }
}

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
    h.broadcast({ type: 'commit', revision: 7, clientId: 'c-1' })
    expect(res.state.writes.some(w => w.includes('"revision":7'))).toBe(true)
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
