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
import { isEnglish } from '../locales.ts'

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
