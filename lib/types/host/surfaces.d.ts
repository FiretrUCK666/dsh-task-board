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
import { type SurfaceId, type SurfaceManifest } from '../core/surfaces.ts';
/**
 * Announce that a surface's row is loaded, which is the same fact as "its
 * switch is on".
 *
 * Called from the row's own module body, so it runs exactly when — and only
 * when — the loader evaluated that row.
 * @param id - the surface this row owns.
 */
export declare function markSurfaceActive(id: SurfaceId): void;
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
export declare function surfaceManifest(): SurfaceManifest;
