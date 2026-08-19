/**
 * Auto-cruise scheduled windows (v3): the pure state machine behind "定时自动
 * 开/关", redesigned so ANY combination of start / end and the manual switch
 * is well-defined and robust.
 *
 * - `enabled` is the single source of truth; `manual?: boolean` records the
 *   last explicit manual intent (true = 手动开, false = 手动关).
 * - A window is `CruiseWindow { startAt?; endAt? }` — EITHER may be set:
 *   - both      → the interval [startAt, endAt) is ON, outside is OFF;
 *   - only start → turns ON at startAt and stays on (no auto-off);
 *   - only end   → considered ON from now and turns OFF at endAt.
 *   This matches the industry baseline (Azure TimeWindow / Flaggr / Amps).
 * - Manual intent wins BETWEEN boundary events, but a boundary always takes
 *   over (`manual = undefined`, the appointment resumes). So "都设" 的窗口
 *   区间内外开关、无论手动怎么点最终都对得上；"只设开始/只设结束"与手动任意
 *   组合也有确定结果。
 * - Cross-midnight windows (an end earlier than start in the SAME intent,
 *   e.g. 22:00 → 02:00) are normalized at add time: `endAt <= startAt` ⇒
 *   `endAt += 24h`, anchored to the start's calendar day — never a false
 *   "逆序报错"; the list only ever shows live or future appointments.
 * Framework-free and fully unit-testable.
 */
import type { CruiseState } from './controller.ts'

/** One scheduled cruise window (epoch ms); at least one of startAt/endAt is set. */
export interface CruiseWindow {
  /** When the window starts (epoch ms); absent = the window is on since "now" until endAt. */
  startAt?: number
  /** When the window ends (epoch ms); absent = the window turns on at startAt and stays on. */
  endAt?: number
}

/** The tick granularity for boundary detection (the scheduler heartbeat). */
export const CRUISE_TICK_MS = 60_000

/** One calendar day (cross-midnight normalization). */
export const DAY_MS = 86_400_000

/** Brand an unknown value as a valid window (persisted-state guard). */
export function isCruiseWindow(value: unknown): value is CruiseWindow {
  if (typeof value !== 'object' || value === null) return false
  const window = value as Record<string, unknown>
  const startOk = window.startAt === undefined || (typeof window.startAt === 'number' && Number.isFinite(window.startAt))
  const endOk = window.endAt === undefined || (typeof window.endAt === 'number' && Number.isFinite(window.endAt))
  return startOk && endOk
    && (typeof window.startAt === 'number' || typeof window.endAt === 'number')
}

/**
 * Normalize a window: a within-the-same-intent end earlier than the start is
 * a cross-midnight window (22:00 → 02:00 is legal) — yield the end on the
 * start's next day. Starts that equal the end collapse to zero-length tonight
 * and are kept as-is for explicit UI review.
 */
export function normalizeWindow(window: CruiseWindow): CruiseWindow {
  const startAt = window.startAt
  let endAt = window.endAt
  if (startAt !== undefined && endAt !== undefined && endAt <= startAt) {
    endAt += DAY_MS
  }
  return {
    ...(startAt !== undefined ? { startAt } : {}),
    ...(endAt !== undefined ? { endAt } : {}),
  }
}

/** Whether a window is structurally empty (no start and no end). */
export function isEmptyWindow(window: CruiseWindow): boolean {
  return window.startAt === undefined && window.endAt === undefined
}

/**
 * The window covering `now` (preferring the one ending latest; undefined =
 * off): a window covers when its start (if any) is not in the future and its
 * end (if any) is not in the past. A start-less window is on since minus
 * infinity (from now until its end); an end-less window extends to infinity
 * (on from its start).
 */
export function coveringWindow(state: CruiseState, now: number): CruiseWindow | undefined {
  let best: CruiseWindow | undefined
  for (const window of state.schedule) {
    if (window.startAt !== undefined && window.startAt > now) continue
    if (window.endAt !== undefined && window.endAt <= now) continue
    if (best === undefined || (window.endAt ?? Infinity) > (best.endAt ?? Infinity)) best = window
  }
  return best
}

/**
 * Apply a manual toggle: flips `enabled` and records the MANUAL intent — the
 * window list is never written, so clicking 开启/关闭 cannot grow the
 * schedule. Manual ranks above the schedule between boundary events; the next
 * boundary takes over again (tickCruise clears `manual`).
 */
export function applyManualToggle(state: CruiseState, on: boolean): CruiseState {
  return state.enabled === on ? state : { ...state, enabled: on, manual: on }
}

/**
 * One heartbeat tick (the scheduler calls this every minute):
 * - a window whose start instant falls within the last tick flips the cruise
 *   ON (manual cleared — the appointment takes over); its end instant flips
 *   it OFF likewise; ends run after starts within the same tick.
 * - boundaries older than one tick are missed and skipped ("错过即跳过"),
 *   which also covers stale windows persisted before a restart.
 * - fully-past windows are pruned: an explicit endAt <= now, or an end-less
 *   window whose startAt has passed (its one-shot ON already fired).
 * With no boundary event the state stays exactly as it is (manual wins
 * between appointments).
 */
export function tickCruise(state: CruiseState, now: number): CruiseState {
  let enabled = state.enabled
  let manual = state.manual
  const schedule: CruiseWindow[] = []
  for (const window of state.schedule) {
    const startFired = window.startAt !== undefined
      && window.startAt > now - CRUISE_TICK_MS && window.startAt <= now
    const endFired = window.endAt !== undefined
      && window.endAt > now - CRUISE_TICK_MS && window.endAt <= now
    if (startFired) {
      enabled = true
      manual = undefined
    }
    if (endFired) {
      enabled = false
      manual = undefined
    }
    const expired = window.endAt !== undefined
      ? window.endAt <= now
      : window.startAt !== undefined && window.startAt <= now
    if (!expired) schedule.push(window)
  }
  const same = schedule.length === state.schedule.length
    && enabled === state.enabled && manual === state.manual
  return same ? state : { ...state, enabled, schedule, manual }
}

/**
 * Replace the window list (the editor's add/remove path): normalized
 * (cross-midnight) + sorted, empties dropped, then the effective state is
 * recomputed at once against the NEW list — a window already covering now
 * turns the cruise on, and removing every covering window turns it off (the
 * old "按新表重算" contract; the user visibly edited the plan). Manual intent
 * is preserved unless the edit itself flips the coverage.
 */
export function setCruiseSchedule(state: CruiseState, windows: readonly CruiseWindow[], now: number): CruiseState {
  const schedule = sortWindows(windows
    .map(normalizeWindow)
    .filter(window => !isEmptyWindow(window)))
  const enabled = coveringWindow({ ...state, schedule }, now) !== undefined
  if (schedule === state.schedule && enabled === state.enabled) return state
  return { ...state, schedule, enabled }
}

/** Sort windows by their effective start (start-less windows by their end). */
export function sortWindows(windows: readonly CruiseWindow[]): CruiseWindow[] {
  return [...windows].sort((a, b) => (a.startAt ?? a.endAt ?? 0) - (b.startAt ?? b.endAt ?? 0))
}
