/**
 * Review-page context meter: the occupancy/breakdown math behind the
 * "上下文已用 X% · ~N / M" strip, mirroring the native harness ContextMeter
 * exactly (same numerator, same clamp, same segment split, same compact
 * token formatting) so the board's figure never drifts from the native one.
 *
 * Inputs are the `contextPressure` / `contextBreakdown` projections the
 * history tail page carries; every function is pure and framework-free so
 * the arithmetic unit-tests in isolation.
 */
import type { ContextBreakdownShape, ContextPressureShape } from '../../core/controller.ts';
/** Occupancy result: percentage (0-100, rounded, clamped) + the raw figures. */
interface ContextOccupancy {
    percent: number;
    usedTokens: number;
    contextWindow: number;
}
/**
 * Approximate context occupancy, using the native rounding and upper clamp.
 * The numerator prefers `projectedTokens` (the provider sample carried
 * forward over surface movement — so compaction shows immediately) and falls
 * back to the bare sample; null until both the numerator and a route
 * capacity are known.
 */
export declare function contextOccupancy(pressure: ContextPressureShape | undefined): ContextOccupancy | undefined;
/** One bar segment: which breakdown bucket it is and its share of the bar width (%). */
interface ContextSegment {
    key: string;
    /** The meter's tint class (a literal of the CSS module's meter classes), or
     *  undefined for the uncolored fallback bar. Typed as a literal union so
     *  the renderer needs no `as keyof typeof css` cast and a rename fails
     *  loudly. */
    className: 'meterSystem' | 'meterTools' | 'meterMessages' | undefined;
    /** Percent of the bar width this segment occupies (> 0). */
    width: number;
}
/**
 * Split the occupancy bar into colored segments by the breakdown composition,
 * or fall back to one uncolored full-width segment when the composition is
 * unknown or empty. Widths follow the native math: each bucket's share of
 * `percent` (the occupancy percentage), filtered to visible (> 0) parts —
 * which also drops any bucket that contributes no tokens.
 */
export declare function contextSegments(occupancy: ContextOccupancy, breakdown: ContextBreakdownShape | undefined): ContextSegment[];
/**
 * Compact token count: `< 1000` as-is, then `K`/`M` with one decimal under
 * 100 (matching the native `formatTokens` exactly: `639K`, `1M`).
 */
export declare function formatTokens(n: number): string;
/**
 * Decode rate (native TPS): tokens per second, rounded to a whole number.
 * Returns the FIGURE only — the `tok/s` unit rides the locale key, like every
 * other usage fragment (`formatTokens` never carries its own label either).
 * A non-positive window means "no measurable decode yet": undefined, so the
 * whole fragment hides instead of printing `0 tok/s` (same grammar as the
 * `(llmMs > 0 || toolMs > 0)` time-line gate in the panel).
 */
export declare function formatTps(decodeTokens: number, decodeMs: number): string | undefined;
/**
 * Prompt-cache hit rate: cached reads over all input (`cacheRead /
 * (uncached + cacheRead)`), rounded to a whole percent — the native "缓存命中"
 * figure. Returns the FIGURE only (`%` rides the locale key). A zero
 * denominator means "no input measured yet": undefined, never NaN.
 */
export declare function cacheHitRate(cacheReadTokens: number, uncachedInputTokens: number): string | undefined;
export {};
