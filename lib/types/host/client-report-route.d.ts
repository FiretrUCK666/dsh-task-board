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
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
/** One box as the page measured it (CSS pixels, viewport-relative). */
export interface ReportedBox {
    /** Top edge in CSS px. */
    top: number;
    /** Bottom edge in CSS px. */
    bottom: number;
    /** Height in CSS px. */
    height: number;
}
/** One page's self-report (all fields best-effort). */
export interface ClientReport {
    /** The bundle version baked into the reporting page. */
    version: string;
    /** The page URL the report came from. */
    href: string;
    /** The browser's user agent. */
    ua?: string;
    /** Viewport size in CSS px. */
    viewport?: {
        width: number;
        height: number;
    };
    /** Device pixel ratio. */
    dpr?: number;
    /** The landmark boxes (absent when the board was not mounted yet). */
    boxes?: Record<string, ReportedBox>;
    /** Server-side receipt instant (ms). */
    receivedAt: number;
}
/** Read the retained reports, newest first (a copy — callers never mutate). */
export declare function readClientReports(): ClientReport[];
/** Drop everything (test seam). */
export declare function clearClientReports(): void;
/**
 * Normalize one posted body into a report. Anything unreadable is dropped
 * (the route answers 200 with `stored:false` rather than erroring — a
 * diagnostic must never become a failure surface).
 * @param body - the parsed JSON body.
 * @param now - the receipt instant.
 * @returns the report, or undefined when the body carries no usable version.
 */
export declare function normalizeClientReport(body: unknown, now: number): ClientReport | undefined;
/** Remember one report, newest first, bounded. */
export declare function recordClientReport(report: ClientReport): void;
/**
 * Build the pure report-route processor (unit-testable without a server).
 * @param now - clock seam.
 * @returns the HTTP handler for POST on the client-report route.
 */
export declare function createClientReportHandler(now?: () => number): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
/**
 * Register the client-report route on the host web server.
 * @param ctx - context carrying the webServer service.
 * @param ns - the plugin namespace (route path prefix).
 * @returns the route disposer, or a no-op when the web server is absent.
 */
export declare function registerClientReportRoute(ctx: Context, ns: string): () => void;
