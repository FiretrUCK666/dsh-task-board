/**
 * The triage strip: the sentences a reader has to act on, each with the list it
 * opens.
 *
 * WHY EVERY LINE HERE CARRIES AN ACTION. A number a reader cannot act on is a
 * scoreboard, and a scoreboard on a personal list rewards opening the app rather
 * than finishing anything. So a line is never a bare number: it is emitted
 * together with the filter it opens and the rows it counted, and that is also
 * what makes the count and the jump the SAME predicate — the filter it writes is
 * the `ItemFlag` this line is filed under, and `item-query.ts` judges that flag
 * with the same scope this module counted with.
 *
 * ONLY LINES WITH SOMETHING IN THEM EXIST. A strip that lists four zeros is four
 * rows of chrome saying nothing, and the reader learns to skip it. An empty
 * answer is a sentence on its own ("nothing is waiting"), which is a different
 * thing from four empty rows.
 */
import type { ItemRecord } from './item.ts'
import { datePostureOf } from './item-dates.ts'
import { DEFAULT_STALE_DAYS, staleDaysOf, staleItemsOf } from './item-stale.ts'
import { isInboxItem, isLiveItem } from './item-membership.ts'
import type { ItemFlag } from './item-query.ts'

/** How loudly a triage line is allowed to speak. */
export type TriageSeverity = 'warn' | 'muted'

/**
 * One line of the triage strip: a sentence, a count, and the list it opens.
 */
export interface TriageLine {
  /** Stable id, also the filter this line applies. */
  readonly id: ItemFlag
  readonly count: number
  readonly severity: TriageSeverity
  /** The rows the line is about, so the jump shows exactly what the count counted. */
  readonly items: readonly ItemRecord[]
  /** The oldest untouched days among them, when the line is about neglect. */
  readonly worstDays: number | undefined
}

/**
 * The lines the reader has to act on, loudest first, and nothing else.
 *
 * The `undated` line is here and NOT in the plan, because "no date" is a
 * decision the reader has not made yet, and it is the one line a reader can
 * always clear: schedule it, park it, or delete it.
 * @param items - every row in the document.
 * @param now - the reading clock.
 * @param staleDays - the neglect threshold.
 * @returns the lines, loudest first.
 */
export function triageLinesOf(items: readonly ItemRecord[], now: number, staleDays: number = DEFAULT_STALE_DAYS): TriageLine[] {
  return allTriageLinesOf(items, now, staleDays).filter(line => line.count > 0)
}

/**
 * The same four lines, INCLUDING the ones whose count is zero.
 *
 * **THE ZEROS ARE FILTERED AT THE CALL SITE, NOT HERE, because two callers ask two
 * different questions.** The 「要处理」 band asks 「有没有话要说」— a band with nothing in
 * it is a paragraph about nothing, so it takes the filtered list. The stat cards ask
 * 「这三件事各是几件」— and **a card must not disappear because its own answer is
 * zero**, or a page whose work is all on track looks exactly like a page whose
 * triage strip stopped rendering.
 *
 * That distinction was lost once: `triageLinesOf` dropped the zeros, the stat band
 * filtered again on its own side (belt and braces, so the bug could not show), and
 * the two together made 「三张卡」 into 「最多画三张」. Removing the second filter
 * changed nothing, because the zeros were already gone before they arrived. **The
 * duplicate guard was the reason it stayed broken: a defect defended twice looks
 * defended once.**
 */
export function allTriageLinesOf(items: readonly ItemRecord[], now: number, staleDays: number = DEFAULT_STALE_DAYS): TriageLine[] {
  // Only unfinished work can be waiting on the reader. A finished row that once
  // sat behind a date is a fact about the past, and listing it under "behind"
  // would nag about something the reader already did.
  const live = items.filter(isLiveItem)
  const behind = live.filter(item => datePostureOf(item, now).kind === 'behind')
  const blocked = live.filter(item => item.status === 'blocked')
  const stale = staleItemsOf(live, now, staleDays)
  // "No date" exempts a row that is still a bare capture, for the same reason
  // neglect does: a thought the reader wrote a minute ago has not failed to be
  // scheduled, it has not been READ twice yet. Telling someone their own new
  // note is undated is nagging about a decision they have not had the chance to
  // make — and a line that fires on everything the reader just wrote is a line
  // they switch off, which loses the genuinely undated work with it. A capture
  // that goes on to sit untouched is caught by the `stale` line instead, where
  // it belongs: the two lines answer two different questions and together they
  // cover the case.
  const undated = live.filter(item => datePostureOf(item, now).kind === 'none' && !isInboxItem(item))
  return [
    { id: 'behind', count: behind.length, severity: 'warn', items: behind, worstDays: worstOf(behind, now) },
    { id: 'stale', count: stale.length, severity: 'warn', items: stale, worstDays: worstOf(stale, now) },
    { id: 'blocked', count: blocked.length, severity: 'warn', items: blocked, worstDays: worstOf(blocked, now) },
    { id: 'undated', count: undated.length, severity: 'muted', items: undated, worstDays: undefined },
  ]
}

/** The oldest untouched run among a set, which is the number worth saying. */
function worstOf(rows: readonly ItemRecord[], now: number): number | undefined {
  let worst: number | undefined
  for (const row of rows) {
    const days = staleDaysOf(row, now)
    if (days !== undefined && (worst === undefined || days > worst)) worst = days
  }
  return worst
}
