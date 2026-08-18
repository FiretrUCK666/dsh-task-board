/**
 * Auto-cruise scheduled windows: the pure state machine behind "定时自动
 * 开/关". A cruise run is a list of time windows `[startAt, endAt?)` —
 * endAt absent means "保持开启直到手动关闭". The effective state at any
 * moment is: ON if any window covers that moment. Manual toggles edit the
 * windows (manual ON = add an open-ended window from now; manual OFF =
 * close the window covering now — future windows stay scheduled and will
 * auto-enable again later). Framework-free and fully unit-testable.
 */
import type { CruiseState } from './controller.ts'

/** One scheduled cruise window (epoch ms; endAt absent = stay on). */
export interface CruiseWindow {
  /** When the window starts (epoch ms). */
  startAt: number
  /** When the window ends (epoch ms); absent = keep running until manually off. */
  endAt?: number
}

/** Brand an unknown value as a valid window (persisted-state guard). */
export function isCruiseWindow(value: unknown): value is CruiseWindow {
  if (typeof value !== 'object' || value === null) return false
  const window = value as Record<string, unknown>
  return typeof window.startAt === 'number' && Number.isFinite(window.startAt)
    && (window.endAt === undefined || (typeof window.endAt === 'number' && Number.isFinite(window.endAt)))
}

/** Whether the cruise is effectively on at `now` (any window covers it). */
export function effectiveEnabled(state: CruiseState, now: number): boolean {
  return state.schedule.some(window => window.startAt <= now
    && (window.endAt === undefined || window.endAt > now))
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
 * Apply a manual toggle to the window schedule:
 * - ON: if nothing covers now, add an open-ended window from now (一直保持
 *   until manually off). Already on → no change.
 * - OFF: close the window covering now at `now` (本轮结束 — future windows
 *   remain scheduled and will auto-enable again). Not on → no change.
 */
export function applyManualToggle(state: CruiseState, on: boolean, now: number): CruiseState {
  if (on) {
    if (coveringWindow(state, now) !== undefined) return state
    return { ...state, enabled: true, schedule: sortWindows([...state.schedule, { startAt: now }]) }
  }
  const covering = coveringWindow(state, now)
  if (covering === undefined) {
    return state.enabled ? { ...state, enabled: false } : state
  }
  return {
    ...state,
    enabled: false,
    schedule: sortWindows(state.schedule.map(window =>
      window === covering ? { ...window, endAt: now } : window)),
  }
}

/** Replace the window list (sorted by start; effective state recomputed by the caller). */
export function sortWindows(windows: readonly CruiseWindow[]): CruiseWindow[] {
  return [...windows].sort((a, b) => a.startAt - b.startAt)
}
