/**
 * Compact cruise-time formatting (format-time.ts, see there for the why) and
 * the two picker helpers. All functions are locale-aware (zh first, else
 * English via the document language) and take an injectable `now`, so the
 * same-day / same-year / cross-year verdicts are deterministic here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatCruiseTime, nextWholeHour, toDatetimeLocal } from '../src/client/board/format-time.ts'

function useLanguage(lang: string): void {
  vi.stubGlobal('document', { documentElement: { lang } })
}

afterEach(() => { vi.unstubAllGlobals() })

// 2025-01-05 14:23 local — the "now" every relative case is judged against.
const NOW = new Date(2025, 0, 5, 14, 23, 0).getTime()

describe('formatCruiseTime', () => {
  it('same day collapses to the clock', () => {
    useLanguage('zh')
    expect(formatCruiseTime(new Date(2025, 0, 5, 9, 5).getTime(), NOW)).toBe('09:05')
  })

  it('same year shows month/day with the clock (zh)', () => {
    useLanguage('zh')
    expect(formatCruiseTime(new Date(2025, 0, 8, 18, 30).getTime(), NOW)).toBe('1月8日 18:30')
  })

  it('cross-year includes the year (zh)', () => {
    useLanguage('zh')
    expect(formatCruiseTime(new Date(2026, 0, 2, 9, 0).getTime(), NOW)).toBe('2026年1月2日 09:00')
  })

  it('english mirror (M/D, year prefixed cross-year)', () => {
    useLanguage('en')
    expect(formatCruiseTime(new Date(2025, 0, 5, 9, 5).getTime(), NOW)).toBe('09:05')
    expect(formatCruiseTime(new Date(2025, 0, 8, 18, 30).getTime(), NOW)).toBe('1/8 18:30')
    expect(formatCruiseTime(new Date(2026, 0, 2, 9, 0).getTime(), NOW)).toBe('2026/1/2 09:00')
  })

  it('zero-pads the clock digits', () => {
    useLanguage('zh')
    expect(formatCruiseTime(new Date(2025, 0, 5, 9, 5).getTime(), NOW)).toBe('09:05')
    expect(formatCruiseTime(new Date(2025, 0, 5, 23, 59).getTime(), NOW)).toBe('23:59')
  })
})

describe('nextWholeHour', () => {
  it('rounds any minute up to the next hour tick', () => {
    expect(nextWholeHour(new Date(2025, 0, 5, 14, 23).getTime()))
      .toBe(new Date(2025, 0, 5, 15, 0).getTime())
  })

  it('advances a whole-hour instant to the NEXT hour', () => {
    expect(nextWholeHour(new Date(2025, 0, 5, 14, 0).getTime()))
      .toBe(new Date(2025, 0, 5, 15, 0).getTime())
  })
})

describe('toDatetimeLocal', () => {
  it('formats as YYYY-MM-DDTHH:mm (the picker granularity)', () => {
    expect(toDatetimeLocal(new Date(2025, 0, 5, 9, 5).getTime())).toBe('2025-01-05T09:05')
    expect(toDatetimeLocal(new Date(2025, 11, 31, 23, 59).getTime())).toBe('2025-12-31T23:59')
  })
})
