/**
 * Board route layer for the task-board plugin: the HTTP + SSE surface that
 * serves the host-owned board document to every browser replica.
 *
 *   GET  /api/<ns>/board            → { available, revision, doc?, lease? }
 *                                     (?since=N answers unchanged for N >= revision)
 *   POST /api/<ns>/board            → commit {clientId, tasks, deleted, sections}
 *                                     → the authoritative document after the merge
 *   POST /api/<ns>/board/lease      → {clientId, ttlMs?, release?} → lease state
 *   POST /api/<ns>/board/command    → relay one user launch to the engine
 *   GET  /api/<ns>/board/events     → SSE: commit / lease / command frames
 *
 * The handler is a pure function over an injected service face, so the whole
 * protocol is unit-testable without a live server; `registerBoardRoute` wires
 * the real services and owns the service lifecycle (init on register, dispose
 * on unload).
 * @module dsh-task-board/host/board-route
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { BoardCommit, BoardDoc } from '../core/board-doc.ts'
import { BoardDataService, storageHubOpener, type BoardCommand, type BoardEvent, type LeaseState } from './board-service.ts'
import { readJsonBody } from './http-json.ts'

/** The commit body size cap: the whole ledger travels per commit. */
export const BOARD_BODY_LIMIT_BYTES = 8 << 20

/** The SSE keep-alive cadence (below common proxy idle timeouts). */
export const BOARD_SSE_KEEPALIVE_MS = 25_000

/** The board view the GET/commit responses carry. */
export interface BoardRouteView {
  /** False while the host serves no synced board (replicas fall back). */
  available: boolean
  revision: number
  /** The authoritative document (absent on `unchanged` probes). */
  doc?: BoardDoc
  /** True when `since` already covers the current revision. */
  unchanged?: boolean
  /** The current engine-lease state (replicas bootstrap from it). */
  lease?: LeaseState
  /** The relay receipt for a submitted command. */
  command?: { queued: boolean }
}

/** Success envelope carrying a board view. */
export interface BoardRouteOk {
  ok: true
  value: BoardRouteView
}

/** Failure envelope carrying a stable business error code. */
export interface BoardRouteFail {
  ok: false
  error: { code: string; message: string }
}

export type BoardRouteEnvelope = BoardRouteOk | BoardRouteFail

/** The shared malformed-request failure (same shape as the settings route). */
const MALFORMED: BoardRouteFail = { ok: false, error: { code: 'internal', message: 'malformed request' } }

/** Write one JSON envelope response (same discipline as the settings route). */
function json(res: ServerResponse, envelope: BoardRouteEnvelope, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(envelope))
}

/** The service face the route needs (the real service or a test fake). */
export interface BoardRouteDeps {
  /** Settle the one-time storage init before any read/write. */
  ready(): Promise<void>
  available(): boolean
  doc(): BoardDoc
  commit(commit: BoardCommit): Promise<BoardDoc>
  acquireLease(clientId: string, ttlMs?: number, active?: boolean): LeaseState
  releaseLease(clientId: string): LeaseState
  noteActivity(clientId: string | undefined): void
  noteStreamOpen(clientId: string | undefined): void
  noteDisconnect(clientId: string | undefined): void
  submitCommand(command: BoardCommand): { queued: boolean }
  subscribe(listener: (event: BoardEvent) => void): () => void
}

/** Extract a commit from an untrusted body; undefined when unusable. The
 *  merge grammar normalizes every row/section, so this only checks the
 *  envelope shape (arrays/strings), never the data. */
