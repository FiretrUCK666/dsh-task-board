//#region src/host/surfaces.ts
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
* @returns which surfaces the host says are on.
*/
function surfaceManifest() {
	return {
		board: active.has("board"),
		items: active.has("items"),
		agent: active.has("agent")
	};
}
//#endregion
export { surfaceManifest as n, markSurfaceActive as t };
