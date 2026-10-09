/**
 * The three dates, and what they MEAN. One question with one answer: given a
 * row's three times and a clock, what is the truth about its schedule?
 *
 * WHY THIS IS ITS OWN MODULE. The checklist's other derivations are about rows
 * (what they are called, which page they sit on, how they group); these three
 * fields are about PROMISES, and they are the only place in the product where
 * two fields that look alike mean different things. 希望在 slipping is a plan that
 * moved; 不晚于 slipping is a commitment somebody else is waiting on. Rendering
 * both as the same red is the defect every mainstream task app is criticised
 * for, and once a reader sees that, the only rational move they have is to stop
 * setting dates at all. So the vocabulary for that distinction is stated once,
 * here, and every surface — the row line, the agenda, the triage strip, the
 * overview tile, and the model's query — reads it from this file.
 *
 * THE MODULE'S ONE CLOCK IS AN ARGUMENT. Nothing here reads `Date.now()`, so one
 * render, one `now`, and two rows cannot disagree about whether a day has
 * passed; and a test does not need a fake timer to pin a deadline verdict.
 */
import type { ItemDateConflict, ItemRecord } from './item.ts'
import { itemDateConflict } from './item.ts'

/** A whole day, in milliseconds — the unit every date verdict counts in. */
export const DAY_MS = 86_400_000

/** How far ahead a hard deadline counts as "soon". Amber, not red. */
export const HARD_SOON_DAYS = 7

/**
 * What the three date fields mean for a row RIGHT NOW.
 *
 * The three fields are three different promises and this is the single place
 * that says which promise is being broken. A missed soft `dueAt` is a plan that
 * slipped; a missed `hardDueAt` is a missed commitment. Rendering both as the
 * same red "overdue" is the defect every mainstream task app is criticised for
 * — it makes a date that a reader moves as normal planning indistinguishable
 * from a date that has an external consequence, and the reader's only remedy
 * is to stop setting dates at all.
 *
 * `hardDueAt` therefore outranks `dueAt` for the VERDICT, and a row carrying
 * both still reports the soft one as {@link DatePosture.soft}.
 */
export type DatePosture =
  /**
   * The three dates cannot all be true: a start date after the wanted-by date,
   * or a wanted-by date after the hard deadline.
   *
   * This branch comes FIRST, before every other verdict, because a row that
   * contradicts itself has no honest "how late is it" answer and picking one
   * anyway would draw a confident schedule built on impossible data. The
   * document deliberately does not repair such a row — rearranging the reader's
   * three dates and reporting success is worse than leaving them visible, and
   * dropping the row over a date field is worse still — so this is where the
   * truth is finally said, in the one place that can see all three fields.
   */
  | { readonly kind: 'contradiction'; readonly conflict: ItemDateConflict }
  /** No date on the row at all: the reader never made a promise. */
  | { readonly kind: 'none' }
  /** `startsAfter` is still in the future — by definition it cannot be touched. */
  | { readonly kind: 'gated'; readonly startsAfter: number }
  /** The hard deadline has passed. The only verdict that may read as an alarm. */
  | { readonly kind: 'hardOverdue'; readonly at: number; readonly days: number }
  /** The hard deadline is inside {@link HARD_SOON_DAYS}. Worth noticing, not yet late. */
  | { readonly kind: 'hardSoon'; readonly at: number; readonly days: number }
  /** The hard deadline is set and comfortably ahead. */
  | { readonly kind: 'hardAhead'; readonly at: number; readonly days: number }
  /** The wanted-by date is today. */
  | { readonly kind: 'dueToday'; readonly at: number }
  /** The wanted-by date passed: behind plan, which is not the same as overdue. */
  | { readonly kind: 'behind'; readonly at: number; readonly days: number }
  /** The wanted-by date is ahead. */
  | { readonly kind: 'upcoming'; readonly at: number; readonly days: number }

/** The soft `dueAt` read separately, so a row with both dates says both. */
export interface SoftPosture {
  readonly at: number | undefined
  readonly days: number | undefined
  readonly overdue: boolean
  readonly today: boolean
}

