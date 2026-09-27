/**
 * Board HTTP integration smoke: a REAL http.Server + real fetch + a live SSE
 * socket, over the REAL platform json storage backend (`JsonStorageBackend`
 * on a temp dir). The unit specs stub req/res and the KV unit; this one
 * proves the assumptions those stubs hide: HTTP prefix routing, chunked JSON
 * bodies, the SSE frame format on a live stream, the lease/command relay over
 * the wire, and the KvUnit file format + version stamp + restart restore on
 * disk. It is the runtime contract the multi-device sync rests on.
 *
 * The SECOND document (the checklist) is pinned here rather than only against
 * the fake unit, because what the fakes hide is exactly the thing worth
 * proving: one unit, one directory, one file per document, and each document
 * restoring on its own after a restart.
 */
import { createServer, type Server } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import {
  DocumentService,
  BOARD_UNIT_DESCRIPTOR,
  BOARD_UNIT_NAME,
  BOARD_UNIT_VERSION,
  BOARD_UNIT_TABLE,
  BOARD_DOCUMENT,
  ITEMS_DOCUMENT,
  openBoardUnit,
} from '../src/host/board-service.ts'
import { createBoardHandler, type BoardRouteDeps } from '../src/host/board-route.ts'
import { applyCommit, emptyBoardDoc, type BoardCommit, type BoardEvent } from '../src/core/board-doc.ts'
import { applyItemsCommit, emptyItemsDoc, type ItemsCommit, type ItemsDoc } from '../src/core/items-doc.ts'
import type { ItemRecord } from '../src/core/item.ts'
import { createTask } from '../src/core/tasks.ts'

const BASE = '/api/dsh-task-board/board'
const T0 = 1_700_000_000_000

let root: string
let backend: JsonStorageBackend
let service: DocumentService
let server: Server
let origin: string

function openUnit(backend: JsonStorageBackend) {
  return backend.kv.open(BOARD_UNIT_DESCRIPTOR)
}

function makeService(backend: JsonStorageBackend): DocumentService {
  const service = new DocumentService({
    openUnit: async () => openUnit(backend),
    log: () => undefined,
  })
  return service
}

