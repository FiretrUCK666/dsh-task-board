/**
 * What ONE ROW SAYS, and how a set of rows groups into the four runs a list
 * page draws.
 *
 * WHY PROJECTION IS SEPARATE FROM MEMBERSHIP AND FROM ORDERING. A row draws six
 * things (its name, its derived status, its progress, its date verdict, its
 * neglect, whether it deserves a priority chip) and each of them is answered by a
 * different module. If the row assembled them itself it would be a sixth place
 * that had to be kept in step with the five, and the mismatch that produces is
 * the one a reader sees first: a row whose header says 待办 and whose line says
 * 进行中. So the row is assembled once, here, from the other modules' answers.
 *
 * GROUPING LIVES HERE TOO because a group is the other half of a row: the four
 * runs are four DERIVED statuses, and a group count that disagrees with the rows
 * under it sends the reader to an empty group — which is why the buckets below
 * filter through {@link itemMatches} and bucket by {@link derivedStatusOf},
 * exactly as the projection and the query do, rather than re-deciding either.
 */
import type { ItemRecord, ItemStatusView } from './item.ts'
import { itemProgressOf, itemTitleOf } from './item.ts'
import { datePostureOf, type DatePosture, type SoftPosture } from './item-dates.ts'
import { softPostureOf } from './item-dates.ts'
import { staleDaysOf } from './item-stale.ts'
import { sortItemsOf, type ItemSort } from './item-sort.ts'
import { derivedStatusOf } from './item-membership.ts'
import { itemMatches, type ItemMatchContext, type ItemQuery } from './item-query.ts'

/** The short number a row is called by, or the unnumbered placeholder. */
export interface ItemRef {
  /** `#12`, or `undefined` while the document has not numbered it yet. */
  readonly text: string | undefined
  /** Whether a number exists yet. A row the host has not numbered shows a dash. */
  readonly numbered: boolean
}

/**
 * How a row names itself.
 *
 * The number is minted by the document, so a row the reader JUST created has
 * none yet — `ref: 0` is the document's way of saying "nobody has numbered me".
 * That is a fact about the storage, not about the work, and a row that shows
 * `#0` on screen is quoting the ledger at the reader. So the projection carries
 * a separate `numbered` flag and the row draws a neutral placeholder instead.
 *
 * There is deliberately no `number` field: nothing outside this module ever
 * needed the bare integer, and a second spelling of the same name on the same
 * object is one more thing that can be right while `text` is wrong.
 * @param item - the row.
 * @returns what to show, and whether a number exists.
 */
export function itemRefOf(item: ItemRecord): ItemRef {
  const numbered = Number.isInteger(item.ref) && item.ref > 0
  return { text: numbered ? `#${item.ref}` : undefined, numbered }
}

/** What one row says, decided once. */
export interface ItemRowView {
  readonly item: ItemRecord
  readonly ref: ItemRef
  /** Never blank: an untitled row borrows its body's first line. */
  readonly title: string
  /** The derived status, in-progress included (a linked running card). */
  readonly status: ItemStatusView
  /** The one date verdict. `undefined` when the row has no steps. */
  readonly progress: { readonly done: number; readonly total: number; readonly ratio: number } | undefined
  readonly posture: DatePosture
  readonly soft: SoftPosture
  /** Untouched days, or `undefined` when the row is exempt or too old. */
  readonly staleDays: number | undefined
  /** Whether the row should be given a priority chip at all. */
  readonly priorityLoud: boolean
}

/** The reading context one row is projected against. */
export interface ItemRowContext {
  readonly now: number
  /** Whether the linked board card is running, keyed by card id. */
  readonly running: ReadonlyMap<string, boolean>
}

/**
 * Build one row's view.
 *
 * Every judgment the row draws is made here and nowhere else, so a row cannot
 * say two things about itself: the header that grouped it and the line inside it
 * read this one function, not two.
 * @param item - the row.
 * @param ctx - the clock and the board's live state.
 * @returns what the row says.
 */
export function itemRowViewOf(item: ItemRecord, ctx: ItemRowContext): ItemRowView {
  const soft = softPostureOf(item, ctx.now)
  return {
    item,
    ref: itemRefOf(item),
    title: itemTitleOf(item),
    status: derivedStatusOf(item, ctx.running),
    progress: itemProgressOf(item),
    posture: datePostureOf(item, ctx.now),
    soft,
    staleDays: staleDaysOf(item, ctx.now),
    // The default tier stays quiet: a chip on every row is a chip nobody reads,
    // and the reader who cares about priority is the one who filters on it.
    priorityLoud: item.priority !== 'normal',
  }
}

/** One grouped run of rows, already ordered. */
export interface ItemSlice {
  /** The STATUS the run holds; a row is in exactly one run per render. */
  readonly status: ItemStatusView
  readonly items: readonly ItemRecord[]
  /** Step arithmetic for the run, or `undefined` when it has no steps at all. */
  readonly progress: { readonly done: number; readonly total: number } | undefined
}

/** The four groups, in the order they read top to bottom. */
export const ITEM_STATUS_ORDER: readonly ItemStatusView[] = ['inProgress', 'open', 'blocked', 'done']

/** What one grouping pass needs to know. One bag, so the order stays stable. */
export interface ItemSliceOptions {
  readonly query: ItemQuery
  readonly ctx: ItemMatchContext & { readonly running: ReadonlyMap<string, boolean> }
  readonly sort: ItemSort
  /**
   * Whether finished rows come back as their own group.
   *
   * Off by default, and that is a decision rather than an omission: a finished
   * row is history, and a group that is only opened to be dismissed is a group
   * a reader learns to skip. The list page carries a switch instead, so the
   * finished rows are one gesture away and occupy nothing until asked for.
   */
  readonly includeDone?: boolean
}

/**
 * Group rows by their DERIVED status and order each run.
 *
 * A run that comes out empty is KEPT, and the group header reports the zero. A
 * group that vanishes the moment it empties reads as a broken filter rather
 * than an empty queue, and the reader loses the map of the whole list — which
 * is the only reason the grouping earns its place at all.
 *
 * A caller that needs "did anything match" sums the runs' lengths; a caller
 * that needs "how many were there" uses the document length. The two are
 * different facts and the surface states both.
 * @param items - every row in the document.
 * @param options - the filter, the clock, the live state, the order and the switch.
 * @returns one run per group, in reading order, empty runs included.
 */
export function itemSlicesOf(items: readonly ItemRecord[], options: ItemSliceOptions): ItemSlice[] {
  const { query, ctx, sort, includeDone = false } = options
  const groups = includeDone ? ITEM_STATUS_ORDER : ITEM_STATUS_ORDER.filter(status => status !== 'done')
  const buckets = new Map<ItemStatusView, ItemRecord[]>(groups.map(status => [status, []]))
  for (const item of items) {
    const status = derivedStatusOf(item, ctx.running)
    if (!buckets.has(status)) continue
    if (!itemMatches(item, query, ctx)) continue
    buckets.get(status)?.push(item)
  }
  return groups.map(status => {
    const rows = sortItemsOf(buckets.get(status) ?? [], sort)
    let done = 0
    let total = 0
    for (const row of rows) {
      for (const step of row.steps) {
        total += 1
        if (step.done) done += 1
      }
    }
    return { status, items: rows, progress: total === 0 ? undefined : { done, total } }
  })
}
