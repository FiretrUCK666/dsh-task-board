/**
 * The live-layout self-report — the wire shape of what a page says about
 * itself.
 *
 * ── 为什么它在核心层 ────────────────────────────────────────────────────────
 *
 * 报告是**协议**：浏览器量好之后 POST 上来，host 存着、在更新那一页回给读者。
 * 两半都要认识它的形状——浏览器要按这个形状写，host 要按这个形状读——所以它
 * 不能住在任何一半里。核心层是两边都能 import 的那一层，于是它住这里。
 *
 * 这一份只说**形状**。谁量、谁存、存几份，各归各家（浏览器那边是
 * `client/client-report.ts`，host 那边是 `host/client-report-route.ts`）。
 * @module dsh-task-board/core/client-report
 */

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
