/**
 * THE time-formatting module: every clock/label grammar of the board lives
 * here, never in a component. Two families:
 * - exact/local labels (`formatDateTime`, `formatDuration`) and the compact
 *   relative label (`formatTime`) used by cards, details and threads;
 * - compact cruise-time formatting (`formatCruiseTime`): window rows and the
 *   popover status line need both endpoints readable at a glance inside a
 *   ~300px popover — the full `YYYY-MM-DD HH:mm:ss` is too long next to the
 *   arrow and the remove button, so cruise surfaces use the short form —
 *   today collapses to the clock, any other day to month/day, cross-year
 *   adds the year. The exact value is always reachable through the
 *   element's `title`. Locale-aware (zh numeric-locale style vs en M/D),
 *   framework-free so it unit-tests in isolation.
 */
import { type CruiseWindow } from '../../core/cruise.ts';
/** Compact relative/absolute time label: just now → `Nm` → `Nh` → `Y-M-D`. */
export declare function formatTime(ms: number): string;
/** Exact local time label: `YYYY-MM-DD HH:mm:ss`. */
export declare function formatDateTime(ms: number): string;
/** Compact calendar-date label (day only, never a clock): `M月D日` / `M/D`
 *  same-year, year-prefixed across years. THE date half of the cruise
 *  grammar, split out so due dates never inherit a meaningless 00:00.
 */
export declare function formatDayLabel(ms: number, now?: number): string;
/** Human duration label (zh: `X 分 Y 秒`; en: `Xm Ys`). */
export declare function formatDuration(ms: number): string;
/** Compact cruise time label: `HH:mm` when same-day, `M月D日 HH:mm` /
 *  `M/D HH:mm` when same-year, full date otherwise. */
export declare function formatCruiseTime(ms: number, now?: number): string;
/** Whether `b` lies on the calendar day IMMEDIATELY AFTER `a` (a's 日历日 + 1,
 *  month/year rollovers included) — the ONE rule the "次日" display word
 *  obeys: a cross-midnight night (22:00 → 02:00, normalized +1 day) and an
 *  explicitly filled next-morning end both read 次日, while an end two days
 *  or a month later shows its REAL date (the "结束晚 33 天也显示次日" bug).
 *  Ends at or before the start are never "next day". */
export declare function isNextDay(a: number, b: number): boolean;
/** ONE line of copy per cruise window — the list's single grammar:
 *  both set → "{start} → {end}" (a cross-midnight end reads 次日/next day);
 *  only start → "{time} 起保持开启" / "From {time}, stays on";
 *  only end → "已开启 · 至 {time}" / "On now · until {time}" (added = live);
 *  a LIVE window (covering now) leads with "生效中 ·" / "active ·".
 *  Pure (locale + a fixed `now`) so the exact strings are testable in both
 *  languages; the full instants stay in the element's `title`. */
export declare function cruiseWindowLabelOf(window: CruiseWindow, now?: number): string;
