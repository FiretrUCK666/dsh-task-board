/**
 * Cruise scheduled-window tests (v3): `enabled` is the truth, manual intent is
 * a runtime override that the next boundary takes over, and start/end are
 * BOTH optional — every combination (start-only / end-only / both) with any
 * manual position composes to a deterministic state. Cross-midnight windows
 * normalize (+1 day) instead of erroring, and expired windows prune.
 */
import { describe, expect, it } from 'vitest'
import { CRUISE_TICK_MS, DAY_MS, applyManualToggle, coveringWindow, normalizeWindow, setCruiseSchedule, sortWindows, tickCruise, type CruiseWindow } from '../src/core/cruise.ts'
import type { CruiseState } from '../src/core/controller.ts'

const NOW = 1_700_000_000_000
const HOUR = 3_600_000
const DAY = DAY_MS

function state(schedule: CruiseWindow[], enabled = false, manual?: boolean): CruiseState {
  return { enabled, ...(manual !== undefined ? { manual } : {}), limit: 5, schedule }
}

describe('applyManualToggle (manual is a runtime override, never touches the schedule)', () => {
  it('flips enabled + records the intent; the window list stays untouched', () => {
    const windows: CruiseWindow[] = [{ startAt: NOW + HOUR }]
    const on = applyManualToggle(state(windows), true)
    expect(on.enabled).toBe(true)
    expect(on.manual).toBe(true)
    expect(on.schedule).toBe(windows)
    const off = applyManualToggle(on, false)
    expect(off.enabled).toBe(false)
    expect(off.manual).toBe(false)
  })
  it('is a no-op when the state already matches', () => {
    expect(applyManualToggle(state([], true, true), true)).toEqual(state([], true, true))
  })
})

describe('normalizeWindow / coveringWindow (three-state semantics)', () => {
  it('both → a real interval; start-less → on since now until end; end-less → on from start', () => {
    expect(normalizeWindow({ startAt: NOW, endAt: NOW + HOUR })).toEqual({ startAt: NOW, endAt: NOW + HOUR })
    expect(normalizeWindow({ endAt: NOW + HOUR })).toEqual({ endAt: NOW + HOUR })
    expect(normalizeWindow({ startAt: NOW + HOUR })).toEqual({ startAt: NOW + HOUR })
  })
  it('a window whose end precedes its start is CROSS-MIDNIGHT, normalized +1 day (never an error)', () => {
    const cross = normalizeWindow({ startAt: NOW, endAt: NOW + 2 * HOUR - DAY })
    expect(cross.endAt).toBe(NOW + 2 * HOUR - DAY + DAY)
    expect(coveringWindow(state([cross]), NOW)).toEqual(cross)
  })
  it('coveringWindow honors absent ends (open) and absent starts (since now)', () => {
    expect(coveringWindow(state([{ startAt: NOW - 1 }]), NOW + HOUR)?.startAt).toBe(NOW - 1)
    expect(coveringWindow(state([{ endAt: NOW + HOUR }]), NOW)).toEqual({ endAt: NOW + HOUR })
    expect(coveringWindow(state([{ endAt: NOW - 1 }]), NOW)).toBeUndefined()
    expect(coveringWindow(state([{ startAt: NOW + 1, endAt: NOW + HOUR }]), NOW)).toBeUndefined()
  })
})

