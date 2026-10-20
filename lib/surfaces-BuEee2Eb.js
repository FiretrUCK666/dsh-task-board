//#region src/core/surfaces.ts
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
const SURFACE_IDS = [
	"home",
	"board",
	"items",
	"agent",
	"design"
];
//#endregion
//#region src/host/surfaces.ts
/**
* Which surfaces the plugin's own rows are switched on for.
*
* WHY THIS EXISTS. The plugin page lists one row per `insert:` entry, and
* turning a row off stops the loader from evaluating that row's module at all.
* That is the whole mechanism — there is no runtime check anywhere, so nothing
* can be "forgotten to check".
*
* A plugin package ships exactly ONE browser artifact (the module table keys it
* by package name), so the two panels cannot each be a row of their own. What
* CAN be a row is a host-side module, and a host-side module is free to do
* nothing but say "I am switched on". So each surface we want a switch for owns
* a row whose whole job is to announce itself here, and the browser asks this
* list once before registering anything.
*
* THE DIRECTION OF THE ANSWER MATTERS: the browser treats a failed or missing
* read as "no narrowing" and registers everything. A surface that is switched
* off must therefore never be reported as on, and a surface the host cannot
* answer for must never be reported as off — the failure has to leave the
* reader with what it would have done anyway.
*
* THE LIST ITSELF lives in `core/surfaces.ts`: the browser half reads the same
* list, so it cannot live in the host half. This module is only the host's
* side of it — which rows announced themselves.
*/
/** Process-wide, because the host is one process and a row is loaded once. */
const active = /* @__PURE__ */ new Set();
/**
* Announce that a surface's row is loaded, which is the same fact as "its
* switch is on".
*
* Called from the row's own module body, so it runs exactly when — and only
* when — the loader evaluated that row.
* @param id - the surface this row owns.
*/
function markSurfaceActive(id) {
	active.add(id);
}
/**
* The whole set, in the shape the browser reads.
*
* Absent rather than `false`, so "the host could not answer" and "the host
* answered no" stay different values — a reader that gets `undefined` for
* everything must narrow nothing, while one that gets `false` must not
* register that surface.
*
* DERIVED from {@link SURFACE_IDS}: every surface id is answered, so a surface
* added to the list cannot be missing here — a missing key would read as
* 「读不到」 on the browser side and silently narrow that surface away.
* @returns which surfaces the host says are on.
*/
function surfaceManifest() {
	const out = {};
	for (const id of SURFACE_IDS) out[id] = active.has(id);
	return out;
}
//#endregion
export { surfaceManifest as n, markSurfaceActive as t };