/**
 * Start of the LOCAL calendar day containing `at`, in milliseconds.
 *
 * THE DATE UNIT IN THIS PRODUCT IS A DAY, typed by a person and edited through
 * `<input type="date">`, so every day boundary is a local midnight. This was
 * written out by hand in two surfaces — the agenda's bucketing and the capture
 * box's 「今天」 — and a day boundary written out twice is a day boundary that
 * will be written out a third time slightly differently. It is exported so
 * there is exactly one of them.
 *
 * Comparing these as UTC instants is the classic bug: a reader in any
 * negative-offset zone lands a day early, and a bare `toISOString().slice(0,10)`
 * is exactly that mistake with the type system out of the picture.
 * @param at - any instant in the day being asked about.
 * @returns that day's local midnight.
 */
export function startOfDay(at: number): number {
  const date = new Date(at)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** Whole days between two instants, truncated toward zero, never negative. */
export function daysBetween(at: number, now: number): number {
  return Math.floor(Math.abs(at - now) / DAY_MS)
}

/** True when two instants fall on the same calendar day in the local zone. */
export function sameLocalDay(a: number, b: number): boolean {
  const first = new Date(a)
  const second = new Date(b)
  return first.getFullYear() === second.getFullYear()
    && first.getMonth() === second.getMonth()
    && first.getDate() === second.getDate()
}

/**
 * The soft date, read apart from the verdict.
 *
 * Kept separate because a row with a hard deadline AND a wanted-by date is the
 * normal shape for real work, and collapsing the two into one chip is what
 * makes the row say only half of what the reader set.
 * @param item - the row.
 * @param now - the reading clock.
 * @returns the soft date's own standing.
 */
export function softPostureOf(item: ItemRecord, now: number): SoftPosture {
  const at = item.dueAt
  if (at === undefined) return { at: undefined, days: undefined, overdue: false, today: false }
  const today = sameLocalDay(at, now)
  return { at, days: today ? 0 : daysBetween(at, now), overdue: at < now && !today, today }
}

/**
 * The one verdict the row's right side speaks.
 *
 * Precedence, in order: a row whose own dates contradict each other, then a
 * gate that has not opened, then the hard deadline (passed / soon / ahead), then
 * the soft date (today / passed / ahead). The first two come first because they
 * are the two cases where there is no verdict to give — the row is either
 * impossible or not yet startable, and picking a date out of either one would be
 * a confident answer to a question nobody asked.
 *
 * The hard deadline outranks the soft one for the VERDICT, because a missed hard
 * deadline is the only one a reader cannot re-negotiate by themselves.
 * @param item - the row.
 * @param now - the reading clock.
 * @returns what the row's date situation is.
 */
export function datePostureOf(item: ItemRecord, now: number): DatePosture {
  // The document keeps a row whose three dates contradict each other exactly as
  // written, so somebody has to say so. This is that place.
  const conflict = itemDateConflict(item)
  if (conflict !== undefined) return { kind: 'contradiction', conflict }
  // A gate outranks everything that remains: a row that may not be started
  // cannot be late.
  if (item.startsAfter !== undefined && item.startsAfter > now) {
    return { kind: 'gated', startsAfter: item.startsAfter }
  }
  if (item.hardDueAt !== undefined) {
    const at = item.hardDueAt
    if (at < now) return { kind: 'hardOverdue', at, days: daysBetween(at, now) }
    if (at - now <= HARD_SOON_DAYS * DAY_MS) return { kind: 'hardSoon', at, days: daysBetween(at, now) }
    return { kind: 'hardAhead', at, days: daysBetween(at, now) }
  }
  if (item.dueAt === undefined) return { kind: 'none' }
  const at = item.dueAt
  if (sameLocalDay(at, now)) return { kind: 'dueToday', at }
  if (at < now) return { kind: 'behind', at, days: daysBetween(at, now) }
  return { kind: 'upcoming', at, days: daysBetween(at, now) }
}
