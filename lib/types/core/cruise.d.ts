/**
 * Auto-cruise scheduled windows (v4): the pure state machine behind "定时自动
 * 开/关", redesigned so the manual switch and the scheduled windows compose
 * with ONE explainable rule:
 *
 * - `enabled` (the switch) is the CURRENT state — the user controls it; a
 *   window boundary (start/end instant) is the ONLY automatic flipper.
 * - A window is `CruiseWindow { startAt?; endAt? }` — EITHER may be set:
 *   - both      → the interval [startAt, endAt) is ON, outside is OFF;
 *   - only start → turns ON at startAt and stays on (no auto-off);
 *   - only end   → its start instant is CREATION: adding it fires the start
 *     boundary at once (turns ON if off), then END flips OFF at endAt.
 * - Editing the plan (add/remove/change windows) NEVER flips the switch —
 *   except the only-end add above (its start is the add itself). Removing
 *   every window leaves the switch exactly as it is: manual on/off after
 *   that always matches up ("拔了窗口，手动开关也稳").
 * - Cross-midnight windows end earlier than start in the SAME intent
 *   (22:00 → 02:00) are normalized +24h at add time; an end more than a
 *   whole day BEFORE the start is a date mistake (windowRangeIssueOf).
 * - Manual intent (`manual?: boolean`) records the last explicit toggle;
 *   the next boundary takes over (`manual = undefined`).
 * Framework-free and fully unit-testable.
 */
import type { CruiseState } from './controller.ts';
/** One scheduled cruise window (epoch ms); at least one of startAt/endAt is set. */
export interface CruiseWindow {
    /** When the window starts (epoch ms); absent = the window is on since "now" until endAt. */
    startAt?: number;
    /** When the window ends (epoch ms); absent = the window turns on at startAt and stays on. */
    endAt?: number;
}
/** The tick granularity for boundary detection (the scheduler heartbeat). */
export declare const CRUISE_TICK_MS = 60000;
/** One calendar day (cross-midnight normalization). */
export declare const DAY_MS = 86400000;
/** Brand an unknown value as a valid window (persisted-state guard). */
export declare function isCruiseWindow(value: unknown): value is CruiseWindow;
/**
 * Normalize a window: a within-the-same-intent end earlier than the start is
 * a cross-midnight window (22:00 → 02:00 is legal) — yield the end on the
 * start's next day. An end more than a whole day BEFORE the start is NOT a
 * cross-midnight window; it is a date mistake (windowRangeIssueOf returns
 * 'end-too-early') and is left as-entered — the editor rejects it with a
 * specific message instead of the stale rule silently surviving as a
 * "everyday 22:00→01:00 of yesterday" artifact.
 */
export declare function normalizeWindow(window: CruiseWindow): CruiseWindow;
/**
 * A user-error window (input validation before the write point):
 * - 'both-empty'    → neither endpoint set;
 * - 'same-instant'  → start equals end (zero length; cross-midnight reads
 *   22:00 → 次日 22:00, never an ambiguous same moment);
 * - 'end-too-early' → the end lies more than one whole day BEFORE the start
 *   (dates are wrong — cross-midnight is at most one night);
 * - 'start-past'    → the start already passed (a missed boundary never
 *   silently pretends to fire; leave it blank = start now);
 * - 'end-past'      → the end already passed (nothing left to schedule).
 * undefined = the window is well-formed. Checked on the NORMALIZED window.
 */
export type CruiseWindowRangeIssue = 'both-empty' | 'same-instant' | 'end-too-early' | 'start-past' | 'end-past';
/** The one validation verdict for a (normalized) candidate window. */
export declare function windowRangeIssueOf(window: CruiseWindow, now: number): CruiseWindowRangeIssue | undefined;
/** Whether a window covers `now` (its appointment is live right now). */
export declare function isWindowActive(window: CruiseWindow, now: number): boolean;
/**
 * THE display grammar of a window — ONE clear line per shape, no
 * label-pairing that must be re-assembled by each surface:
 * - both set   → a range (start → end; a normalized cross-midnight end reads
 *   "次日" on the surface);
 * - only start → turns on at start and stays on;
 * - only end   → on since creation, off at end.
 */
