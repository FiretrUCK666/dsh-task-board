/** The answer's shape, exactly as the host spells it. */
export interface SurfaceManifest {
    readonly home: boolean;
    readonly board: boolean;
    readonly items: boolean;
    readonly agent: boolean;
    readonly design: boolean;
}
/** Which surface a registration is asking about. */
export type SurfaceName = 'home' | 'board' | 'items' | 'design';
/**
 * Ask the host which surfaces are on.
 *
 * Resolves to `undefined` for EVERY failure — network, non-200, malformed JSON,
 * a shape that is not three booleans, or a timeout. There is no "partially
 * known" answer, because a half-answer would make some surfaces vanish and
 * others not, which is the one outcome a reader cannot act on.
 * @param fetchImpl - injected for tests.
 * @returns the manifest, or `undefined` when it could not be read.
 */
export declare function readSurfaceManifest(fetchImpl?: typeof fetch): Promise<SurfaceManifest | undefined>;
/**
 * Should this surface be registered?
 *
 * THE FALLBACK IS PER-SURFACE, and that is the whole reason it is a parameter.
 * A manifest that cannot be read means "the host said nothing", and the
 * product panels must register anyway — a broken switch must leave the plugin
 * exactly as it was before anyone thought about switches. The gallery is the
 * opposite case: it is a developer instrument, so an unreadable manifest must
 * leave it ABSENT rather than put a design catalogue in front of a user whose
 * host is simply unreachable. One default cannot serve both directions.
 *
 * @param name - the surface asking.
 * @param manifest - what the host said, or `undefined` if it said nothing.
 * @param whenUnknown - what an unreadable manifest means for this surface.
 * @returns whether to register it.
 */
export declare function surfaceEnabled(name: SurfaceName, manifest: SurfaceManifest | undefined, whenUnknown?: boolean): boolean;
