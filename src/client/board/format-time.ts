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
import { cruiseWindowGrammarOf, isWindowActive, type CruiseWindow } from '../../core/cruise.ts'
import { isEnglish, t } from '../locales.ts'

const pad = (value: number): string => String(value).padStart(2, '0')

/** Compact relative/absolute time label: just now → `Nm` → `Nh` → `Y-M-D`. */
export function formatTime(ms: number): string {
  const date = new Date(ms)
  const now = Date.now()
  const minutes = Math.floor((now - ms) / 60000)
  if (minutes < 1) return t('time.justNow')
  if (minutes < 60) return `${minutes}m`
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Exact local time label: `YYYY-MM-DD HH:mm:ss`. */
export function formatDateTime(ms: number): string {
  const date = new Date(ms)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** Start of the local calendar day containing `ms`. */
function startOfLocalDay(ms: number): number {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** Compact calendar-date label (day only, never a clock): `M月D日` / `M/D`
 *  same-year, year-prefixed across years. THE date half of the cruise
 *  grammar, split out so due dates never inherit a meaningless 00:00.
 */
export function formatDayLabel(ms: number, now: number = Date.now()): string {
  const date = new Date(ms)
  const base = new Date(now)
  if (date.getFullYear() === base.getFullYear()) {
    return isEnglish()
      ? `${date.getMonth() + 1}/${date.getDate()}`
      : `${date.getMonth() + 1}月${date.getDate()}日`
  }
  return isEnglish()
    ? `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
    : `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

/** Compact due-date label (day granularity): today reads 今天到期/Due today,
 *  past days read 逾期 N 天/Nd overdue, future days read the calendar date
 *  (a due is a day, not an instant — no clock). Pure. */
export function formatDueLabel(dueAt: number, now: number = Date.now()): string {
  const days = Math.round((startOfLocalDay(dueAt) - startOfLocalDay(now)) / 86_400_000)
  if (days === 0) return t('board.dueToday')
  if (days < 0) return t('board.dueOverdue', { n: String(-days) })
  return formatDayLabel(dueAt, now)
}

/** Human duration label (zh: `X 分 Y 秒`; en: `Xm Ys`). */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return isEnglish() ? `${hours}h ${minutes}m` : `${hours} 小时 ${minutes} 分`
  if (minutes > 0) {
    return isEnglish()
      ? seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
      : seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`
  }
  return isEnglish() ? `${seconds}s` : `${seconds} 秒`
}

/** Compact cruise time label: `HH:mm` when same-day, `M月D日 HH:mm` /
 *  `M/D HH:mm` when same-year, full date otherwise. */
export function formatCruiseTime(ms: number, now = Date.now()): string {
  const date = new Date(ms)
  const base = new Date(now)
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const sameDay = date.getFullYear() === base.getFullYear()
    && date.getMonth() === base.getMonth()
    && date.getDate() === base.getDate()
  if (sameDay) return clock
  if (date.getFullYear() === base.getFullYear()) {
    return isEnglish()
      ? `${date.getMonth() + 1}/${date.getDate()} ${clock}`
      : `${date.getMonth() + 1}月${date.getDate()}日 ${clock}`
  }
  return isEnglish()
    ? `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${clock}`
    : `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${clock}`
}

/** Whether `b` lies on the calendar day IMMEDIATELY AFTER `a` (a's 日历日 + 1,
 *  month/year rollovers included) — the ONE rule the "次日" display word
 *  obeys: a cross-midnight night (22:00 → 02:00, normalized +1 day) and an
 *  explicitly filled next-morning end both read 次日, while an end two days
 *  or a month later shows its REAL date (the "结束晚 33 天也显示次日" bug).
 *  Ends at or before the start are never "next day". */
export function isNextDay(a: number, b: number): boolean {
  const from = new Date(a)
  const to = new Date(b)
  if (to.getTime() <= from.getTime()) return false
  const previous = new Date(to)
  previous.setDate(previous.getDate() - 1)
  return previous.getFullYear() === from.getFullYear()
    && previous.getMonth() === from.getMonth()
    && previous.getDate() === from.getDate()
}

/** ONE line of copy per cruise window — the list's single grammar:
 *  both set → "{start} → {end}" (a cross-midnight end reads 次日/next day);
 *  only start → "{time} 起保持开启" / "From {time}, stays on";
 *  only end → "已开启 · 至 {time}" / "On now · until {time}" (added = live);
 *  a LIVE window (covering now) leads with "生效中 ·" / "active ·".
 *  Pure (locale + a fixed `now`) so the exact strings are testable in both
 *  languages; the full instants stay in the element's `title`. */
export function cruiseWindowLabelOf(window: CruiseWindow, now = Date.now()): string {
  const grammar = cruiseWindowGrammarOf(window)
  // A live window leads with "生效中 ·"; the until-end shape already claims
  // 已开启 in its own words (it IS live from creation), so it carries no
  // extra prefix — one active marker per line, never two.
  const prefix = grammar.kind !== 'until-end' && isWindowActive(window, now)
    ? `${t('board.cruiseWindowActive')} · `
    : ''
  if (grammar.kind === 'range') {
    // The end is anchored to the START's calendar day: a next-midnight end
    // reads "次日 02:00" (the 次日 word IS the date bump), never a redundant
    // "次日 1月6日 02:00" — a clock-only end with its own day as the base.
    const end = isNextDay(grammar.startAt, grammar.endAt)
      ? `${t('board.cruiseNextDay')} ${formatCruiseTime(grammar.endAt, grammar.endAt)}`
      : formatCruiseTime(grammar.endAt, grammar.startAt)
    return `${prefix}${t('board.cruiseWindowRange', { start: formatCruiseTime(grammar.startAt, now), end })}`
  }
  if (grammar.kind === 'from-start') {
    return `${prefix}${t('board.cruiseWindowFromStart', { time: formatCruiseTime(grammar.startAt, now) })}`
  }
  return t('board.cruiseWindowOnlyEnd', { time: formatCruiseTime(grammar.endAt, now) })
}
