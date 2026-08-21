/**
 * Cruise scheduled-window tests (v4): `enabled` (the switch) is the user's
 * state; a window is an APPOINTMENT — its start/end instants are the only
 * automatic flippers, and EDITING the plan never flips the switch (except
 * an added only-end window, whose start instant IS the add). Start/end are
 * BOTH optional: every combination with any manual position composes to a
 * deterministic state. Cross-midnight windows normalize (+1 day) instead of
 * erroring; user-error ranges (both-empty / same instant / end more than a
 * day before start / past endpoints) are rejected with concrete messages.
 */
import { describe, expect, it } from 'vitest'
import {
  CRUISE_TICK_MS, DAY_MS, applyManualToggle, coveringWindow, cruiseStatusLineOf, cruiseWindowGrammarOf,
  duplicateWindowOf, isWindowActive, normalizeWindow, setCruiseSchedule, sortWindows, tickCruise,
  windowRangeIssueOf, windowSortKeyOf, type CruiseWindow,
} from '../src/core/cruise.ts'
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
  it('an end more than a whole day before the start is a DATE MISTAKE — left as-entered', () => {
    expect(normalizeWindow({ startAt: NOW, endAt: NOW - 26 * HOUR })).toEqual({ startAt: NOW, endAt: NOW - 26 * HOUR })
  })
  it('coveringWindow honors absent ends (open) and absent starts (since now)', () => {
    expect(coveringWindow(state([{ startAt: NOW - 1 }]), NOW + HOUR)?.startAt).toBe(NOW - 1)
    expect(coveringWindow(state([{ endAt: NOW + HOUR }]), NOW)).toEqual({ endAt: NOW + HOUR })
    expect(coveringWindow(state([{ endAt: NOW - 1 }]), NOW)).toBeUndefined()
    expect(coveringWindow(state([{ startAt: NOW + 1, endAt: NOW + HOUR }]), NOW)).toBeUndefined()
  })
})

describe('windowRangeIssueOf (concrete, explainable window validation)', () => {
  it('neither endpoint set is an error; single-ended windows are always well-formed', () => {
    expect(windowRangeIssueOf({}, NOW)).toBe('both-empty')
    expect(windowRangeIssueOf({ startAt: NOW + HOUR }, NOW)).toBeUndefined()
    expect(windowRangeIssueOf({ endAt: NOW + HOUR }, NOW)).toBeUndefined()
  })
  it('a same-instant start/end is rejected (zero-length is not a window)', () => {
    expect(windowRangeIssueOf({ startAt: NOW + HOUR, endAt: NOW + HOUR }, NOW)).toBe('same-instant')
  })
  it('an end more than a day before the start is a date mistake, not a night', () => {
    expect(windowRangeIssueOf(normalizeWindow({ startAt: NOW, endAt: NOW - 25 * HOUR }), NOW)).toBe('end-too-early')
    expect(windowRangeIssueOf(normalizeWindow({ startAt: NOW, endAt: NOW - DAY }), NOW)).toBe('end-too-early')
  })
  it('a genuine cross-midnight night (end within (start-24h, start]) passes once normalized', () => {
    expect(windowRangeIssueOf(normalizeWindow({ startAt: NOW + 1, endAt: NOW + 2 * HOUR - DAY }), NOW)).toBeUndefined()
    expect(windowRangeIssueOf(normalizeWindow({ startAt: NOW + 1, endAt: NOW + HOUR }), NOW)).toBeUndefined()
  })
  it('past endpoints are named: start-past / end-past', () => {
    expect(windowRangeIssueOf({ startAt: NOW - 1, endAt: NOW + HOUR }, NOW)).toBe('start-past')
    expect(windowRangeIssueOf({ startAt: NOW + HOUR, endAt: NOW - 1 }, NOW)).toBe('end-past')
    expect(windowRangeIssueOf({ endAt: NOW - 1 }, NOW)).toBe('end-past')
  })
})

