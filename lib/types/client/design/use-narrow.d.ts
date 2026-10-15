/**
 * Is the surface identified by `selector` (the nearest ancestor matching it,
 * counted from `from`) narrower than `maxPx`? `from` may be a ref or a CSS
 * class token used as a selector. Falls back to the viewport proxy until the
 * first measurement lands (one frame), so a default never flashes the wrong
 * shape on mount.
 */
export declare function useSurfaceNarrow(selector: string, maxPx: number, viewportFallback?: number): [boolean, {
    current: HTMLDivElement | null;
}];
