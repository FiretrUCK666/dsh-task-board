/**
 * Compact cruise-time formatting (format-time.ts, see there for the why) and
 * the cross-midnight display rule. All functions are locale-aware (zh first,
 * else English via the document language) and take an injectable `now`, so
 * the same-day / same-year / cross-year verdicts are deterministic here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cruiseWindowLabelOf, formatCruiseTime, isNextDay } from '../src/client/board/format-time.ts'

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

describe('isNextDay (cross-midnight display rule)', () => {
  it('is true only for the calendar day after', () => {
    const start = new Date(2025, 0, 5, 22, 0).getTime()
    expect(isNextDay(start, new Date(2025, 0, 6, 2, 0).getTime())).toBe(true)
    expect(isNextDay(start, new Date(2025, 0, 5, 23, 59).getTime())).toBe(false)
    expect(isNextDay(start, new Date(2025, 0, 5, 22, 0).getTime())).toBe(false)
    expect(isNextDay(start, new Date(2025, 0, 4, 22, 0).getTime())).toBe(false)
    // Same instant / earlier instants are never "next day".
    expect(isNextDay(start, start)).toBe(false)
  })

  it('crosses year boundaries', () => {
    expect(isNextDay(new Date(2025, 11, 31, 23, 0).getTime(), new Date(2026, 0, 1, 1, 0).getTime())).toBe(true)
  })
})

describe('cruiseWindowLabelOf (one grammar line per window, both languages)', () => {
  it('range: same-day start → end (zh / en)', () => {
    useLanguage('zh')
    expect(cruiseWindowLabelOf({ startAt: new Date(2025, 0, 5, 22, 0).getTime(), endAt: new Date(2025, 0, 5, 23, 30).getTime() }, NOW)).toBe('22:00 → 23:30')
    useLanguage('en')
    expect(cruiseWindowLabelOf({ startAt: new Date(2025, 0, 5, 22, 0).getTime(), endAt: new Date(2025, 0, 5, 23, 30).getTime() }, NOW)).toBe('22:00 → 23:30')
  })

  it('range: a cross-midnight end reads 次日 / next day', () => {
    useLanguage('zh')
    expect(cruiseWindowLabelOf({ startAt: new Date(2025, 0, 5, 22, 0).getTime(), endAt: new Date(2025, 0, 6, 2, 0).getTime() }, NOW)).toBe('22:00 → 次日 02:00')
    useLanguage('en')
    expect(cruiseWindowLabelOf({ startAt: new Date(2025, 0, 5, 22, 0).getTime(), endAt: new Date(2025, 0, 6, 2, 0).getTime() }, NOW)).toBe('22:00 → next day 02:00')
  })

  it('start-only: 到点开、之后保持开启 / turns on and stays on', () => {
    useLanguage('zh')
    expect(cruiseWindowLabelOf({ startAt: new Date(2025, 0, 6, 9, 0).getTime() }, NOW)).toBe('1月6日 09:00 起保持开启')
    useLanguage('en')
    expect(cruiseWindowLabelOf({ startAt: new Date(2025, 0, 6, 9, 0).getTime() }, NOW)).toBe('From 1/6 09:00, stays on')
  })

  it('end-only: 已开启一直到点关 / on now until the end (no extra active marker)', () => {
    useLanguage('zh')
    expect(cruiseWindowLabelOf({ endAt: new Date(2025, 0, 5, 18, 0).getTime() }, NOW)).toBe('已开启 · 至 18:00')
    useLanguage('en')
    expect(cruiseWindowLabelOf({ endAt: new Date(2025, 0, 5, 18, 0).getTime() }, NOW)).toBe('On now · until 18:00')
  })

  it('a LIVE range leads with 生效中 / active; a future one does not', () => {
    useLanguage('zh')
    expect(cruiseWindowLabelOf({ startAt: new Date(2025, 0, 5, 10, 0).getTime(), endAt: new Date(2025, 0, 5, 16, 0).getTime() }, NOW)).toBe('生效中 · 10:00 → 16:00')
    expect(cruiseWindowLabelOf({ startAt: new Date(2025, 0, 8, 22, 0).getTime(), endAt: new Date(2025, 0, 9, 2, 0).getTime() }, NOW)).toBe('1月8日 22:00 → 次日 02:00')
    useLanguage('en')
    expect(cruiseWindowLabelOf({ startAt: new Date(2025, 0, 5, 10, 0).getTime(), endAt: new Date(2025, 0, 5, 16, 0).getTime() }, NOW)).toBe('active · 10:00 → 16:00')
  })

  it('an end more than one day later shows its REAL date — never 次日 (the 33-days bug)', () => {
    useLanguage('zh')
    expect(cruiseWindowLabelOf({ startAt: new Date(2025, 7, 23, 15, 25).getTime(), endAt: new Date(2025, 8, 25, 9, 25).getTime() }, NOW)).toBe('8月23日 15:25 → 9月25日 09:25')
    useLanguage('en')
    expect(cruiseWindowLabelOf({ startAt: new Date(2025, 7, 23, 15, 25).getTime(), endAt: new Date(2025, 8, 25, 9, 25).getTime() }, NOW)).toBe('8/23 15:25 → 9/25 09:25')
  })

  it('a same-day end keeps both clock times', () => {
    useLanguage('zh')
    expect(cruiseWindowLabelOf({ startAt: new Date(2025, 7, 23, 15, 25).getTime(), endAt: new Date(2025, 7, 23, 23, 0).getTime() }, NOW)).toBe('8月23日 15:25 → 23:00')
  })
})
