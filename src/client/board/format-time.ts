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

/** The next whole hour boundary (for prefilling the window-start picker):
 *  the next hour tick after `now` — e.g. 14:23 → 15:00. */
export function nextWholeHour(now = Date.now()): number {
  const date = new Date(now)
  date.setMinutes(0, 0, 0)
  date.setHours(date.getHours() + 1)
  return date.getTime()
}

/** An epoch millisecond as a `datetime-local` input value (`YYYY-MM-DDTHH:mm` —
 *  the picker's native granularity is minutes). */
export function toDatetimeLocal(ms: number): string {
  const date = new Date(ms)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
