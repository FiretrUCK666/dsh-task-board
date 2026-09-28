/**
 * Board route layer for the task-board plugin: the HTTP + SSE surface that
 * serves the host-owned board document to every browser replica.
 *
 *   GET  /api/<ns>/board            → { available, revision, doc?, lease? }
 *                                     (?since=N answers unchanged for N >= revision)
 *   POST /api/<ns>/board            → commit {clientId, tasks, deleted, sections}
 *                                     → the authoritative document after the merge
 *   GET  /api/<ns>/board/items      → the checklist document + its own revision
 *                                     (?since=N answers unchanged for N >= revision)
 *   POST /api/<ns>/board/items      → ItemsCommit {clientId, items, changed, deleted}
 *                                     → the authoritative checklist after the merge
 *   POST /api/<ns>/board/lease      → {clientId, ttlMs?, release?} → lease state
 *   POST /api/<ns>/board/command    → relay one user launch to the engine
 *   GET  /api/<ns>/board/surfaces   → which of this plugin's rows are on
 *   POST /api/<ns>/board/ask        → {taskId, ref} → hand one item to that
 *                                     card's session model (the same funnel
 *                                     `/task` uses)
 *   GET  /api/<ns>/board/events     → SSE: commit / lease / command frames
 *
 * ONE route file, ONE envelope discipline, ONE CSRF guard: every POST tail
 * passes the same `application/json` check before its body is even read, and a
 * second document is a second TAIL of the same prefix — not a second handler,
 * a second envelope, or a second content-type rule.
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
import type { ItemsCommit, ItemsDoc } from '../core/items-doc.ts'
import type { ItemRecord } from '../core/item.ts'
import { relatedSessionIdsOf } from '../core/task-live.ts'
import { DocumentService, storageHubOpener, type BoardCommand, type BoardEvent, type LeaseState } from './board-service.ts'
import { handOver } from './agent/commands.ts'
import { sessionRunningOf, type SessionPostureSources } from './session-state.ts'
import { readJsonBody } from './http-json.ts'
import { surfaceManifest } from './surfaces.ts'

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

/** The checklist view — the same envelope, a document of its own.
 *
 *  `revision` is the CHECKLIST's revision, never the board's: a replica that
 *  polls this tail watches a counter that only item writes move, so writing an
 *  item never makes every device resync a board that did not change. */
export interface ItemsRouteView {
  /** False while the host serves no synced documents (replicas fall back). */
  available: boolean
  revision: number
  /** The authoritative checklist (absent on `unchanged` probes). */
  doc?: ItemsDoc
  /** True when `since` already covers the current revision. */
  unchanged?: boolean
}

/** Success envelope carrying a route's value. */
export interface RouteOk<T> {
  ok: true
  value: T
}

/** Success envelope carrying a board view. */
export type BoardRouteOk = RouteOk<BoardRouteView>

/** Success envelope carrying a checklist view. */
export type ItemsRouteOk = RouteOk<ItemsRouteView>

/** Failure envelope carrying a stable business error code. */
export interface BoardRouteFail {
  ok: false
  error: { code: string; message: string }
}

export type BoardRouteEnvelope = BoardRouteOk | BoardRouteFail
export type ItemsRouteEnvelope = ItemsRouteOk | BoardRouteFail

/** The shared malformed-request failure (same shape as the settings route). */
const MALFORMED: BoardRouteFail = { ok: false, error: { code: 'internal', message: 'malformed request' } }

/** Write one JSON envelope response, for either document (same discipline as
 *  the settings route): ONE writer, generic over the value it carries, so a
 *  second document cannot grow a second response dialect. */
function json<T>(res: ServerResponse, envelope: RouteOk<T> | BoardRouteFail, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(envelope))
}

/** The service face the route needs (the real service or a test fake).
 *
 *  `itemsDoc` / `commitItems` are the SECOND document's two ends, beside the
 *  board's two. The lease and the relay are UNIT-level and stay single. */