describe('tickCruise (boundary events + manual takeover + pruning)', () => {
  it('a start boundary flips ON and clears manual (the appointment takes over)', () => {
    const current = applyManualToggle(state([{ startAt: NOW + 1000 }]), false)
    const next = tickCruise(current, NOW + 1000 + 1)
    expect(next.enabled).toBe(true)
    expect(next.manual).toBeUndefined()
  })
  it('an end boundary flips OFF (even over a manual ON) and clears manual', () => {
    const current = applyManualToggle(state([{ endAt: NOW + 1000 }]), true)
    const next = tickCruise(current, NOW + 1000 + 1)
    expect(next.enabled).toBe(false)
    expect(next.manual).toBeUndefined()
    expect(next.schedule).toEqual([]) // end-only window pruned
  })
  it('both-set window: ON inside, OFF after; manual is taken over at each boundary', () => {
    let cruise = applyManualToggle(state([{ startAt: NOW + 1000, endAt: NOW + 10_000 }]), true)
    cruise = tickCruise(cruise, NOW + 1090)
    expect(cruise.enabled).toBe(true)
    expect(cruise.manual).toBeUndefined()
    cruise = tickCruise(cruise, NOW + 10_100)
    expect(cruise.enabled).toBe(false)
  })
  it('no boundary → manual intent holds', () => {
    const manualOn = applyManualToggle(state([{ startAt: NOW + HOUR, endAt: NOW + 2 * HOUR }]), true)
    const kept = tickCruise(manualOn, NOW + 5)
    expect(kept.enabled).toBe(true)
    expect(kept.manual).toBe(true)
    const manualOff = applyManualToggle(state([{ startAt: NOW + HOUR }]), false)
    expect(tickCruise(manualOff, NOW + 5).enabled).toBe(false)
  })
  it('missed boundaries are skipped, not caught up; legacy stale windows prune', () => {
    const next = tickCruise(state([{ startAt: NOW - 10 * CRUISE_TICK_MS, endAt: NOW + HOUR }]), NOW)
    expect(next.enabled).toBe(false)
    const stale = tickCruise(state([{ startAt: NOW - 10 * CRUISE_TICK_MS }]), NOW)
    expect(stale.schedule).toEqual([])
  })
  it('prunes expired and keeps live + future, across all three shapes', () => {
    const windows: CruiseWindow[] = [
      { startAt: NOW - 2 * HOUR, endAt: NOW - HOUR }, // expired interval
      { startAt: NOW - HOUR }, // start-only, firing done → pruned
      { endAt: NOW - 1 }, // end-only, already past → pruned
      { startAt: NOW + HOUR }, // future start-only kept
      { endAt: NOW + 10 * HOUR }, // future end-only kept
    ]
    const next = tickCruise(state(windows), NOW)
    expect(next.schedule).toEqual([{ startAt: NOW + HOUR }, { endAt: NOW + 10 * HOUR }])
  })
  it('cross-midnight window covers its night and prunes after the normalized end', () => {
    const start = NOW - HOUR // "22:00"
    const enteredEnd = start - 20 * HOUR // "today 02:00" — earlier than 22:00 → intended NEXT-day 02:00
    const cross = normalizeWindow({ startAt: start, endAt: enteredEnd })
    expect(cross.endAt).toBe(enteredEnd + DAY) // normalized to start + 4h (次日 02:00)
    // Still night (NOW lies inside 22:00→02:00): covered.
    expect(coveringWindow(state([cross]), NOW)).toEqual(cross)
    // Long past the normalized end: the window prunes (no caught-up flip, so
    // enabled is left alone — 错过即跳过).
    const after = tickCruise(state([cross], true), NOW + 10 * HOUR)
    expect(after.schedule).toEqual([])
    // When the END BOUNDARY is observed in time it also flips OFF.
    const endAt = cross.endAt as number
    const boundary = tickCruise(state([cross], true), endAt + 1000)
    expect(boundary.enabled).toBe(false)
    expect(boundary.schedule).toEqual([])
  })
})

describe('setCruiseSchedule (editor path)', () => {
  it('sorts + normalizes + recomputes: covering turns on, clearing all turns off', () => {
    const unsorted = [{ startAt: NOW + 2 * HOUR, endAt: NOW + 3 * HOUR }, { endAt: NOW + HOUR }]
    const on = setCruiseSchedule(state([]), unsorted, NOW)
    expect(on.enabled).toBe(true) // the end-only window is on from now
    const off = setCruiseSchedule(on, [], NOW)
    expect(off.enabled).toBe(false)
  })
  it('drops structurally empty windows and normalizes cross-midnight on add', () => {
    const next = setCruiseSchedule(state([]), [{ startAt: NOW, endAt: NOW + 2 * HOUR - DAY }, {}], NOW)
    expect(next.schedule).toHaveLength(1)
    expect(next.schedule[0].endAt).toBe(NOW + 2 * HOUR - DAY + DAY)
  })
  it('sortWindows orders by the effective start (start-less by end)', () => {
    expect(sortWindows([{ startAt: NOW + HOUR }, { endAt: NOW }, { startAt: NOW, endAt: NOW + 1 }].map(normalizeWindow))
      .map(w => w.startAt ?? w.endAt ?? 0)).toEqual([NOW, NOW, NOW + HOUR])
  })
})