describe('setCruiseSchedule (v4: editing the PLAN never flips the switch)', () => {
  it('adding a future window keeps enabled+manual untouched', () => {
    const on = state([], true, true)
    const next = setCruiseSchedule(on, [{ startAt: NOW + HOUR, endAt: NOW + 2 * HOUR }], NOW)
    expect(next.enabled).toBe(true)
    expect(next.manual).toBe(true)
    expect(next.schedule).toEqual([{ startAt: NOW + HOUR, endAt: NOW + 2 * HOUR }])
  })
  it('removing EVERY window keeps the switch as-is (manual on/off always matches up)', () => {
    const on = state([{ startAt: NOW, endAt: NOW + HOUR }], true)
    const cleared = setCruiseSchedule(on, [], NOW)
    expect(cleared.enabled).toBe(true)
    expect(cleared.schedule).toEqual([])
    const off = state([{ startAt: NOW, endAt: NOW + HOUR }], false, false)
    expect(setCruiseSchedule(off, [], NOW).enabled).toBe(false)
  })
  it('an ADDED only-end window fires its start boundary at creation (turns on, manual clears)', () => {
    const off = state([], false, false)
    const next = setCruiseSchedule(off, [{ endAt: NOW + HOUR }], NOW)
    expect(next.enabled).toBe(true)
    expect(next.manual).toBeUndefined()
    expect(next.schedule).toEqual([{ endAt: NOW + HOUR }])
    // Already on: adding another only-end window keeps it on.
    const on = state([{ endAt: NOW + HOUR }], true)
    expect(setCruiseSchedule(on, [{ endAt: NOW + HOUR }, { endAt: NOW + 2 * HOUR }], NOW).enabled).toBe(true)
  })
  it('sorts + normalizes + drops empties; an identical list is a no-op', () => {
    const unsorted = [{ startAt: NOW + 2 * HOUR, endAt: NOW + 3 * HOUR }, { endAt: NOW + HOUR }]
    const next = setCruiseSchedule(state([]), unsorted, NOW)
    expect(next.schedule.map(w => w.startAt ?? w.endAt)).toEqual([NOW + HOUR, NOW + 2 * HOUR])
    expect(setCruiseSchedule(state([]), [{ startAt: NOW, endAt: NOW + 2 * HOUR - DAY }, {}], NOW).schedule)
      .toEqual([{ startAt: NOW, endAt: NOW + 2 * HOUR - DAY + DAY }])
    // same list → identical state object (no touch, no re-extend).
    const once = setCruiseSchedule(state([]), [{ endAt: NOW + HOUR }], NOW)
    expect(setCruiseSchedule(once, [{ endAt: NOW + HOUR }], NOW)).toBe(once)
  })
})