export function parseBoardCommit(body: unknown): BoardCommit | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const row = body as Record<string, unknown>
  if (typeof row.clientId !== 'string' || row.clientId === '' || row.clientId.length > 64) return undefined
  const section = (value: unknown): { value: unknown; at: number } => {
    if (typeof value !== 'object' || value === null) return { value: undefined, at: 0 }
    const entry = value as Record<string, unknown>
    const at = typeof entry.at === 'number' && Number.isFinite(entry.at) ? entry.at : 0
    return { value: entry.value, at }
  }
  const deleted = Array.isArray(row.deleted)
    ? row.deleted
      .map((entry): { id: string; baseUpdatedAt: number } | undefined => {
        if (typeof entry !== 'object' || entry === null) return undefined
        const del = entry as Record<string, unknown>
        if (typeof del.id !== 'string' || del.id === '') return undefined
        const baseUpdatedAt = typeof del.baseUpdatedAt === 'number' && Number.isFinite(del.baseUpdatedAt) ? del.baseUpdatedAt : 0
        return { id: del.id, baseUpdatedAt }
      })
      .filter((entry): entry is { id: string; baseUpdatedAt: number } => entry !== undefined)
    : []
  // Authorship claims: a plain id list (the grammar itself re-checks every
  // row; a claim can only vouch for content this replica carries anyway).
  const changed = Array.isArray(row.changed)
    ? row.changed.filter((id): id is string => typeof id === 'string' && id !== '')
    : []
  // Section claims: PRESENT (even empty) = the claim protocol; ABSENT =
  // legacy LWW. Only the three known keys survive the filter.
  const sectionClaims = Array.isArray(row.sectionClaims)
    ? row.sectionClaims.filter(
      (key): key is 'cruise' | 'schedulePresets' | 'runPresets' =>
        key === 'cruise' || key === 'schedulePresets' || key === 'runPresets',
    )
    : undefined
  return {
    clientId: row.clientId,
    tasks: Array.isArray(row.tasks) ? row.tasks as BoardCommit['tasks'] : [],
    changed,
    sectionClaims,
    deleted,
    cruise: section(row.cruise) as BoardCommit['cruise'],
    schedulePresets: section(row.schedulePresets) as BoardCommit['schedulePresets'],
    runPresets: section(row.runPresets) as BoardCommit['runPresets'],
  }
}

/** Parse the POST body of the lease endpoint. `active` (the tab is visible)
 *  drives the host's visibility preemption; absent = visible (a client that
 *  predates the flag never loses ground it would have kept). */
function parseLeaseBody(body: unknown): { clientId: string; ttlMs?: number; release: boolean; active: boolean } | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const row = body as Record<string, unknown>
  if (typeof row.clientId !== 'string' || row.clientId === '' || row.clientId.length > 64) return undefined
  return {
    clientId: row.clientId,
    ...typeof row.ttlMs === 'number' && Number.isFinite(row.ttlMs) ? { ttlMs: row.ttlMs } : {},
    release: row.release === true,
    active: row.active !== false,
  }
}

/** Parse the POST body of the command relay. */
function parseCommandBody(body: unknown): { clientId: string; command?: BoardCommand } | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const row = body as Record<string, unknown>
  if (typeof row.clientId !== 'string' || row.clientId === '') return undefined
  const command = row.command as Record<string, unknown> | undefined
  if (typeof command !== 'object' || command === null) return { clientId: row.clientId }
  if (command.type !== 'run' || typeof command.taskId !== 'string' || command.taskId === '') return { clientId: row.clientId }
  const trigger = command.trigger === 'schedule' || command.trigger === 'chain' ? command.trigger : 'manual'
  return { clientId: row.clientId, command: { type: 'run', taskId: command.taskId, trigger, clientId: row.clientId } }
}

/** The pure request processor (one prefix route, dispatched by path tail). */
export function createBoardHandler(
  deps: BoardRouteDeps,
  base: string,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res): Promise<void> => {
    let url: URL
    try {
      url = new URL(req.url ?? '/', 'http://dsh.local')
    } catch {
      json(res, MALFORMED, 400)
      return
    }
    const tail = url.pathname.slice(base.length)

    // The first request settles storage init; later calls ride the result.
    await deps.ready()

    // ── SSE: the replica change channel ─────────────────────────────────────
    if (req.method === 'GET' && tail === '/events') {
      serveEvents(deps, url, res)
      return
    }

    if (req.method === 'GET' && tail === '') {
      // `since` is absent (Number(null) === 0 — the initial-fetch trap) vs a
      // real revision: only an explicit param may short-circuit the body.
      const sinceParam = url.searchParams.get('since')
      const since = sinceParam === null ? Number.NaN : Number(sinceParam)
      const doc = deps.doc()
      const clientId = url.searchParams.get('clientId') ?? undefined
      deps.noteActivity(clientId)
      if (Number.isFinite(since) && since >= doc.revision) {
        const view: BoardRouteView = { available: deps.available(), revision: doc.revision, unchanged: true }
        json(res, { ok: true as const, value: view })
        return
      }
      const view: BoardRouteView = { available: deps.available(), revision: doc.revision, doc }
      json(res, { ok: true as const, value: view })
      return
    }

    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    // The CSRF discipline every plugin route shares: JSON content-type only.
    const contentType = req.headers['content-type'] ?? ''
    if (!contentType.toLowerCase().startsWith('application/json')) {
      json(res, MALFORMED, 415)
      return
    }
    const payload = await readJsonBody(req, BOARD_BODY_LIMIT_BYTES)

    if (tail === '') {
      const commit = parseBoardCommit(payload)
      if (commit === undefined) {
        json(res, MALFORMED)
        return
      }
      if (!deps.available()) {
        json(res, { ok: true as const, value: { available: false, revision: 0 } satisfies BoardRouteView })
        return
      }
      deps.noteActivity(commit.clientId)
      const doc = await deps.commit(commit)
      const view: BoardRouteView = { available: true, revision: doc.revision, doc }
      json(res, { ok: true as const, value: view })
      return
    }

    if (tail === '/lease') {
      const parsed = parseLeaseBody(payload)
      if (parsed === undefined) {
        json(res, MALFORMED)
        return
      }
      const lease = parsed.release ? deps.releaseLease(parsed.clientId) : deps.acquireLease(parsed.clientId, parsed.ttlMs, parsed.active)
      json(res, { ok: true as const, value: { available: deps.available(), revision: deps.doc().revision, lease } satisfies BoardRouteView })
      return
    }

    if (tail === '/command') {
      const parsed = parseCommandBody(payload)
      if (parsed === undefined || parsed.command === undefined) {
        json(res, MALFORMED)
        return
      }
      const { queued } = deps.submitCommand(parsed.command)
      const view: BoardRouteView = { available: deps.available(), revision: deps.doc().revision, command: { queued } }
      json(res, { ok: true as const, value: view })
      return
    }

    json(res, MALFORMED, 404)
  }
}