export type CruiseWindowGrammar = {
    kind: 'range';
    startAt: number;
    endAt: number;
} | {
    kind: 'from-start';
    startAt: number;
} | {
    kind: 'until-end';
    endAt: number;
};
/** Derive one window's display grammar (see {@link CruiseWindowGrammar}). */
export declare function cruiseWindowGrammarOf(window: CruiseWindow): CruiseWindowGrammar;
/**
 * The sort key of one window: start-less (only-end = 立即开启) leads, then
 * windows ascend by start; a tie on start ascends by end, an open end
 * (stays on) last. The list order is derived — never a stored order.
 */
export declare function windowSortKeyOf(window: CruiseWindow): {
    start: number;
    end: number;
};
/** Whether a window is structurally empty (no start and no end). */
export declare function isEmptyWindow(window: CruiseWindow): boolean;
/**
 * The existing window a candidate duplicates (same normalized bounds), or
 * undefined. The single write point rejects exact duplicates — an identical
 * window adds no schedule and would only confuse the list; the cross-midnight
 * normalization is applied to both sides so "22:00 → 02:00" and its re-entry
 * match one another.
 */
export declare function duplicateWindowOf(windows: readonly CruiseWindow[], candidate: CruiseWindow): CruiseWindow | undefined;
/**
 * The window covering `now` (preferring the one ending latest; undefined =
 * off): a window covers when its start (if any) is not in the future and its
 * end (if any) is not in the past. A start-less window is on since minus
 * infinity (from now until its end); an end-less window extends to infinity
 * (on from its start).
 */
export declare function coveringWindow(state: CruiseState, now: number): CruiseWindow | undefined;
/**
 * Apply a manual toggle: flips `enabled` and records the MANUAL intent — the
 * window list is never written, so clicking 开启/关闭 cannot grow the
 * schedule. Manual ranks above the schedule between boundary events; the next
 * boundary takes over again (tickCruise clears `manual`).
 */
export declare function applyManualToggle(state: CruiseState, on: boolean): CruiseState;
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
export declare function tickCruise(state: CruiseState, now: number): CruiseState;
/**
 * Replace the window list (the editor's add/remove path): normalized
 * (cross-midnight) + sorted, empties dropped. v4 semantics — editing the
 * PLAN never flips the switch; the windows only flip it at their own
 * instants. The single exception: an ADDED start-less window (只填结束) has
 * its start instant AT CREATION — adding one fires the start boundary now
 * (cruise turns on, manual clears), because "立即开启、到点关" is exactly
 * what that window says. Removing windows leaves the switch untouched, so
 * manual on/off after clearing the plan always matches up.
 */
export declare function setCruiseSchedule(state: CruiseState, windows: readonly CruiseWindow[], now: number): CruiseState;
/**
 * THE status line of the cruise panel — one sentence that always explains WHY
 * the switch reads what it reads (the panel renders this verbatim):
 * - enabled + covering window with end  → "窗口开启中 · 至 {end}";
 * - enabled + open covering window      → held on (no end set);
 * - enabled + no covering               → manual on (no window constraint);
 * - disabled + covering                 → 已手动关闭 · 窗口仍生效；
 * - disabled + future start             → 关闭 · {start} 自动开启；
 * - disabled + nothing                  → off, no plan.
 */
export type CruiseStatusLine = {
    kind: 'window-on';
    endAt?: number;
} | {
    kind: 'manual-on';
} | {
    kind: 'manual-off';
    endAt?: number;
} | {
    kind: 'scheduled-off';
    startAt: number;
} | {
    kind: 'off';
};
export declare function cruiseStatusLineOf(state: CruiseState, now: number): CruiseStatusLine;
/** Sort windows: 立即开启 (start-less) first, then by start, then by end. */
export declare function sortWindows(windows: readonly CruiseWindow[]): CruiseWindow[];