describe('cruiseStatusLineOf (one honest sentence: why is the switch what it is)', () => {
  it('enabled + covering window with an end → window-on until that end', () => {
    const line = cruiseStatusLineOf(state([{ startAt: NOW - 1, endAt: NOW + HOUR }], true), NOW)
    expect(line).toEqual({ kind: 'window-on', endAt: NOW + HOUR })
  })
  it('enabled + an open covering window (start-only) → held on, no end', () => {
    expect(cruiseStatusLineOf(state([{ startAt: NOW - 1 }], true), NOW)).toEqual({ kind: 'window-on' })
  })
  it('enabled + nothing covering → manual on', () => {
    expect(cruiseStatusLineOf(state([], true, true), NOW)).toEqual({ kind: 'manual-on' })
    expect(cruiseStatusLineOf(state([{ startAt: NOW + HOUR }], true), NOW)).toEqual({ kind: 'manual-on' })
  })
  it('disabled + a live window → manual-off (the window still covers, the switch says off)', () => {
    expect(cruiseStatusLineOf(state([{ endAt: NOW + HOUR }], false, false), NOW)).toEqual({ kind: 'manual-off', endAt: NOW + HOUR })
    expect(cruiseStatusLineOf(state([{ startAt: NOW - 1 }], false, false), NOW)).toEqual({ kind: 'manual-off' })
  })
  it('disabled + a future start → scheduled-off at that instant; nothing → off', () => {
    expect(cruiseStatusLineOf(state([{ startAt: NOW + HOUR }], false), NOW)).toEqual({ kind: 'scheduled-off', startAt: NOW + HOUR })
    expect(cruiseStatusLineOf(state([], false), NOW)).toEqual({ kind: 'off' })
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

describe('isWindowActive (a window is LIVE when it covers now)', () => {
  it('covers when start (if any) is not future and end (if any) is not past', () => {
    expect(isWindowActive({ startAt: NOW - 1, endAt: NOW + HOUR }, NOW)).toBe(true)
    expect(isWindowActive({ startAt: NOW + 1, endAt: NOW + HOUR }, NOW)).toBe(false)
    expect(isWindowActive({ endAt: NOW + HOUR }, NOW)).toBe(true)
    expect(isWindowActive({ startAt: NOW - 1 }, NOW)).toBe(true)
    expect(isWindowActive({ endAt: NOW - 1 }, NOW)).toBe(false)
  })
})

describe('cruiseWindowGrammarOf (ONE clear display shape per window)', () => {
  it('both → range; only start → from-start; only end → until-end', () => {
    expect(cruiseWindowGrammarOf({ startAt: NOW, endAt: NOW + HOUR })).toEqual({ kind: 'range', startAt: NOW, endAt: NOW + HOUR })
    expect(cruiseWindowGrammarOf({ startAt: NOW + HOUR })).toEqual({ kind: 'from-start', startAt: NOW + HOUR })
    expect(cruiseWindowGrammarOf({ endAt: NOW + HOUR })).toEqual({ kind: 'until-end', endAt: NOW + HOUR })
  })
})

describe('windowSortKeyOf / sortWindows (the list order is derived, never stored)', () => {
  it('start-less (立即开启) leads, then start asc, then end asc with an open end last', () => {
    const windows = [
      { startAt: NOW + 3 * HOUR },
      { endAt: NOW + 1 * HOUR }, // immediate-on, earliest end
      { startAt: NOW + 1 * HOUR, endAt: NOW + 2 * HOUR },
      { startAt: NOW + 1 * HOUR }, // same start, open end → after the finite end
    ]
    expect(sortWindows(windows)).toEqual([
      { endAt: NOW + 1 * HOUR },
      { startAt: NOW + 1 * HOUR, endAt: NOW + 2 * HOUR },
      { startAt: NOW + 1 * HOUR },
      { startAt: NOW + 3 * HOUR },
    ])
  })
  it('windowSortKeyOf: start-less keys 0 (first), open ends key MAX (last among ties)', () => {
    expect(windowSortKeyOf({ endAt: NOW + HOUR })).toEqual({ start: 0, end: NOW + HOUR })
    expect(windowSortKeyOf({ startAt: NOW, endAt: NOW + HOUR })).toEqual({ start: NOW, end: NOW + HOUR })
    expect(windowSortKeyOf({ startAt: NOW }).end).toBe(Number.MAX_SAFE_INTEGER)
  })
})

describe('duplicateWindowOf (single write point rejects exact duplicates)', () => {
  it('matches identical normalized bounds incl. cross-midnight re-entries', () => {
    const windows: CruiseWindow[] = [{ startAt: NOW, endAt: NOW + HOUR }, { startAt: NOW + 22 * HOUR, endAt: NOW + 4 * HOUR }]
    expect(duplicateWindowOf(windows, { startAt: NOW, endAt: NOW + HOUR })?.endAt).toBe(NOW + HOUR)
    // 22:00 → 02:00 normalized (+1 day); a re-entry with the raw time matches.
    expect(duplicateWindowOf(windows, { startAt: NOW + 22 * HOUR, endAt: NOW + 4 * HOUR })?.startAt).toBe(NOW + 22 * HOUR)
  })

  it('start-only vs end-only windows are never duplicates; distinct bounds match nothing', () => {
    const windows: CruiseWindow[] = [{ startAt: NOW }, { endAt: NOW + HOUR }]
    expect(duplicateWindowOf(windows, { startAt: NOW })).toBeDefined()
    expect(duplicateWindowOf(windows, { endAt: NOW + HOUR })).toBeDefined()
    expect(duplicateWindowOf(windows, { startAt: NOW, endAt: NOW + HOUR })).toBeUndefined()
    expect(duplicateWindowOf(windows, { startAt: NOW + 1 })).toBeUndefined()
  })
})
