/**
 * Board HTTP integration smoke: a REAL http.Server + real fetch + a live SSE
 * socket, over the REAL platform json storage backend (`JsonStorageBackend`
 * on a temp dir). The unit specs stub req/res and the KV unit; this one
 * proves the assumptions those stubs hide: HTTP prefix routing, chunked JSON
 * bodies, the SSE frame format on a live stream, the lease/command relay over
 * the wire, and the KvUnit file format + version stamp + restart restore on
 * disk. It is the runtime contract the multi-device sync rests on.
 */
import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { BoardDataService, BOARD_UNIT_NAME, BOARD_UNIT_VERSION } from '../src/host/board-service.ts'
import { createBoardHandler, type BoardRouteDeps } from '../src/host/board-route.ts'
import type { BoardCommit, BoardEvent } from '../src/core/board-doc.ts'
import { createTask } from '../src/core/tasks.ts'

const BASE = '/api/dsh-task-board/board'

let root: string
let backend: JsonStorageBackend
let service: BoardDataService
let server: Server
let origin: string

function openUnit(backend: JsonStorageBackend) {
  return backend.kv.open({ name: BOARD_UNIT_NAME, version: BOARD_UNIT_VERSION, tables: [], hasGlobal: true })
}

function makeService(backend: JsonStorageBackend): BoardDataService {
  const service = new BoardDataService({
    openUnit: async () => openUnit(backend),
    log: () => undefined,
  })
  return service
}

function depsFor(service: BoardDataService): BoardRouteDeps {
  return {
    ready: () => service.ensureInit(),
    available: () => service.available,
    doc: () => service.getDoc(),
    commit: commit => service.commit(commit),
    acquireLease: (clientId, ttlMs) => service.acquireLease(clientId, ttlMs),
    releaseLease: clientId => service.releaseLease(clientId),
    noteActivity: clientId => service.noteActivity(clientId),
    noteStreamOpen: clientId => service.noteStreamOpen(clientId),
    noteDisconnect: clientId => service.noteDisconnect(clientId),
    submitCommand: command => service.submitCommand(command),
    subscribe: listener => service.subscribe(listener),
  }
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

    // The real platform backend wrote the real file with the unit header.
    const raw = JSON.parse(readFileSync(join(root, `${BOARD_UNIT_NAME}.json`), 'utf8')) as { unit: { name: string; version: number }; global: { tasks: { id: string }[] } }
    expect(raw.unit.name).toBe(BOARD_UNIT_NAME)
    expect(raw.unit.version).toBe(BOARD_UNIT_VERSION)
    expect(raw.global.tasks.map(t => t.id)).toEqual(['t-smoke'])
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

  it('arbitrates the engine lease over the wire', async () => {
    const first = await (await fetch(`${origin}${BASE}/lease`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientId: 'a', ttlMs: 15_000 }),
    })).json() as { value: { lease: { held: boolean; holder: string } } }
    expect(first.value.lease.held).toBe(true)
    expect(first.value.lease.holder).toBe('a')
    const second = await (await fetch(`${origin}${BASE}/lease`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientId: 'b' }),
    })).json() as { value: { lease: { held: boolean } } }
    expect(second.value.lease.held).toBe(false)
    const release = await (await fetch(`${origin}${BASE}/lease`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientId: 'a', release: true }),
    })).json() as { value: { lease: { held: boolean } } }
    expect(release.value.lease.held).toBe(false)
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
      expect(command.command.taskId).toBe('t-smoke')
    }
  })
})