export interface BoardRouteDeps {
  /** Settle the one-time storage init before any read/write. */
  ready(): Promise<void>
  available(): boolean
  doc(): BoardDoc
  commit(commit: BoardCommit): Promise<BoardDoc>
  itemsDoc(): ItemsDoc
  commitItems(commit: ItemsCommit): Promise<ItemsDoc>
  acquireLease(clientId: string, ttlMs?: number, active?: boolean): LeaseState
  releaseLease(clientId: string): LeaseState
  noteActivity(clientId: string | undefined): void
  noteStreamOpen(clientId: string | undefined): void
  noteDisconnect(clientId: string | undefined): void
  submitCommand(command: BoardCommand): { queued: boolean }
  /**
   * Hand one checklist item to the model of the session that card runs in.
   *
   * NOT a new path to the model: it is the same `agent.followup` the `/task`
   * command uses, so "hand this sentence to a model" stays one fact with one
   * implementation. What is new here is only the TARGET — the panel shows no
   * conversation, so the session has to come from the card the item hangs off.
   */
  ask(request: AskRequest): Promise<AskRouteView>
  subscribe(listener: (event: BoardEvent) => void): () => void
}

/** What the panel sends: which card's session, and which item in it. */
export interface AskRequest {
  /** The card the item hangs off — it decides WHICH session is talked to. */
  readonly taskId: string
  /** The item's short id, as the panel already shows it. */
  readonly ref: number
}

/** The hand-off's outcome, said in words the panel can render as-is. */
export type AskRouteView =
  | { readonly ok: true; readonly sessionId: string; readonly said: string }
  | { readonly ok: false; readonly why: string }

/** Parse the ask body: both fields are required and both are plain scalars. */
function parseAskBody(body: unknown): AskRequest | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const record = body as Record<string, unknown>
  if (typeof record.taskId !== 'string' || record.taskId === '') return undefined
  if (typeof record.ref !== 'number' || !Number.isFinite(record.ref)) return undefined
  return { taskId: record.taskId, ref: record.ref }
}

/** The caller id every commit body must carry. One rule, both documents. */
function clientIdOf(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const id = (body as Record<string, unknown>).clientId
  return typeof id === 'string' && id !== '' && id.length <= 64 ? id : undefined
}

/** The deletions a replica observed, with the stamp each was computed against.
 *  Shared by both documents' parsers: a delete means the same thing to a task
 *  ledger and to a checklist, and one rule cannot be right in one place and
 *  wrong in the other. */
function parseDeletes(raw: unknown): ItemsCommit['deleted'] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((entry): { id: string; baseUpdatedAt: number } | undefined => {
      if (typeof entry !== 'object' || entry === null) return undefined
      const del = entry as Record<string, unknown>
      if (typeof del.id !== 'string' || del.id === '') return undefined
      const baseUpdatedAt = typeof del.baseUpdatedAt === 'number' && Number.isFinite(del.baseUpdatedAt) ? del.baseUpdatedAt : 0
      return { id: del.id, baseUpdatedAt }
    })
    .filter((entry): entry is { id: string; baseUpdatedAt: number } => entry !== undefined)
}

/** Authorship claims: a plain id list (the grammar itself re-checks every
 *  row; a claim can only vouch for content this replica carries anyway).
 *  Shared by both documents' parsers, like {@link parseDeletes}. */
function parseChangedIds(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string' && id !== '') : []
}

/** Extract a commit from an untrusted body; undefined when unusable. The
 *  merge grammar normalizes every row/section, so this only checks the
 *  envelope shape (arrays/strings), never the data. */
export function parseBoardCommit(body: unknown): BoardCommit | undefined {
  const clientId = clientIdOf(body)
  if (clientId === undefined) return undefined
  const row = body as Record<string, unknown>
  const section = (value: unknown): { value: unknown; at: number } => {
    if (typeof value !== 'object' || value === null) return { value: undefined, at: 0 }
    const entry = value as Record<string, unknown>
    const at = typeof entry.at === 'number' && Number.isFinite(entry.at) ? entry.at : 0
    return { value: entry.value, at }
  }
  // Section claims: PRESENT (even empty) = the claim protocol; ABSENT =
  // legacy LWW. Only the three known keys survive the filter.
  const sectionClaims = Array.isArray(row.sectionClaims)
    ? row.sectionClaims.filter(
      (key): key is 'cruise' | 'schedulePresets' | 'runPresets' =>
        key === 'cruise' || key === 'schedulePresets' || key === 'runPresets',
    )
    : undefined
  return {
    clientId,
    tasks: Array.isArray(row.tasks) ? row.tasks as BoardCommit['tasks'] : [],
    changed: parseChangedIds(row.changed),
    sectionClaims,
    deleted: parseDeletes(row.deleted),
    cruise: section(row.cruise) as BoardCommit['cruise'],
    schedulePresets: section(row.schedulePresets) as BoardCommit['schedulePresets'],
    runPresets: section(row.runPresets) as BoardCommit['runPresets'],
  }
}

