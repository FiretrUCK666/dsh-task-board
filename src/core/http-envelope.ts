/**
 * The HTTP envelope this plugin's host routes answer with — the ONE wire
 * shape, shared by both halves.
 *
 * ── 为什么它在核心层 ────────────────────────────────────────────────────────
 *
 * 信封是**协议**，不是实现：host 写它，浏览器读它。两半都要认识它，所以它不能
 * 住在任何一半里——尤其不能住在 host 半区（浏览器 import host 是全仓唯一一处
 * 违例）。核心层是两边都能 import 的那一层，于是它住这里。
 *
 * 写它的那一支（`host/http-json.ts`）只管**怎么把一个信封写出去**；读它的那
 * 一支只管**怎么从一个信封里取值**。信封本身——键、形状、失败怎么表达——
 * 只有这一份。
 *
 * ── 形状 ────────────────────────────────────────────────────────────────────
 *
 *   成功：`{ ok: true, value: <这一条路由的答案> }`
 *   失败：`{ ok: false, error: { code, message } }`
 *
 * 两种都走 **HTTP 200**：失败是**业务上的拒绝**（参数不对、读不到、存不下），
 * 不是传输上的错误。一条前缀上的失败如果一会儿 200 一会儿 4xx，浏览器那一侧
 * 就得为每个端点各写一套分支——而「一个前缀一套分支」正是这套信封要消掉的事。
 * @module dsh-task-board/core/http-envelope
 */

/** Success envelope carrying a route's value. */
export interface RouteOk<T> {
  ok: true
  value: T
}

/** Failure envelope carrying a stable business error code. */
export interface RouteFail {
  ok: false
  error: { code: string; message: string }
}

/** Route envelope: ok carries a value, fail carries an error, both over HTTP 200. */
export type RouteEnvelope<T = unknown> = RouteOk<T> | RouteFail
