/**
 * Context-meter tests: the review page's occupancy math — native-compatible
 * percentage, segment split, and compact token formatting (see
 * context-meter.ts). Pure arithmetic, so it tests in isolation.
 */
import { describe, expect, it } from 'vitest'
import { contextOccupancy, contextSegments, formatTokens } from '../src/client/board/context-meter.ts'

describe('contextOccupancy', () => {
  it('computes the native percentage (rounded, clamped at 100)', () => {
    expect(contextOccupancy({ projectedTokens: 639_000, contextWindow: 1_000_000 }))
      .toEqual({ percent: 64, usedTokens: 639_000, contextWindow: 1_000_000 })
    expect(contextOccupancy({ projectedTokens: 2_000_000, contextWindow: 1_000_000 })?.percent).toBe(100)
    expect(contextOccupancy({ projectedTokens: 0, contextWindow: 1_000_000 })?.percent).toBe(0)
  })

  it('prefers projectedTokens and falls back to the bare provider sample', () => {
    expect(contextOccupancy({ pressureTokens: 100, contextWindow: 1_000 })?.usedTokens).toBe(100)
    expect(contextOccupancy({ pressureTokens: 100, projectedTokens: 250, contextWindow: 1_000 })?.usedTokens).toBe(250)
  })

  it('returns undefined until both a numerator and a capacity are known', () => {
    expect(contextOccupancy(undefined)).toBeUndefined()
    expect(contextOccupancy({})).toBeUndefined()
    expect(contextOccupancy({ pressureTokens: 100 })).toBeUndefined()
    expect(contextOccupancy({ contextWindow: 1_000 })).toBeUndefined()
  })
})

describe('contextSegments', () => {
  const occupancy = { percent: 50, usedTokens: 500, contextWindow: 1_000 }

  it('falls back to one uncolored full-width segment without a breakdown', () => {
    expect(contextSegments(occupancy, undefined)).toEqual([{ key: 'total', className: undefined, width: 50 }])
  })

  it('splits the bar into colored segments by the breakdown composition', () => {
    const segments = contextSegments(occupancy, { systemTokens: 100, toolsTokens: 200, messageTokens: 300 })
    expect(segments).toEqual([
      { key: 'systemTokens', className: 'meterSystem', width: 50 * (100 / 600) },
      { key: 'toolsTokens', className: 'meterTools', width: 50 * (200 / 600) },
      { key: 'messageTokens', className: 'meterMessages', width: 50 * (300 / 600) },
    ])
  })

  it('drops buckets that contribute no tokens (including an all-empty breakdown)', () => {
    const segments = contextSegments(occupancy, { systemTokens: 0, toolsTokens: 0, messageTokens: 100 })
    expect(segments).toEqual([{ key: 'messageTokens', className: 'meterMessages', width: 50 }])
    expect(contextSegments(occupancy, { systemTokens: 0, toolsTokens: 0, messageTokens: 0 }))
      .toEqual([{ key: 'total', className: undefined, width: 50 }])
  })
})

describe('formatTokens', () => {
  it('matches the native compact formatting (K/M with one decimal under 100)', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(999)).toBe('999')
    expect(formatTokens(1_000)).toBe('1K')
    expect(formatTokens(4_600)).toBe('4.6K')
    expect(formatTokens(16_800)).toBe('16.8K')
    expect(formatTokens(99_999)).toBe('100K')
    expect(formatTokens(465_000)).toBe('465K')
    expect(formatTokens(1_000_000)).toBe('1M')
    expect(formatTokens(2_500_000)).toBe('2.5M')
  })
})