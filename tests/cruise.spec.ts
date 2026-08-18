/**
 * Cruise scheduled-window tests: the pure state machine behind "定时自动
 * 开/关" — effective state, manual toggles editing the window list, and the
 * "future window re-enables after this round ends" semantics.
 */
import { describe, expect, it } from 'vitest'
import { applyManualToggle, coveringWindow, effectiveEnabled, sortWindows, type CruiseWindow } from '../src/core/cruise.ts'
import type { CruiseState } from '../src/core/controller.ts'

const NOW = 1_700_000_000_000
const HOUR = 3_600_000

function state(schedule: CruiseWindow[], enabled = false): CruiseState {
  return { enabled, limit: 5, schedule }
}

describe('cruise scheduled windows (纯逻辑)', () => {
  it('effectiveEnabled: off before a window, on inside, off after; open-ended stays on', () => {
    const windows: CruiseWindow[] = [{ startAt: NOW + HOUR, endAt: NOW + 2 * HOUR }]
    expect(effectiveEnabled(state(windows), NOW)).toBe(false)
    expect(effectiveEnabled(state(windows), NOW + HOUR)).toBe(true)
    expect(effectiveEnabled(state(windows), NOW + 2 * HOUR)).toBe(false) // end exclusive
    const open = state([{ startAt: NOW + HOUR }])
    expect(effectiveEnabled(open, NOW + 99 * HOUR)).toBe(true)
  })

  it('applyManualToggle ON adds an open-ended window from now; already on = no change', () => {
    const turnedOn = applyManualToggle(state([]), true, NOW)
    expect(turnedOn.enabled).toBe(true)
    expect(turnedOn.schedule).toEqual([{ startAt: NOW }])
    expect(applyManualToggle(turnedOn, true, NOW + 1)).toBe(turnedOn)
  })

  it('manual OFF closes the covering window; future windows stay and re-enable later', () => {
    const withFuture = applyManualToggle(state([{ startAt: NOW + 5 * HOUR }]), true, NOW)
    const turnedOff = applyManualToggle(withFuture, false, NOW + HOUR)
    expect(turnedOff.enabled).toBe(false)
    expect(turnedOff.schedule).toEqual([
      { startAt: NOW, endAt: NOW + HOUR },
      { startAt: NOW + 5 * HOUR },
    ])
    // The remaining future window auto-enables at its start.
    expect(effectiveEnabled(turnedOff, NOW + 5 * HOUR)).toBe(true)
  })

  it('manual OFF with no covering window just disables; OFF when already off is a no-op', () => {
    const on = state([], true)
    expect(applyManualToggle(on, false, NOW)).toEqual({ enabled: false, limit: 5, schedule: [] })
    const alreadyOff = state([{ startAt: NOW + HOUR }])
    expect(applyManualToggle(alreadyOff, false, NOW)).toBe(alreadyOff)
  })

  it('coveringWindow picks the window ending latest; sortWindows orders by start', () => {
    const windows: CruiseWindow[] = [{ startAt: NOW + HOUR }, { startAt: NOW, endAt: NOW + 2 * HOUR }]
    expect(coveringWindow(state(windows), NOW + 1)?.startAt).toBe(NOW)
    expect(sortWindows(windows).map(window => window.startAt)).toEqual([NOW, NOW + HOUR])
  })
})
