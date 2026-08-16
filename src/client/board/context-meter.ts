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
import type { ContextBreakdownShape, ContextPressureShape } from '../../core/controller.ts'

/** The three bar segments, in native order and with the native tint classes. */
export const CONTEXT_SEGMENTS = [
  { key: 'systemTokens', className: 'meterSystem', label: 'context.system' },
  { key: 'toolsTokens', className: 'meterTools', label: 'context.tools' },
  { key: 'messageTokens', className: 'meterMessages', label: 'context.messages' },
] as const

/** Occupancy result: percentage (0-100, rounded, clamped) + the raw figures. */
export interface ContextOccupancy {
  percent: number
  usedTokens: number
  contextWindow: number
}

/**
 * Approximate context occupancy, using the native rounding and upper clamp.
 * The numerator prefers `projectedTokens` (the provider sample carried
 * forward over surface movement — so compaction shows immediately) and falls
 * back to the bare sample; null until both the numerator and a route
 * capacity are known.
 */
export function contextOccupancy(
  pressure: ContextPressureShape | undefined,
): ContextOccupancy | undefined {
  const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens
  if (usedTokens === undefined || pressure?.contextWindow === undefined) return undefined
  return {
    percent: Math.min(100, Math.round((usedTokens / pressure.contextWindow) * 100)),
    usedTokens,
    contextWindow: pressure.contextWindow,
  }
}

/** One bar segment: which breakdown bucket it is and its share of the bar width (%). */
export interface ContextSegment {
  key: string
  /** The meter's tint class (native color), or undefined for the uncolored fallback bar. */
  className: string | undefined
  /** Percent of the bar width this segment occupies (> 0). */
  width: number
}

/**
 * Split the occupancy bar into colored segments by the breakdown composition,
 * or fall back to one uncolored full-width segment when the composition is
 * unknown or empty. Widths follow the native math: each bucket's share of
 * `percent` (the occupancy percentage), filtered to visible (> 0) parts —
 * which also drops any bucket that contributes no tokens.
 */
export function contextSegments(
  occupancy: ContextOccupancy,
  breakdown: ContextBreakdownShape | undefined,
): ContextSegment[] {
  const total = breakdown === undefined
    ? 0
    : breakdown.systemTokens + breakdown.toolsTokens + breakdown.messageTokens
  if (breakdown === undefined || total === 0) {
    return [{ key: 'total', className: undefined, width: occupancy.percent }]
  }
  return CONTEXT_SEGMENTS
    .map(segment => ({
      key: segment.key,
      className: segment.className,
      width: occupancy.percent * (breakdown[segment.key] / total),
    }))
    .filter(part => part.width > 0)
}

/**
 * Compact token count: `< 1000` as-is, then `K`/`M` with one decimal under
 * 100 (matching the native `formatTokens` exactly: `639K`, `1M`).
 */
export function formatTokens(n: number): string {
  const scaled = (v: number): string => v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10)
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`
  return `${scaled(n / 1_000_000)}M`
}