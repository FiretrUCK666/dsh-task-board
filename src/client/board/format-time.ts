/**
 * Compact cruise-time formatting: window rows and the popover status line
 * need both endpoints readable at a glance inside a ~300px popover. The full
 * `YYYY-MM-DD HH:mm:ss` from formatDateTime is too long to sit next to the
 * arrow and the remove button, so cruise surfaces use this short form —
 * today collapses to the clock, any other day to month/day, cross-year adds
 * the year. The exact value is always reachable through the element's
 * `title`. Locale-aware (zh numeric-locale style vs en M/D), framework-free
 * so it unit-tests in isolation.
 */
import { cruiseWindowGrammarOf, type CruiseWindow } from '../../core/cruise.ts'
import { isEnglish, t } from '../locales.ts'

const pad = (value: number): string => String(value).padStart(2, '0')

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

/** Whether `b` lies on the calendar day AFTER `a` — the cross-midnight
 *  display rule: a normalized window ending at 02:00 started at 22:00 the
 *  previous day reads "次日 02:00" / "next day 02:00". */
export function isNextDay(a: number, b: number): boolean {
  const from = new Date(a)
  const to = new Date(b)
  if (to.getTime() <= from.getTime()) return false
  return to.getFullYear() !== from.getFullYear()
    || to.getMonth() !== from.getMonth()
    || to.getDate() !== from.getDate()
}

/** ONE line of copy per cruise window — the list's single grammar:
 *  both set → "{start} → {end}" (a cross-midnight end reads 次日/next day);
 *  only start → "{time} 起保持开启" / "From {time}, stays on";
 *  only end → "现在开启 · 至 {time}" / "On now · until {time}".
 *  Pure (locale + a fixed `now`) so the exact strings are testable in both
 *  languages; the full instants stay in the element's `title`. */
export function cruiseWindowLabelOf(window: CruiseWindow, now = Date.now()): string {
  const grammar = cruiseWindowGrammarOf(window)
  if (grammar.kind === 'range') {
    // The end is anchored to the START's calendar day: a next-midnight end
    // reads "次日 02:00" (the 次日 word IS the date bump), never a redundant
    // "次日 1月6日 02:00" — a clock-only end with its own day as the base.
    const end = isNextDay(grammar.startAt, grammar.endAt)
      ? `${t('board.cruiseNextDay')} ${formatCruiseTime(grammar.endAt, grammar.endAt)}`
      : formatCruiseTime(grammar.endAt, grammar.startAt)
    return t('board.cruiseWindowRange', { start: formatCruiseTime(grammar.startAt, now), end })
  }
  if (grammar.kind === 'from-start') {
    return t('board.cruiseWindowFromStart', { time: formatCruiseTime(grammar.startAt, now) })
  }
  return t('board.cruiseWindowOnlyEnd', { time: formatCruiseTime(grammar.endAt, now) })
}
