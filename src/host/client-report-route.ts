/**
 * Live-layout reporting route: the running page tells the host what it is and
 * how it actually laid out.
 *
 * Why this exists. Everything about "the board looks wrong on my phone" used to
 * be argued from compressed screenshots: the served bundle, the page's own
 * version, and the computed geometry were all invisible from the host side, so
 * a stale page and a wrong rule looked exactly alike. This route closes that
 * gap: the browser half posts one small JSON report (its bundle version, the
 * user agent, the viewport, and the boxes of the landmarks that matter), the
 * host keeps the last few in memory, and the update route hands them back. The
 * report is diagnostic only — nothing in the board reads it, and a failed post
 * is silent.
 *
 * POST /api/<ns>/client-report  {version, href, ua?, viewport?, dpr?, boxes?}
 * GET  /api/<ns>/update         → …value.clients = [report, …] (newest first)
 * @module dsh-task-board/host/client-report-route
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** One box as the page measured it (CSS pixels, viewport-relative). */
export interface ReportedBox {
  /** Top edge in CSS px. */
  top: number
  /** Bottom edge in CSS px. */
  bottom: number
  /** Height in CSS px. */
  height: number
}

/** One page's self-report (all fields best-effort). */
export interface ClientReport {
  /** The bundle version baked into the reporting page. */
  version: string
  /** The page URL the report came from. */
  href: string
  /** The browser's user agent. */
  ua?: string
  /** Viewport size in CSS px. */
  viewport?: { width: number; height: number }
  /** Device pixel ratio. */
  dpr?: number
  /** The landmark boxes (absent when the board was not mounted yet). */
  boxes?: Record<string, ReportedBox>
  /** Server-side receipt instant (ms). */
  receivedAt: number
}

/** Keep the last N reports: enough for phone + desktop, bounded forever. */
const MAX_REPORTS = 8

/** The in-memory ring (process-local, diagnostic only — never persisted). */
const reports: ClientReport[] = []

/** Read the retained reports, newest first (a copy — callers never mutate). */
export function readClientReports(): ClientReport[] {
  return reports.map(report => ({ ...report }))
}

/** Drop everything (test seam). */
export function clearClientReports(): void {
  reports.length = 0
}

/** Shape-guard one box: finite, ordered numbers only. */
function boxOf(value: unknown): ReportedBox | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const raw = value as Record<string, unknown>
  const { top, bottom, height } = raw
  if (typeof top !== 'number' || typeof bottom !== 'number' || typeof height !== 'number') return undefined
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || !Number.isFinite(height)) return undefined
  return { top: Math.round(top * 10) / 10, bottom: Math.round(bottom * 10) / 10, height: Math.round(height * 10) / 10 }
}

/**
 * Normalize one posted body into a report. Anything unreadable is dropped
 * (the route answers 200 with `stored:false` rather than erroring — a
 * diagnostic must never become a failure surface).
 * @param body - the parsed JSON body.
 * @param now - the receipt instant.
 * @returns the report, or undefined when the body carries no usable version.
 */
export function normalizeClientReport(body: unknown, now: number): ClientReport | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const raw = body as Record<string, unknown>
  if (typeof raw.version !== 'string' || raw.version === '') return undefined
  const boxes: Record<string, ReportedBox> = {}
  if (typeof raw.boxes === 'object' && raw.boxes !== null) {
    for (const [key, value] of Object.entries(raw.boxes as Record<string, unknown>)) {
      const box = boxOf(value)
      if (box !== undefined) boxes[key] = box
    }
  }
  const viewport = (() => {
    const v = raw.viewport as Record<string, unknown> | undefined
    if (v === undefined || typeof v.width !== 'number' || typeof v.height !== 'number') return undefined
    if (!Number.isFinite(v.width) || !Number.isFinite(v.height)) return undefined
    return { width: Math.round(v.width), height: Math.round(v.height) }
  })()
  return {
    version: raw.version,
    href: typeof raw.href === 'string' ? raw.href.slice(0, 300) : '',
    ...typeof raw.ua === 'string' ? { ua: raw.ua.slice(0, 300) } : {},
    ...viewport !== undefined ? { viewport } : {},
    ...typeof raw.dpr === 'number' && Number.isFinite(raw.dpr) ? { dpr: Math.round(raw.dpr * 100) / 100 } : {},
    ...Object.keys(boxes).length > 0 ? { boxes } : {},
    receivedAt: now,
  }
}

/** Remember one report, newest first, bounded. */
export function recordClientReport(report: ClientReport): void {
  reports.unshift(report)
  if (reports.length > MAX_REPORTS) reports.length = MAX_REPORTS
}

/** Write one JSON envelope (same discipline as every other host route). */
function json(res: ServerResponse, payload: unknown, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

/** Read a bounded request body as text (a diagnostic never eats the socket). */
function readBody(req: IncomingMessage, limitBytes = 32 * 1024): Promise<string> {
  return new Promise(resolve => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limitBytes) {
        resolve('')
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => { resolve(Buffer.concat(chunks).toString('utf8')) })
    req.on('error', () => { resolve('') })
  })
}

/**
 * Build the pure report-route processor (unit-testable without a server).
 * @param now - clock seam.
 * @returns the HTTP handler for POST on the client-report route.
 */
export function createClientReportHandler(
  now: () => number = Date.now,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res): Promise<void> => {
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end()
      return
    }
    const text = await readBody(req)
    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      json(res, { ok: true, value: { stored: false } })
      return
    }
    const report = normalizeClientReport(body, now())
    if (report === undefined) {
      json(res, { ok: true, value: { stored: false } })
      return
    }
    recordClientReport(report)
    json(res, { ok: true, value: { stored: true } })
  }
}

/**
 * Register the client-report route on the host web server.
 * @param ctx - context carrying the webServer service.
 * @param ns - the plugin namespace (route path prefix).
 * @returns the route disposer, or a no-op when the web server is absent.
 */
export function registerClientReportRoute(ctx: Context, ns: string): () => void {
  const webServer = ctx.get('webServer') as { register(options: unknown): () => void } | undefined
  if (webServer === undefined) return () => undefined
  return webServer.register({ kind: 'exact', path: `/api/${ns}/client-report`, handler: createClientReportHandler() })
}
