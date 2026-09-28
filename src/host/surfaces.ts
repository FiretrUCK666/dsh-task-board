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
 */

/** The surfaces a row can announce. The package row itself is not one. */
export type SurfaceId = 'board' | 'items' | 'agent'

/** Every surface id, so a caller cannot announce one this file does not know. */
export const SURFACE_IDS: readonly SurfaceId[] = ['board', 'items', 'agent']

/** Process-wide, because the host is one process and a row is loaded once. */
const active = new Set<SurfaceId>()

/**
 * Announce that a surface's row is loaded, which is the same fact as "its
 * switch is on".
 *
 * Called from the row's own module body, so it runs exactly when — and only
 * when — the loader evaluated that row.
 * @param id - the surface this row owns.
 */
export function markSurfaceActive(id: SurfaceId): void {
  active.add(id)
}

/**
 * Which surfaces are on, read fresh at request time rather than cached at load
 * time: a row may be evaluated after this module is.
 * @returns the active surface ids.
 */
export function activeSurfaces(): readonly SurfaceId[] {
  return SURFACE_IDS.filter(id => active.has(id))
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
export function surfaceManifest(): { board: boolean; items: boolean; agent: boolean } {
  return {
    board: active.has('board'),
    items: active.has('items'),
    agent: active.has('agent'),
  }
}