/** Extract a checklist commit from an untrusted body; undefined when unusable.
 *
 *  This document has NO sections — the checklist carries none — so its commit
 *  is rows + claims + deletions and nothing else. Lifting the board's three
 *  section fields onto it would be inventing state the document does not have,
 *  and the same envelope rule (clientId, claims, deletes) is what both parsers
 *  share above. */
export function parseItemsCommit(body: unknown): ItemsCommit | undefined {
  const clientId = clientIdOf(body)
  if (clientId === undefined) return undefined
  const row = body as Record<string, unknown>
  return {
    clientId,
    items: Array.isArray(row.items) ? row.items as ItemsCommit['items'] : [],
    changed: parseChangedIds(row.changed),
    deleted: parseDeletes(row.deleted),
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

/** The revision a `?since=` probe claims to already hold, or NaN when the
 *  param is absent.
 *
 *  `since` absent (Number(null) === 0 — the initial-fetch trap) vs a real
 *  revision: only an explicit param may short-circuit a body. BOTH documents
 *  read it through here, because "unchanged means unchanged" is one rule — a
 *  replica that learned it twice would learn one of them wrong. */
function sinceOf(url: URL): number {
  const raw = url.searchParams.get('since')
  return raw === null ? Number.NaN : Number(raw)
}

/** The view one document GET answers with: availability, that document's OWN
 *  revision, the document itself, or the unchanged short-circuit.
 *
 *  ONE builder, both documents. A second copy of "is this probe already
 *  covered?" would be a second answer to the same question, and the copy that
 *  drifts is the one a replica trusts — so the probe that must not short-
 *  circuit is the one that has to be right. */
function documentGetView<T extends { revision: number }>(deps: BoardRouteDeps, url: URL, doc: T):
    | { available: boolean; revision: number; unchanged: true }
    | { available: boolean; revision: number; doc: T } {
  const available = deps.available()
  const since = sinceOf(url)
  if (Number.isFinite(since) && since >= doc.revision) {
    return { available, revision: doc.revision, unchanged: true }
  }
  return { available, revision: doc.revision, doc }
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

    // ── GET: which surfaces this plugin's rows are switched on for ───────────
    //
    // Answered BEFORE `deps.ready()`: a reader that switched a row off must not
    // have to wait for storage to learn that, and this answer does not depend
    // on storage at all — it is read from the rows the loader evaluated.
    if (req.method === 'GET' && tail === '/surfaces') {
      json(res, { ok: true as const, value: surfaceManifest() })
      return
    }

    // ── SSE: the replica change channel ─────────────────────────────────────
    if (req.method === 'GET' && tail === '/events') {
      serveEvents(deps, url, res)
      return
    }

    // ── GET: one document per tail, one since rule ──────────────────────────
    if (req.method === 'GET' && (tail === '' || tail === '/items')) {
      // The seat is UNIT-level, so a checklist read renews it exactly like a
      // board read does: one engine, one lease, any document's traffic.
      deps.noteActivity(url.searchParams.get('clientId') ?? undefined)
      json(res, {
        ok: true as const,
        value: tail === '' ? documentGetView(deps, url, deps.doc()) : documentGetView(deps, url, deps.itemsDoc()),
      })
      return
    }

    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    // The CSRF discipline every plugin route shares: JSON content-type only.
    // It sits ABOVE the tail dispatch on purpose — every POST tail of this
    // prefix passes this one check, and a second document cannot grow a second
    // content-type rule (nor a second body reader).
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

    if (tail === '/items') {
      const commit = parseItemsCommit(payload)
      if (commit === undefined) {
        json(res, MALFORMED)
        return
      }
      if (!deps.available()) {
        json(res, { ok: true as const, value: { available: false, revision: 0 } satisfies ItemsRouteView })
        return
      }
      deps.noteActivity(commit.clientId)
      const doc = await deps.commitItems(commit)
      json(res, { ok: true as const, value: { available: true, revision: doc.revision, doc } satisfies ItemsRouteView })
      return
    }

    if (tail === '/ask') {
      // The panel's one-click hand-off. It goes through the SAME funnel the
      // `/task` command uses — `agent.followup` on a real UserMessage — because
      // "hand this sentence to a model" must be one fact with one path: a
      // second way to say it is a second thing to keep in step, and the first
      // time they drifted nobody would have found out.
      const ask = parseAskBody(payload)
      if (ask === undefined) {
        json(res, MALFORMED)
        return
      }
      json(res, { ok: true as const, value: await deps.ask(ask) satisfies AskRouteView })
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
 * Hand one checklist item to the model of the session its card runs in.
 *
 * WHY THE CARD DECIDES THE TARGET. The panel is a main-stage page, so no
 * conversation is on screen while it is open — there is no "current session" to
 * send anything to. The card is what the item hangs off, and the card already
 * knows its sessions, so the target is a fact the document already holds rather
 * than a picker the reader has to answer.
 *
 * WHICH SESSION WHEN THERE ARE SEVERAL: one that is actually running. A card can
 * hold several sessions, and "the one doing work right now" is the only choice
 * that matches what the reader means by "ask the AI about this". When none is
 * running the FIRST bound session is used, and the receipt names it either way —
 * a hand-off that cannot be told apart afterwards is not a receipt.
 *
 * THE HAND-OFF ITSELF is `handOver` from the agent surface: one path into a
 * model, shared with the two slash commands.
 */
async function handOneItemToItsCardSession(
  ctx: Context,
  service: DocumentService,
  request: AskRequest,
): Promise<AskRouteView> {
  if (!service.available) return { ok: false, why: 'hostStorageMissing' }
  const card = service.getDoc().tasks.find(task => task.id === request.taskId)
  if (card === undefined) return { ok: false, why: 'noSuchTask' }
  const item = service.getItemsDoc().items.find(entry => entry.ref === request.ref)
  if (item === undefined) return { ok: false, why: 'noSuchItem' }

  const sources: SessionPostureSources = { agents: () => ctx.get('agents') as never }
  const linked = relatedSessionIdsOf(card).map(fact => fact.sessionId)
  if (linked.length === 0) return { ok: false, why: 'taskHasNoSession' }

  let chosen = linked[0] as string
  for (const sessionId of linked) {
    if (sessionRunningOf(sources, sessionId).value === true) { chosen = sessionId; break }
  }

  const agents = ctx.get('agents') as { get(id: string): { followup(message: unknown): void } | undefined } | undefined
  const agent = agents?.get(chosen)
  if (agents === undefined || agent === undefined) return { ok: false, why: 'noLiveAgent' }

  const said = itemPrompt(item)
  const result = handOver(agent as never, said)
  return result.kind === 'success'
    ? { ok: true, sessionId: chosen, said }
    : { ok: false, why: result.text }
}

/** The one sentence the panel hands over, said in the reader's terms. */
function itemPrompt(item: ItemRecord): string {
  const where = item.taskId === undefined ? '（它还没有挂到任何看板卡片上）' : ''
  const steps = item.steps.length === 0
    ? ''
    : `\n它的步骤：${item.steps.map(step => `- [${step.done ? 'x' : ' '}] ${step.text}`).join('\n')}`
  return `任务清单里有一条「#${item.ref} ${item.title || '（无标题）'}」${where}。请处理它，并告诉我你打算怎么做。${steps}`
}

/**
 * Register the board route (prefix) and own the service lifecycle: open the
 * persistence unit through the platform storage hub, serve once initialized,
 * dispose the unit on unload.
 *
 * ONE service serves the prefix, and it holds BOTH documents — the board at
 * the root tail, the checklist at `/items`. The lease and the command relay
 * ride along because they arbitrate the unit (one engine drives every
 * document), not the board: their answers are carried on the board's view
 * because that is the tail every replica bootstraps from, not because they
 * belong to the board's document.
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
  const service = new DocumentService({ openUnit: storageHubOpener(() => ctx.get('storage')) })
  void service.ensureInit()
  const deps: BoardRouteDeps = {
    ready: () => service.ensureInit(),
    available: () => service.available,
    doc: () => service.getDoc(),
    commit: commit => service.commit(commit),
    itemsDoc: () => service.getItemsDoc(),
    commitItems: commit => service.commitItems(commit),
    acquireLease: (clientId, ttlMs, active) => service.acquireLease(clientId, ttlMs, active),
    releaseLease: clientId => service.releaseLease(clientId),
    noteActivity: clientId => service.noteActivity(clientId),
    noteStreamOpen: clientId => service.noteStreamOpen(clientId),
    noteDisconnect: clientId => service.noteDisconnect(clientId),
    submitCommand: command => service.submitCommand(command),
    ask: request => handOneItemToItsCardSession(ctx, service, request),
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