/** Serve one SSE connection: frames as `data: <json>`, keep-alive comments,
 *  and a clean unsubscribe (plus the disconnect note) on close. */
function serveEvents(deps: BoardRouteDeps, url: URL, res: ServerResponse): void {
  const clientId = url.searchParams.get('clientId') ?? undefined
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    // Tell buffering proxies (the mobile gateway included) to pass through.
    'x-accel-buffering': 'no',
  })
  res.write('retry: 3000\n\n')
  // The open stream is the holder's liveness proof (survives tab timer
  // throttling; a dead socket surfaces through the close event).
  deps.noteStreamOpen(clientId)
  let open = true
  const unsubscribe = deps.subscribe(event => {
    if (!open) return
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`)
    } catch {
      open = false
    }
  })
  const keepAlive = setInterval(() => {
    if (!open) return
    try {
      res.write(':ka\n\n')
    } catch {
      open = false
    }
  }, BOARD_SSE_KEEPALIVE_MS)
  // The replica's activity on the stream renews its lease (throttle-proof).
  deps.noteActivity(clientId)
  res.on('close', () => {
    open = false
    clearInterval(keepAlive)
    unsubscribe()
    deps.noteDisconnect(clientId)
  })
}

/**
 * Register the board route (prefix) and own the service lifecycle: open the
 * persistence unit through the platform storage hub, serve once initialized,
 * dispose the unit on unload.
 * @param ctx - context carrying the webServer and storage services.
 * @param ns - the plugin namespace this route serves.
 * @returns the disposer removing the route and closing the service.
 */
export function registerBoardRoute(ctx: Context, ns: string): () => void {
  const webServer = ctx.get('webServer') as { register(options: unknown): () => void } | undefined
  if (webServer === undefined) return () => undefined
  // The storage hub is resolved at first request (the opener's thunk reads
  // ctx.get('storage') after boot settlement), never via inject: a
  // composition without the hub degrades to fallback mode, it must not
  // wedge the whole plugin.
  const service = new BoardDataService({ openUnit: storageHubOpener(() => ctx.get('storage')) })
  void service.ensureInit()
  const deps: BoardRouteDeps = {
    ready: () => service.ensureInit(),
    available: () => service.available,
    doc: () => service.getDoc(),
    commit: commit => service.commit(commit),
    acquireLease: (clientId, ttlMs, active) => service.acquireLease(clientId, ttlMs, active),
    releaseLease: clientId => service.releaseLease(clientId),
    noteActivity: clientId => service.noteActivity(clientId),
    noteStreamOpen: clientId => service.noteStreamOpen(clientId),
    noteDisconnect: clientId => service.noteDisconnect(clientId),
    submitCommand: command => service.submitCommand(command),
    subscribe: listener => service.subscribe(listener),
  }
  const path = `/api/${ns}/board`
  const handler = createBoardHandler(deps, path)
  const disposeRoute = webServer.register({ kind: 'prefix', path, handler })
  return () => {
    disposeRoute()
    void service.dispose()
  }
}
