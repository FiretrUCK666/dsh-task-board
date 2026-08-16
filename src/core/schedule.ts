/**
 * Minimal 5-field cron parsing and next-run computation for scheduled task
 * runs. Framework-free and dependency-free so the scheduler and controller
 * share one tiny pure module.
 *
 * Grammar: five whitespace-separated fields, 分 时 日 月 周. Every field
 * supports the wildcard, step (wildcard or range + "/n"), single value,
 * inclusive range a-b, and comma lists mixing any of those. Ranges: minutes
 * 0-59, hours 0-23, days 1-31, months 1-12, weekdays 0-7 (0 and 7 both mean
 * Sunday). When both the day and weekday fields are restricted they combine
 * with OR semantics (standard cron). Invalid expressions parse to null and
 * are rejected by the UI/controller.
 */

/** The parsed match sets of one cron expression. */
export interface CronSchedule {
  minutes: ReadonlySet<number>
  hours: ReadonlySet<number>
  days: ReadonlySet<number>
  months: ReadonlySet<number>
  /** Weekdays 0-6, 0 = Sunday (input 7 normalized to 0). */
  weekdays: ReadonlySet<number>
  /** Whether the day-of-month field was the literal '*' (unrestricted). */
  dayWildcard: boolean
  /** Whether the weekday field was the literal '*' (unrestricted). */
  weekdayWildcard: boolean
}

/** Inclusive ranges per field, in cron order. */
const FIELD_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0, 59], // minutes
  [0, 23], // hours
  [1, 31], // days
  [1, 12], // months
  [0, 7], // weekdays (7 = Sunday, normalized below)
]

/**
 * Parse a 5-field cron expression.
 * @returns the match sets, or null when the expression is invalid.
 */
export function parseCron(expr: string): CronSchedule | null {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) return null
  const sets: Set<number>[] = []
  for (let index = 0; index < 5; index++) {
    const [min, max] = FIELD_RANGES[index]
    const set = new Set<number>()
    if (!parseField(fields[index], min, max, set)) return null
    sets.push(set)
  }
  const weekdays = new Set<number>()
  for (const day of sets[4]) weekdays.add(day === 7 ? 0 : day)
  return {
    minutes: sets[0],
    hours: sets[1],
    days: sets[2],
    months: sets[3],
    weekdays,
    // Only the literal '*' marks a field unrestricted: an explicit full
    // enumeration such as '1-31' is a restricted field and must not collapse
    // into the wildcard (it participates in day/weekday OR semantics).
    dayWildcard: fields[2] === '*',
    weekdayWildcard: fields[4] === '*',
  }
}

/** Whether the expression parses. */
export function isValidCron(expr: string): boolean {
  return parseCron(expr) !== null
}

/** A human-readable description of a cron expression (see describeCron). */
export type CronDescription =
  | { kind: 'everyMinute' }
  | { kind: 'everyMinutes'; minutes: number }
  | { kind: 'everyHours'; hours: number }
  | { kind: 'dailyAt'; time: string }
  | { kind: 'weekdaysAt'; time: string }
  | { kind: 'weeklyAt'; weekdays: readonly number[]; time: string }
  | { kind: 'monthlyAt'; days: readonly number[]; time: string }
  | { kind: 'custom' }

/** Whether a set is an evenly spaced arithmetic sequence. */
function arithmeticStep(values: ReadonlySet<number>): number | undefined {
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length < 2) return undefined
  const step = sorted[1] - sorted[0]
  if (step < 1) return undefined
  for (let index = 1; index < sorted.length; index++) {
    if (sorted[index] - sorted[index - 1] !== step) return undefined
  }
  return step
}

const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24

/**
 * Describe a cron expression in human terms: every N minutes/hours, daily
 * at a time, on weekdays, weekly on fixed weekdays, or monthly on fixed
 * days. Returns `{ kind: 'custom' }` for valid-but-unusual expressions and
 * undefined for invalid ones. The UI renders the description through its
 * own locale templates.
 */
