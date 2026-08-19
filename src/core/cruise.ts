/**
 * Auto-cruise scheduled windows: the pure state machine behind "定时自动
 * 开/关".
 *
 * `enabled` is the single source of truth. A manual toggle flips it DIRECTLY
 * and NEVER touches the window list — clicking 开启/关闭 back and forth can
 * no longer accumulate window records (the old model wrote windows on every
 * toggle). Scheduled windows are appointments: their start instant flips the
 * cruise ON, their end instant flips it OFF (minute-granularity boundary
 * events; missed boundaries are skipped, never caught up), and windows that
 * are fully past are pruned automatically so the list only ever shows live
 * or future appointments. An open-ended window (no endAt) is a one-shot
 * "turn on at startAt" — it fires once and then prunes, so it can never
 * linger as a dead record.
 *
 * Framework-free and fully unit-testable.
 */
import type { CruiseState } from './controller.ts'

/** One scheduled cruise window (epoch ms; endAt absent = one-shot "turn on at startAt"). */
export interface CruiseWindow {
  /** When the window starts (epoch ms). */
  startAt: number
  /** When the window ends (epoch ms); absent = the window only turns the cruise on. */
  endAt?: number
}

/** The tick granularity for boundary detection (the scheduler heartbeat). */
export const CRUISE_TICK_MS = 60_000

/** Brand an unknown value as a valid window (persisted-state guard). */
export function isCruiseWindow(value: unknown): value is CruiseWindow {
  if (typeof value !== 'object' || value === null) return false
  const window = value as Record<string, unknown>
  return typeof window.startAt === 'number' && Number.isFinite(window.startAt)
    && (window.endAt === undefined || (typeof window.endAt === 'number' && Number.isFinite(window.endAt)))
}

/** The window covering `now`, preferring the one ending latest (undefined = off). */
export function coveringWindow(state: CruiseState, now: number): CruiseWindow | undefined {
  let best: CruiseWindow | undefined
  for (const window of state.schedule) {
    if (window.startAt > now) continue
    if (window.endAt !== undefined && window.endAt <= now) continue
    if (best === undefined || (window.endAt ?? Infinity) > (best.endAt ?? Infinity)) best = window
  }
  return best
}

/**
 * Apply a manual toggle: flips `enabled` ONLY — the window list is never
 * written, so repeated 开启/关闭 clicks cannot grow the schedule. No-op when
 * the state already matches.
 */
export function applyManualToggle(state: CruiseState, on: boolean): CruiseState {
  return state.enabled === on ? state : { ...state, enabled: on }
}

/**
 * One heartbeat tick (the scheduler calls this every minute):
 * - a window whose start instant falls within the last tick flips the cruise
 *   ON (scheduled ON); its end instant flips it OFF (scheduled OFF). Ends
 *   are applied after starts within the same tick, so a window that starts
 *   and ends inside one minute nets OFF.
 * - boundaries older than one tick are missed and skipped ("错过即跳过"),
 *   which also covers stale windows persisted before a restart.
 * - fully-past windows are pruned: an explicit endAt <= now, or an
 *   open-ended window whose startAt has passed (its one-shot ON fired).
 * With no boundary event the state stays exactly as it is (manual intent
 * wins between appointments).
 */
export function tickCruise(state: CruiseState, now: number): CruiseState {
  let enabled = state.enabled
  const schedule: CruiseWindow[] = []
  for (const window of state.schedule) {
    if (window.startAt > now - CRUISE_TICK_MS && window.startAt <= now) enabled = true
    if (window.endAt !== undefined && window.endAt > now - CRUISE_TICK_MS && window.endAt <= now) enabled = false
    const expired = window.endAt !== undefined
      ? window.endAt <= now
      : window.startAt <= now
    if (!expired) schedule.push(window)
  }
  if (schedule.length === state.schedule.length && enabled === state.enabled) return state
  return { ...state, enabled, schedule }
}

/**
 * Replace the window list (the editor's add/remove path): sorted, then the
 * effective state is recomputed at once against the NEW list — a window
 * already covering now turns the cruise on immediately, and removing every
 * covering window turns it off (the old "按新表重算" contract). Pruning is
 * left to tickCruise so a just-added window is never yanked before its first
 * heartbeat.
 */
export function setCruiseSchedule(state: CruiseState, windows: readonly CruiseWindow[], now: number): CruiseState {
  const schedule = sortWindows(windows)
  const enabled = coveringWindow({ ...state, schedule }, now) !== undefined
  if (schedule === state.schedule && enabled === state.enabled) return state
  return { ...state, schedule, enabled }
}

/** Replace the window list (sorted by start). */
export function sortWindows(windows: readonly CruiseWindow[]): CruiseWindow[] {
  return [...windows].sort((a, b) => a.startAt - b.startAt)
}
