/**
 * Which surfaces this plugin owns — THE list, in one place.
 *
 * ── 为什么它在核心层 ────────────────────────────────────────────────────────
 *
 * 名单是**协议的一半**：host 宣告「哪一行被装载了」，浏览器读这份名单来决定
 * 「要不要收窄」。两半都要认识同一份名单，而它不能住在任何一半里——尤其不能
 * 住在 host 半区（浏览器 import host 是全仓唯一一处违例）。核心层是两边都能
 * import 的那一层，于是名单住这里。
 *
 * ── 为什么它是**派生**的，而不是抄两份 ─────────────────────────────────────
 *
 * 名单曾经有两份：host 半区五个（`home` / `board` / `items` / `agent` /
 * `design`），浏览器半区四个（少了 `'agent'`）。两份不会报错——浏览器那一侧
 * 少一个键，只是**永远收窄不到那一面**，而屏上没有任何东西解释为什么。
 *
 * 所以这里给的是**一份**名单，`SurfaceId` 从它派生，host 的清单也从它派生：
 * 加一个表面，两半一起知道。
 * @module dsh-task-board/core/surfaces
 */

/**
 * Every surface id, in one place — so a caller cannot announce one this
 * plugin does not have, and so the browser half reads the SAME list.
 */
export const SURFACE_IDS = ['home', 'board', 'items', 'agent', 'design'] as const

/** The surfaces a row can announce. The package row itself is not one. */
export type SurfaceId = typeof SURFACE_IDS[number]

/** The whole set, in the shape the browser reads: one flag per surface. */
export type SurfaceManifest = { readonly [K in SurfaceId]: boolean }
