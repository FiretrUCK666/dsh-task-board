/** The answer's shape, exactly as the host spells it. */
export interface SurfaceManifest {
    readonly board: boolean;
    readonly items: boolean;
    readonly agent: boolean;
}
/** Which surface a registration is asking about. */
export type SurfaceName = 'board' | 'items';
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
 * @param name - the surface asking.
 * @param manifest - what the host said, or `undefined` if it said nothing.
 * @returns whether to register it. `undefined` means YES.
 */
export declare function surfaceEnabled(name: SurfaceName, manifest: SurfaceManifest | undefined): boolean;
