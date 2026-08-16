/**
 * Settings route layer for the task-board plugin: the minimal HTTP surface
 * that exposes one registered settings namespace to the browser half through
 * the host web server. The route handler is split from the pure processing
 * function (`createSettingsHandler`) so the response logic is unit-testable
 * without a live server.
 *
 * GET  /api/<ns>/settings  → one namespace's current view, or available:false.
 * POST /api/<ns>/settings  → body {ops, expectedRevision?} applies path edits
 *                            and returns the fresh view; business errors land
 *                            in the {ok:false, error} envelope (HTTP 200).
 * @module dsh-task-board/host/settings-route
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsDescriptor, SettingsProvider } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** One settings namespace's JSON view, as the client scope snapshots it. */
export interface SettingsRouteView {
  /** False when the host serves no settings service or the namespace is unregistered. */
  available: boolean
  /** Schema-resolved section value. */
  value?: unknown
  /** Composition `base` layer, when the namespace registered one. */
  base?: unknown
  /** Raw user section, when one exists and is well-formed. */
  user?: unknown
  /** Whether the host document accepts writes. */
  writable?: boolean
  /** Namespace revision fencing the next write. */
  revision?: number
}

/** One path edit the POST handler applies. */
export type SettingsRouteOp =
  | { op: 'set'; path: string[]; value?: unknown }
  | { op: 'unset'; path: string[]; value?: never }

/** Success envelope carrying a namespace view. */
export interface RouteOk {
  ok: true
  value: SettingsRouteView
}

/** Failure envelope carrying a stable business error code. */
export interface RouteFail {
  ok: false
  error: { code: string; message: string }
}

/** Route envelope: ok carries a view, fail carries an error, both over HTTP 200. */
export type RouteEnvelope = RouteOk | RouteFail

/** Structural request failure (never a settings fault). */
const BAD_REQUEST: RouteFail = { ok: false, error: { code: 'internal', message: 'malformed request' } }

/**
 * Read a JSON request body into an unknown value; null when unparseable.
 * @param req - the incoming request stream.
 * @returns the parsed body, or null.
 */
export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    chunks.push(buffer)
    total += buffer.length
    if (total > 1 << 20) return null
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text === '') return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

/** Write one JSON envelope response. */
export function json(res: ServerResponse, envelope: RouteEnvelope, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(envelope))
}

/**
 * The service face the settings route needs: describe namespaces and apply
 * path edits. Supplied by the real host settings service at registration; a
 * fake in tests.
 */
export interface SettingsRouteDeps {
  /** Describe every registered namespace (empty when no settings service). */
  describe(): SettingsDescriptor[]
  /** Apply path edits to one namespace and settle after the commit. */
  mutate(ns: string, ops: unknown[], expectedRevision?: number): Promise<unknown>
  /** Whether the host settings document accepts writes. */
  writable: boolean
}

/** Extract the namespace view from a registered descriptor. */
function viewFromDescriptor(descriptor: SettingsDescriptor, writable: boolean): SettingsRouteView {
  return {
    available: true,
    value: descriptor.value,
    base: descriptor.base,
    user: descriptor.user,
    writable,
    revision: descriptor.revision,
  }
}

/**
 * Build the pure settings-route processor. The returned handler translates an
 * HTTP request into a settings envelope without touching the server.
 * @param deps - the describe/mutate service face.
 * @param ns - the settings namespace this route serves.
 * @returns an HTTP handler for GET and POST on the namespace route.
 */
export function createSettingsHandler(
  deps: SettingsRouteDeps,
  ns: string,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const describeNs = (): SettingsDescriptor | undefined =>
    deps.describe().find(descriptor => descriptor.ns === ns)

  return async (req, res): Promise<void> => {
    if (req.method === 'GET') {
      const descriptor = describeNs()
      const view = descriptor === undefined ? { available: false } : viewFromDescriptor(descriptor, deps.writable)
      json(res, { ok: true as const, value: view })
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    // Require an explicit JSON content-type: cross-site simple requests (no
    // preflight) cannot set application/json, so this blocks form-based CSRF.
    const contentType = req.headers['content-type'] ?? ''
    if (!contentType.toLowerCase().startsWith('application/json')) {
      json(res, BAD_REQUEST, 415)
      return
    }
    const payload = await readJsonBody(req)
    if (payload === null || typeof payload !== 'object') {
      json(res, BAD_REQUEST)
      return
    }
    const body = payload as Record<string, unknown>
    if (!Array.isArray(body.ops)) {
      json(res, BAD_REQUEST)
      return
    }
    const expectedRevision = typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined
    try {
      await deps.mutate(ns, body.ops, expectedRevision)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      json(res, { ok: false as const, error: { code: 'settings', message } })
      return
    }
    // Re-describe for the fresh view, exactly like a GET.
    const descriptor = describeNs()
    json(res, { ok: true as const, value: descriptor === undefined ? { available: false } : viewFromDescriptor(descriptor, deps.writable) })
  }
}

/**
 * Register the settings route for one namespace on the host web server, wiring
 * the real host settings service into the pure handler.
 * @param ctx - context carrying the webServer and settings services.
 * @param ns - the settings namespace this route serves.
 * @returns the route disposer, or a no-op when either service is absent.
 */
export function registerSettingsRoute(ctx: Context, ns: string): () => void {
  // ctx.get() reads the service store directly (no inject-declaration
  // requirement); the host half still declares 'settings' in its inject list
  // so the fiber waits for the provider before activating. Either guard alone
  // is enough, both together make the route robust to future refactors.
  const webServer = ctx.get('webServer') as { register(options: unknown): () => void } | undefined
  const settings = ctx.get('settings') as SettingsProvider | undefined
  if (webServer === undefined || settings === undefined) return () => undefined
  const deps: SettingsRouteDeps = {
    describe: () => settings.describe({ redactSecrets: true }),
    mutate: (target, ops, expectedRevision) => settings.mutate(target as never, ops as never, expectedRevision),
    writable: settings.writable,
  }
  const handler = createSettingsHandler(deps, ns)
  return webServer.register({ kind: 'exact', path: `/api/${ns}/settings`, handler })
}