export function describeCron(expr: string): CronDescription | undefined {
  const schedule = parseCron(expr)
  if (schedule === null) return undefined
  const { minutes, hours, days, months, weekdays, dayWildcard, weekdayWildcard } = schedule
  const time = (hour: number, minute: number): string =>
    `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  const allMonths = months.size === 12
  const allDays = days.size === 31 && dayWildcard
  const allWeekdays = weekdays.size === 7 && weekdayWildcard

  // Unrestricted day/weekday/month axis: pure frequency or daily patterns.
  if (allDays && allWeekdays && allMonths) {
    if (minutes.size === MINUTES_PER_HOUR) return { kind: 'everyMinute' }
    const minuteStep = arithmeticStep(minutes)
    if (minuteStep !== undefined && minuteStep * minutes.size === MINUTES_PER_HOUR) {
      return { kind: 'everyMinutes', minutes: minuteStep }
    }
    if (minutes.size === 1) {
      const minute = [...minutes][0]
      if (hours.size === HOURS_PER_DAY) return { kind: 'everyHours', hours: 1 }
      const hourStep = arithmeticStep(hours)
      if (hourStep !== undefined && hourStep * hours.size === HOURS_PER_DAY) {
        return { kind: 'everyHours', hours: hourStep }
      }
      if (hours.size === 1) return { kind: 'dailyAt', time: time([...hours][0], minute) }
    }
    return { kind: 'custom' }
  }

  // Fixed time on restricted day/weekday axes (daily/weekly/monthly shapes).
  if (minutes.size === 1 && hours.size === 1 && allMonths) {
    const minute = [...minutes][0]
    const hour = [...hours][0]
    if (allDays && !weekdayWildcard) {
      const weekdaysSorted = [...weekdays].sort((a, b) => a - b)
      const isWorkdays = weekdaysSorted.length === 5
        && weekdaysSorted.every((day, index) => day === index + 1)
      if (isWorkdays) return { kind: 'weekdaysAt', time: time(hour, minute) }
      return { kind: 'weeklyAt', weekdays: weekdaysSorted, time: time(hour, minute) }
    }
    if (allWeekdays && !dayWildcard) {
      return { kind: 'monthlyAt', days: [...days].sort((a, b) => a - b), time: time(hour, minute) }
    }
  }

  return { kind: 'custom' }
}

/**
 * Compute the next matching instant after `fromMs` (ms epoch), in local time,
 * at minute granularity, strictly greater than `fromMs`. Returns the ms epoch
 * of the matching minute's start, or undefined when nothing matches within
 * 366 days (e.g. `0 0 30 2 *`).
 */
export function nextRunAtMs(expr: string, fromMs: number): number | undefined {
  const schedule = parseCron(expr)
  if (schedule === null) return undefined
  const from = new Date(fromMs)
  // Scan from the next minute; Date rolls overflow (Feb 30 → Mar 2) for free.
  const scan = new Date(from.getFullYear(), from.getMonth(), from.getDate(), from.getHours(), from.getMinutes() + 1, 0, 0)
  const limitMs = fromMs + 366 * 24 * 60 * 60 * 1000
  while (scan.getTime() <= limitMs) {
    if (matches(schedule, scan)) return scan.getTime()
    scan.setMinutes(scan.getMinutes() + 1)
  }
  return undefined
}

/** Parse one comma-list field into the match set. */
function parseField(field: string, min: number, max: number, out: Set<number>): boolean {
  if (field === '*') {
    for (let value = min; value <= max; value++) out.add(value)
    return true
  }
  for (const part of field.split(',')) {
    if (part === '') return false
    const [range, stepRaw] = part.split('/')
    let low: number
    let high: number
    if (range === '*') {
      low = min
      high = max
    } else if (range.includes('-')) {
      const [a, b] = range.split('-')
      if (a === '' || b === '' || !isDigits(a) || !isDigits(b)) return false
      low = Number(a)
      high = Number(b)
    } else if (isDigits(range)) {
      low = Number(range)
      high = Number(range)
    } else {
      return false
    }
    if (low < min || high > max || low > high) return false
    const step = stepRaw === undefined ? 1 : isDigits(stepRaw) ? Number(stepRaw) : NaN
    if (!Number.isInteger(step) || step < 1) return false
    for (let value = low; value <= high; value += step) out.add(value)
  }
  return true
}

/** Day/weekday OR semantics: a restricted day field alone gates, and vice versa. */
function matches(schedule: CronSchedule, date: Date): boolean {
  if (!schedule.minutes.has(date.getMinutes())) return false
  if (!schedule.hours.has(date.getHours())) return false
  if (!schedule.months.has(date.getMonth() + 1)) return false
  const dayMatches = schedule.days.has(date.getDate())
  const weekdayMatches = schedule.weekdays.has(date.getDay())
  if (schedule.dayWildcard) return weekdayMatches
  if (schedule.weekdayWildcard) return dayMatches
  return dayMatches || weekdayMatches
}

function isDigits(value: string): boolean {
  return /^\d+$/.test(value)
}
