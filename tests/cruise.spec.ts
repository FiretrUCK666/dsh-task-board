/**
 * Cruise scheduled-window tests: the pure state machine behind "定时自动
 * 开/关" — `enabled` is the truth (manual toggles never touch the schedule),
 * windows flip it at their boundary instants, and expired windows prune
 * themselves automatically.
 */
import { describe, expect, it } from 'vitest'
import { CRUISE_TICK_MS, applyManualToggle, coveringWindow, setCruiseSchedule, sortWindows, tickCruise, type CruiseWindow } from '../src/core/cruise.ts'
import type { CruiseState } from '../src/core/controller.ts'

const NOW = 1_700_000_000_000
const HOUR = 3_600_000

function state(schedule: CruiseWindow[], enabled = false): CruiseState {
  return { enabled, limit: 5, schedule }
}

describe('applyManualToggle (manual intent never touches the schedule)', () => {
  it('flips enabled only; the window list stays exactly as it was', () => {
    const before = state([{ startAt: NOW + HOUR, endAt: NOW + 2 * HOUR }])
    const on = applyManualToggle(before, true)
    expect(on.enabled).toBe(true)
    expect(on.schedule).toBe(before.schedule)
    const off = applyManualToggle(on, false)
    expect(off.enabled).toBe(false)
    expect(off.schedule).toBe(before.schedule)
  })

  it('is a no-op when the state already matches', () => {
    const on = state([], true)
    expect(applyManualToggle(on, true)).toBe(on)
    const off = state([{ startAt: NOW + HOUR }])
    expect(applyManualToggle(off, false)).toBe(off)
  })

  it('repeated toggling never accumulates window records', () => {
    let current = state([])
    for (let index = 0; index < 10; index += 1) {
      current = applyManualToggle(current, index % 2 === 0)
    }
    expect(current.schedule).toEqual([])
  })
})

describe('tickCruise (boundary flips + automatic pruning)', () => {
  it('a window start within the last tick flips the cruise ON', () => {
    const next = tickCruise(state([{ startAt: NOW + 1000, endAt: NOW + HOUR }]), NOW + 2000)
    expect(next.enabled).toBe(true)
    expect(next.schedule).toEqual([{ startAt: NOW + 1000, endAt: NOW + HOUR }])
  })

  it('a window end within the last tick flips the cruise OFF and prunes it', () => {
    const next = tickCruise(state([{ startAt: NOW, endAt: NOW + 1000 }], true), NOW + 2000)
    expect(next.enabled).toBe(false)
    expect(next.schedule).toEqual([])
  })

  it('a window starting and ending inside the same tick nets OFF (end wins)', () => {
    const next = tickCruise(state([{ startAt: NOW + 500, endAt: NOW + 800 }]), NOW + 2000)
    expect(next.enabled).toBe(false)
    expect(next.schedule).toEqual([])
  })

  it('with no boundary event the state is untouched (manual intent wins)', () => {
    const windows: CruiseWindow[] = [{ startAt: NOW + HOUR, endAt: NOW + 2 * HOUR }]
    const on = tickCruise(state(windows, true), NOW + 5)
    expect(on.enabled).toBe(true)
    expect(on.schedule).toBe(windows)
    const off = tickCruise(state(windows, false), NOW + 5)
    expect(off.enabled).toBe(false)
    expect(off.schedule).toBe(windows)
  })

  it('missed boundaries are skipped (错过即跳过), not caught up', () => {
    // The window started 10 minutes ago; no boundary falls in the last tick.
    const next = tickCruise(state([{ startAt: NOW - 10 * CRUISE_TICK_MS, endAt: NOW + HOUR }]), NOW)
    expect(next.enabled).toBe(false)
    // An open-ended window whose start passed long ago is stale and pruned.
    const stale = tickCruise(state([{ startAt: NOW - 10 * CRUISE_TICK_MS }]), NOW)
    expect(stale.schedule).toEqual([])
  })

  it('prunes expired windows and keeps live + future ones', () => {
    const windows: CruiseWindow[] = [
      { startAt: NOW - 2 * HOUR, endAt: NOW - HOUR }, // expired
      { startAt: NOW - 30 * 60_000, endAt: NOW + HOUR }, // covering now
      { startAt: NOW + HOUR, endAt: NOW + 2 * HOUR }, // future
    ]
    const next = tickCruise(state(windows), NOW)
    expect(next.schedule).toEqual([windows[1], windows[2]])
  })
})

describe('setCruiseSchedule (editor add/remove path)', () => {
  it('sorts and recomputes: a covering window turns the cruise on, an empty table off', () => {
    const unsorted = [{ startAt: NOW + 2 * HOUR, endAt: NOW + 3 * HOUR }, { startAt: NOW - 1000 }]
    const on = setCruiseSchedule(state([]), unsorted, NOW)
    expect(on.enabled).toBe(true)
    expect(on.schedule.map(window => window.startAt)).toEqual([NOW - 1000, NOW + 2 * HOUR])
    const off = setCruiseSchedule(on, [], NOW)
    expect(off.enabled).toBe(false)
    expect(off.schedule).toEqual([])
  })

  it('a future-only table recomputes the state against it (nothing covers → off)', () => {
    const current = state([], true)
    const next = setCruiseSchedule(current, [{ startAt: NOW + HOUR, endAt: NOW + 2 * HOUR }], NOW)
    expect(next.enabled).toBe(false) // recomputed against the new table
    expect(next.schedule).toEqual([{ startAt: NOW + HOUR, endAt: NOW + 2 * HOUR }])
  })
})

describe('coveringWindow / sortWindows (helpers)', () => {
  it('coveringWindow picks the window ending latest; sortWindows orders by start', () => {
    const windows: CruiseWindow[] = [{ startAt: NOW + HOUR, endAt: NOW + 2 * HOUR }, { startAt: NOW, endAt: NOW + 2 * HOUR + 1 }]
    expect(coveringWindow(state(windows), NOW + 1)?.startAt).toBe(NOW)
    expect(sortWindows(windows).map(window => window.startAt)).toEqual([NOW, NOW + HOUR])
  })
})
