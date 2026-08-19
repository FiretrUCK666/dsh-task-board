/**
 * Free-typed time parsing for the cruise TimeField, plus the canonical text
 * formatting. The field reads like any text input: type a time, press Enter
 * or blur, done. Accepts the common short forms and normalizes them; anything
 * unparseable returns undefined (the caller flags it inline, never swallows
 * the user's text). Pure and framework-free so it unit-tests in isolation.
 */

/** Format an epoch millisecond as the field's canonical text (`YYYY-MM-DD HH:mm`). */
export function formatTimeInput(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * Parse a free-typed time text into epoch ms (minute precision):
 * - `HH:mm`              → today at that clock
 * - `MM-DD HH:mm`        → this year
 * - `YYYY-MM-DD HH:mm`   → exact (also accepts a `T` separator)
 * - empty / whitespace   → undefined (a clear, not an error)
 * Any other text returns undefined, meaning "unparseable".
 */
export function parseTimeText(text: string, now = Date.now()): number | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  const exact = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/.exec(trimmed)
  if (exact !== null) {
    return compose(exact[1], exact[2], exact[3], exact[4], exact[5])
  }
  const monthDay = /^(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/.exec(trimmed)
  if (monthDay !== null) {
    const base = new Date(now)
    return compose(String(base.getFullYear()), monthDay[1], monthDay[2], monthDay[3], monthDay[4])
  }
  const clock = /^(\d{1,2}):(\d{2})$/.exec(trimmed)
  if (clock !== null) {
    const base = new Date(now)
    return compose(String(base.getFullYear()), String(base.getMonth() + 1), String(base.getDate()), clock[1], clock[2])
  }
  return undefined
}

/** Compose validated fields into epoch ms; rejects impossible dates (02-30). */
function compose(year: string, month: string, day: string, hour: string, minute: string): number | undefined {
  const y = Number(year)
  const mo = Number(month)
  const d = Number(day)
  const h = Number(hour)
  const mi = Number(minute)
  if (!Number.isInteger(y) || !Number.isInteger(mo) || !Number.isInteger(d) || !Number.isInteger(h) || !Number.isInteger(mi)) return undefined
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h < 0 || h > 23 || mi < 0 || mi > 59) return undefined
  const date = new Date(y, mo - 1, d, h, mi, 0, 0)
  // Overflowing dates (e.g. 02-30) wrap silently — reject by round-trip.
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return undefined
  return date.getTime()
}