function depsFor(service: DocumentService): BoardRouteDeps {
  return {
    ready: () => service.ensureInit(),
    available: () => service.available,
    doc: () => service.getDoc(),
    commit: commit => service.commit(commit),
    itemsDoc: () => service.getItemsDoc(),
    commitItems: commit => service.commitItems(commit),
    acquireLease: (clientId, ttlMs) => service.acquireLease(clientId, ttlMs),
    releaseLease: clientId => service.releaseLease(clientId),
    noteActivity: clientId => service.noteActivity(clientId),
    noteStreamOpen: clientId => service.noteStreamOpen(clientId),
    noteDisconnect: clientId => service.noteDisconnect(clientId),
    submitCommand: command => service.submitCommand(command),
    subscribe: listener => service.subscribe(listener),
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

/** One record document exactly as the platform writes it. */
function writeRecord(root: string, name: string, record: unknown): void {
  const dir = join(root, BOARD_UNIT_NAME, BOARD_UNIT_TABLE)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${name}.json`), JSON.stringify({ version: BOARD_UNIT_VERSION, record }), 'utf8')
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'dsh-board-http-'))
  backend = new JsonStorageBackend(root)
  service = makeService(backend)
  server = createServer((req, res) => {
    void createBoardHandler(depsFor(service), BASE)(req, res)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  origin = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  await new Promise<void>(resolve => { server.close(() => resolve()) })
  await backend.close()
  rmSync(root, { recursive: true, force: true })
})

/** Parse SSE `data:` frames off a live stream until the reader returns. */
async function readFrames(body: ReadableStream<Uint8Array>, count: number, ms = 3000): Promise<BoardEvent[]> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const deadline = Date.now() + ms
  let text = ''
  const frames: BoardEvent[] = []
  while (Date.now() < deadline) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('sse-timeout')), Math.max(50, deadline - Date.now()))),
    ]).catch(() => null)
    if (chunk === null || chunk.done) break
    text += decoder.decode(chunk.value, { stream: true })
    for (const match of text.matchAll(/^data: (.*)$/gm)) {
      try {
        frames.push(JSON.parse(match[1]) as BoardEvent)
      } catch {
        // partial line; the next chunk completes it
      }
    }
    if (frames.length >= count) break
  }
  reader.releaseLock()
  void body.cancel().catch(() => undefined)
  return frames
}

describe('board route over a real HTTP server', () => {
  it('serves the empty document on a fresh deployment', async () => {
    const response = await fetch(`${origin}${BASE}?clientId=smoke`)
    expect(response.status).toBe(200)
    const envelope = await response.json() as { ok: boolean; value: { available: boolean; revision: number; doc: { tasks: unknown[] } } }
    expect(envelope.ok).toBe(true)
    expect(envelope.value.available).toBe(true)
    expect(envelope.value.revision).toBe(0)
    expect(envelope.value.doc.tasks).toEqual([])
  })

  it('rejects a non-JSON POST with 415 (CSRF guard)', async () => {
    const response = await fetch(`${origin}${BASE}`, { method: 'POST', body: '{}' })
    expect(response.status).toBe(415)
  })

  it('commits a chunked body, persists to the real file, and streams the change over SSE', async () => {
    // Open the change stream first (as a replica does).
    const stream = await fetch(`${origin}${BASE}/events?clientId=watcher`, { headers: { accept: 'text/event-stream' } })
    expect(stream.headers.get('content-type')).toContain('text/event-stream')
    const body = stream.body
    expect(body).not.toBeNull()

    const commit: BoardCommit = {
      clientId: 'committer',
      tasks: [createTask({ title: '同步冒烟', description: '', prompt: 'p' }, Date.now(), 't-smoke')],
      deleted: [],
      cruise: { value: { enabled: true, limit: 2, schedule: [] }, at: Date.now() },
      schedulePresets: { value: [{ id: 'sp', label: 'L', cron: '0 9 * * *' }], at: Date.now() },
      runPresets: { value: { presets: [] }, at: Date.now() },
    }
    const response = await fetch(`${origin}${BASE}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(commit),
    })
    const envelope = await response.json() as { ok: boolean; value: { revision: number; doc: { tasks: { id: string }[] } } }
    expect(envelope.value.revision).toBe(1)
    expect(envelope.value.doc.tasks.map(t => t.id)).toEqual(['t-smoke'])

    // The watcher's live socket must carry the commit frame.
    const frames = await readFrames(body as ReadableStream<Uint8Array>, 1)
    expect(frames.some(f => f.type === 'commit' && f.revision === 1)).toBe(true)

    // The real platform backend wrote the real document: the unit is a
    // DIRECTORY now, with one version-stamped file per data kind.
    const raw = JSON.parse(readFileSync(join(root, BOARD_UNIT_NAME, BOARD_UNIT_TABLE, `${BOARD_DOCUMENT}.json`), 'utf8')) as { version: number; record: { tasks: { id: string }[] } }
    expect(raw.version).toBe(BOARD_UNIT_VERSION)
    expect(raw.record.tasks.map(t => t.id)).toEqual(['t-smoke'])
    // The old whole-unit file shape must not linger at the storage root.
    expect(existsSync(join(root, `${BOARD_UNIT_NAME}.json`))).toBe(false)
  })

  it('a restart over the same files restores the document (fresh service, same root)', async () => {
    // A second backend over the same dir simulates a dsh restart.
    const reopened = new JsonStorageBackend(root)
    const revived = makeService(reopened)
    await revived.ensureInit()
    expect(revived.available).toBe(true)
    expect(revived.getDoc().tasks.map(t => t.id)).toEqual(['t-smoke'])
    expect(revived.getDoc().revision).toBe(1)
    await reopened.close()
  })

  // The second document, on the real medium. What a fake unit cannot show is
  // that ONE unit holds TWO files and that each restores on its own — so this
  // reads the directory, and restarts over a real backend to compare the whole
  // document, field for field.
  it('an item write lands in its own file and leaves the board untouched, and BOTH restore after a restart', async () => {
    const boardFile = join(root, BOARD_UNIT_NAME, BOARD_UNIT_TABLE, `${BOARD_DOCUMENT}.json`)
    const itemsFile = join(root, BOARD_UNIT_NAME, BOARD_UNIT_TABLE, `${ITEMS_DOCUMENT}.json`)
    const boardBefore = readFileSync(boardFile, 'utf8')
    const boardRevisionBefore = service.getDoc().revision
    const boardBefore_ = service.getDoc()

    const committed: ItemsDoc = await service.commitItems(itemsCommitOf({
      clientId: 'committer',
      items: [
        row({ id: 'i-a', ref: 1, title: '第一条', priority: 'high' }),
        row({ id: 'i-b', ref: 2, title: '第二条', status: 'blocked', tags: ['x'] }),
        row({ id: 'i-c', ref: 3, title: '第三条', steps: [{ id: 's-1', text: '做', done: true }] }),
      ],
    }))
    expect(committed.revision).toBe(1)
    // The stored order is the document's own derivation (status, priority, the
    // nearest date, age, number), not the order the commit happened to send —
    // which is why two replicas holding the same rows never have to sync an
    // order at all, and why a restored document can be compared field for field.
    expect(committed.items.map(i => i.id)).toEqual(['i-a', 'i-c', 'i-b'])
    expect(committed.items.map(i => i.ref).sort()).toEqual([1, 2, 3])
    expect(committed.nextRef).toBe(4)

    // The checklist got its own version-stamped file…
    const itemsRaw = JSON.parse(readFileSync(itemsFile, 'utf8')) as { version: number; record: ItemsDoc }
    expect(itemsRaw.version).toBe(BOARD_UNIT_VERSION)
    expect(itemsRaw.record).toEqual(committed)
    // …and the board's file, revision and change frame were not touched: a
    // checklist write must not wake every replica to resync a board that did
    // not move.
    expect(readFileSync(boardFile, 'utf8')).toBe(boardBefore)
    expect(service.getDoc()).toBe(boardBefore_)
    expect(service.getDoc().revision).toBe(boardRevisionBefore)

    // A restart restores BOTH, each on its own, and equal in every field.
    const reopened = new JsonStorageBackend(root)
    const revived = makeService(reopened)
    await revived.ensureInit()
    expect(revived.available).toBe(true)
    expect(revived.getItemsDoc()).toEqual(committed)
    expect(revived.getDoc()).toEqual(service.getDoc())
    expect(revived.getDoc().revision).toBe(boardRevisionBefore)
    await revived.dispose()
    await reopened.close()
  })

  it('a restart never re-mints a number that is already in use', async () => {
    // The counter is document state, and it is only safe because it is written
    // with the rows: a derived `max(refs)+1` would hand a deleted row's number
    // to the next one. A replica whose copy predates the restart still arrives
    // claiming a number the restored document already holds.
    const reopened = new JsonStorageBackend(root)
    const revived = makeService(reopened)
    await revived.ensureInit()
    const before = revived.getItemsDoc()
    const inUse = before.items.map(i => i.ref)
    expect(inUse.length).toBeGreaterThan(0)

    const after = await revived.commitItems(itemsCommitOf({
      clientId: 'stale-replica',
      items: [row({ id: 'i-new', ref: inUse[0], title: '撞号的一行', updatedAt: T0 + 5 })],
      changed: ['i-new'],
    }))
    const refs = after.items.map(i => i.ref)
    expect(new Set(refs).size).toBe(refs.length)
    expect(refs).toContain(before.nextRef)
    // The existing rows kept the numbers the person already read out loud.
    for (const item of before.items) {
      expect(after.items.find(i => i.id === item.id)?.ref).toBe(item.ref)
    }
    await revived.dispose()
    await reopened.close()
  })

  // The two ways a document used to vanish, reproduced on a real medium: a tree
  // whose marker is gone, and a tree holding only the checklist. Asking "is
  // THIS document there" dropped one in each; asking "has this tree ever been
  // written" cannot, because the marker is a record like any other.
  it('restores a tree whose marker is missing — with only the checklist, and with both documents', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-board-nometa-'))
    try {
      const board = applyCommit(emptyBoardDoc(T0), {
        clientId: 'seed', tasks: [createTask({ title: '没有标记也要在', description: '', prompt: 'p' }, T0, 't-nometa')],
        deleted: [], cruise: { value: { enabled: false, limit: 3, schedule: [] }, at: T0 },
        schedulePresets: { value: [], at: T0 }, runPresets: { value: { presets: [] }, at: T0 },
      }, T0 + 1)
      const items = applyItemsCommit(emptyItemsDoc(T0), itemsCommitOf({
        items: [row({ id: 'i-a', ref: 1, title: '清单也在' }), row({ id: 'i-b', ref: 2, title: '第二条' })],
      }), T0 + 1)

      // Case one: the checklist alone, no board, no marker.
      const onlyItems = mkdtempSync(join(tmpdir(), 'dsh-board-nometa-items-'))
      try {
        writeRecord(onlyItems, ITEMS_DOCUMENT, items)
        const backend = new JsonStorageBackend(onlyItems)
        const service = makeService(backend)
        await service.ensureInit()
        expect(service.available).toBe(true)
        expect(service.getItemsDoc()).toEqual(items)
        expect(service.getDoc().revision).toBe(0)
        await service.dispose()
        await backend.close()
      } finally {
        rmSync(onlyItems, { recursive: true, force: true })
      }

      // Case two: both documents, still no marker.
      writeRecord(home, BOARD_DOCUMENT, board)
      writeRecord(home, ITEMS_DOCUMENT, items)
      const backend = new JsonStorageBackend(home)
      const service = makeService(backend)
      await service.ensureInit()
      expect(service.getDoc().tasks.map(t => t.id)).toEqual(['t-nometa'])
      expect(service.getItemsDoc()).toEqual(items)
      await service.dispose()
      await backend.close()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  // KNOWN DEGRADATION, stated rather than discovered: the platform's per-record
  // contract reads an unreadable or wrongly-stamped record as an ABSENT one, so
  // a corrupt `items.json` restores as an empty checklist — exactly what a
  // corrupt `board.json` does. "Cannot read it" and "it is empty" look the
  // same here; nothing in this service invents a default in place of data.
  it('a corrupt record file reads as an absent document (same degradation the board has)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-board-corrupt-'))
    try {
      const dir = join(home, BOARD_UNIT_NAME, BOARD_UNIT_TABLE)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, `${ITEMS_DOCUMENT}.json`), '{ not json', 'utf8')
      writeRecord(home, BOARD_DOCUMENT, emptyBoardDoc(T0))
      const backend = new JsonStorageBackend(home)
      const service = makeService(backend)
      await service.ensureInit()
      expect(service.available).toBe(true)
      expect(service.getItemsDoc().items).toEqual([])
      expect(service.getDoc().revision).toBe(0)
      await service.dispose()
      await backend.close()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('arbitrates the engine lease over the wire (and EVERY answer carries proto + bootedAt)', async () => {
    const leasePost = async (body: unknown): Promise<Record<string, unknown>> => {
      const response = await fetch(`${origin}${BASE}/lease`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      })
      const envelope = await response.json() as { value: { lease: Record<string, unknown> } }
      return envelope.value.lease
    }
    const first = await leasePost({ clientId: 'a', ttlMs: 15_000 })
    expect(first.held).toBe(true)
    expect(first.holder).toBe('a')
    // The GRANTED answer is the one every implementation remembered to fill…
    expect(first.proto).toBe(2)
    expect(typeof first.bootedAt).toBe('number')
    // …and the REJECTED answer is the one that used to be hand-built as
    // `{ held, holder, expiresAt }`, silently dropping `proto`. Every
    // non-engine device then read "host is old" from a CURRENT host and the
    // 「服务端未重启」 banner stood forever, restart or not. The rejected
    // answer must carry the exact same evidence as the granted one.
    const second = await leasePost({ clientId: 'b' })
    expect(second.held).toBe(false)
    expect(second.proto).toBe(2)
    expect(typeof second.bootedAt).toBe('number')
    expect(second.bootedAt).toBe(first.bootedAt)
    const release = await leasePost({ clientId: 'a', release: true })
    expect(release.held).toBe(false)
    expect(release.proto).toBe(2)
    expect(typeof release.bootedAt).toBe('number')
  })

  it('relays a launch command to the live engine stream', async () => {
    await fetch(`${origin}${BASE}/lease`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientId: 'engine-1' }),
    })
    const stream = await fetch(`${origin}${BASE}/events?clientId=engine-1`)
    const body = stream.body
    expect(body).not.toBeNull()
    await fetch(`${origin}${BASE}/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: 'phone', command: { type: 'run', taskId: 't-smoke', trigger: 'manual' } }),
    })
    const frames = await readFrames(body as ReadableStream<Uint8Array>, 1)
    const command = frames.find(f => f.type === 'command')
    expect(command).toBeDefined()
    if (command?.type === 'command') {
      // Narrows on the carrier: the relay carries four kinds of command, and
      // only `run` names a task. A reader that assumed otherwise would read a
      // rename as a task id.
      if (command.command.type === 'run') {
        expect(command.command.taskId).toBe('t-smoke')
      }
    }
  })

  // The layout migration is the one path where the REAL platform backend, the
  // REAL filesystem and the REAL retirement all meet. The unit specs stub one
  // side or the other, so the lossless claim only holds if it is exercised here.
  it('migrates a real pre-tree whole-unit file into the document tree, losslessly, once', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-board-migrate-'))
    const saved = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      mkdirSync(join(home, 'storages'), { recursive: true })
      const legacyPath = join(home, 'storages', `${BOARD_UNIT_NAME}.json`)
      const document = emptyBoardDoc(1)
      const seeded = applyCommit(document, {
        clientId: 'seed',
        tasks: [createTask({ title: '迁移前就在这', description: 'd', prompt: 'p' }, 1, 't-old')],
        deleted: [],
        cruise: { value: { enabled: false, limit: 3, schedule: [] }, at: 1 },
        schedulePresets: { value: [{ id: 'sp', label: 'L', cron: '0 9 * * *' }], at: 1 },
        runPresets: { value: { presets: [] }, at: 1 },
      }, 2)
      // The exact shape the platform's `single` layout writes.
      writeFileSync(legacyPath, JSON.stringify({ unit: { name: BOARD_UNIT_NAME, version: 1 }, global: seeded, tables: {} }), 'utf8')
      const before = readFileSync(legacyPath, 'utf8')

      const migrationBackend = new JsonStorageBackend(join(home, 'storages'))
      const opened = await openBoardUnit(
        async descriptor => migrationBackend.kv.open(descriptor) as never,
        1_000,
        () => undefined,
      )
      expect(opened).toBeDefined()
      // Every field survives, not just the task list.
      expect(opened?.documents[BOARD_DOCUMENT]).toEqual(seeded)
      expect(existsSync(join(home, 'storages', BOARD_UNIT_NAME, 'documents', 'board.json'))).toBe(true)
      expect(existsSync(join(home, 'storages', BOARD_UNIT_NAME, 'documents', 'meta.json'))).toBe(true)
      // Moved aside, not deleted: the bytes are the migration's own backup.
      expect(existsSync(legacyPath)).toBe(false)
      const retired = readdirSync(join(home, 'storages')).filter(n => n.startsWith(`${BOARD_UNIT_NAME}.json.migrated-`))
      expect(retired).toHaveLength(1)
      expect(readFileSync(join(home, 'storages', retired[0]), 'utf8')).toBe(before)
      await opened?.unit.close()
      await migrationBackend.close()

      // A restart finds the marker, so it never looks for the old file again.
      const restartBackend = new JsonStorageBackend(join(home, 'storages'))
      const restarted = new DocumentService({
        now: () => 2_000,
        openUnit: async descriptor => restartBackend.kv.open(descriptor) as never,
        log: () => undefined,
      })
      await restarted.ensureInit()
      expect(restarted.available).toBe(true)
      expect(restarted.getDoc().tasks.map(t => t.id)).toEqual(['t-old'])
      expect(restarted.getDoc().revision).toBe(seeded.revision)
      await restarted.dispose()
      await restartBackend.close()
    } finally {
      if (saved === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = saved
      rmSync(home, { recursive: true, force: true })
    }
  })

  // The checklist's own tail, over a REAL socket. What the fake-req spec
  // cannot show: the shared CSRF guard and the shared `since` rule holding on
  // the wire, and an item write leaving the board's file and the board's
  // revision exactly where they were.
  it('serves and commits the checklist at /board/items, without touching the board', async () => {
    const ITEMS = `${origin}${BASE}/items`
    const boardFile = join(root, BOARD_UNIT_NAME, BOARD_UNIT_TABLE, `${BOARD_DOCUMENT}.json`)
    const boardBytesBefore = readFileSync(boardFile, 'utf8')
    const boardRevisionBefore = service.getDoc().revision
    const itemsBefore = service.getItemsDoc()
    const nextRef = itemsBefore.nextRef

    // A watcher socket, so a frame the write SHOULD NOT send would be visible.
    const stream = await fetch(`${origin}${BASE}/events?clientId=items-watcher`)
    expect(stream.body).not.toBeNull()

    // A first GET carries the whole document.
    const first = await fetch(`${ITEMS}?clientId=phone`)
    expect(first.status).toBe(200)
    const firstEnvelope = await first.json() as { ok: boolean; value: { available: boolean; revision: number; doc?: { items: { id: string }[] }; unchanged?: boolean } }
    expect(firstEnvelope.value.available).toBe(true)
    expect(firstEnvelope.value.revision).toBe(itemsBefore.revision)
    expect(firstEnvelope.value.unchanged).toBeUndefined()
    expect(firstEnvelope.value.doc?.items).toHaveLength(itemsBefore.items.length)

    // The shared CSRF guard: a text/plain commit never reaches the merge.
    const refused = await fetch(ITEMS, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ clientId: 'x' }) })
    expect(refused.status).toBe(415)
    // A malformed envelope answers the shared error shape, not a throw.
    const malformed = await fetch(ITEMS, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientId: '' }) })
    expect((await malformed.json() as { ok: boolean }).ok).toBe(false)

    // The commit itself: over the wire, through the real merge, onto disk.
    const committed = await fetch(ITEMS, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(itemsCommitOf({ clientId: 'phone', items: [row({ id: 'i-wire', ref: 0, title: '线上写入', updatedAt: T0 + 1 })] })),
    })
    const envelope = await committed.json() as { ok: boolean; value: { revision: number; doc: ItemsDoc } }
    expect(envelope.ok).toBe(true)
    expect(envelope.value.revision).toBe(itemsBefore.revision + 1)
    // The document minted the number, not the replica (which sent ref 0).
    expect(envelope.value.doc.items.find(i => i.id === 'i-wire')?.ref).toBe(nextRef)
    expect(envelope.value.doc.nextRef).toBe(nextRef + 1)

    // The board did not move: not its revision, not its file, not its frames.
    expect(service.getDoc().revision).toBe(boardRevisionBefore)
    expect(readFileSync(boardFile, 'utf8')).toBe(boardBytesBefore)
    expect(await readFrames(stream.body as ReadableStream<Uint8Array>, 1, 600)).toHaveLength(0)

    // A no-op commit answers the same revision and rewrites nothing.
    const itemsBytes = readFileSync(join(root, BOARD_UNIT_NAME, BOARD_UNIT_TABLE, `${ITEMS_DOCUMENT}.json`), 'utf8')
    const again = await fetch(ITEMS, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(itemsCommitOf({ clientId: 'phone', items: [row({ id: 'i-wire', ref: 0, title: '线上写入', updatedAt: T0 + 1 })] })),
    })
    const againEnvelope = await again.json() as { value: { revision: number } }
    expect(againEnvelope.value.revision).toBe(itemsBefore.revision + 1)
    expect(readFileSync(join(root, BOARD_UNIT_NAME, BOARD_UNIT_TABLE, `${ITEMS_DOCUMENT}.json`), 'utf8')).toBe(itemsBytes)
    expect(readFileSync(boardFile, 'utf8')).toBe(boardBytesBefore)

    // The shared `since` rule, on the checklist's OWN counter.
    const probe = await fetch(`${ITEMS}?since=${againEnvelope.value.revision}`)
    const probeEnvelope = await probe.json() as { value: { unchanged?: boolean; doc?: unknown; revision: number } }
    expect(probeEnvelope.value.unchanged).toBe(true)
    expect(probeEnvelope.value.doc).toBeUndefined()
    expect(probeEnvelope.value.revision).toBe(againEnvelope.value.revision)
    // The board's counter is a different question: it has not moved at all.
    const boardProbe = await fetch(`${origin}${BASE}?since=${boardRevisionBefore}`)
    expect((await boardProbe.json() as { value: { unchanged?: boolean } }).value.unchanged).toBe(true)
  })
})
