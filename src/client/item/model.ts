/**
 * Task-list derivations. Framework-free and React-free on purpose: every
 * judgment the panel makes — what a group is, what a row says, what an edit
 * changes — is decided here and nowhere else, so the same question can never
 * get two answers in one panel.
 *
 * Two rules shape everything below.
 *
 * PROGRESS IS DERIVED, NEVER STORED. `itemProgressOf` returns `undefined` when
 * an item has no steps, and the panel draws nothing at all in that case. A 0%
 * bar reads as "something failed to load"; absence reads as "there is nothing
 * here yet". Those are different facts and the panel must not blur them.
 *
 * AN EDIT THAT CHANGES NOTHING MUST NOT COMMIT. `editItem` returns the SAME
 * array when the edit is a no-op, which is the client-side counterpart of the
 * board's `userEdit` funnel: the sync replica only stamps a revision and
 * broadcasts when it is handed a different array, so a no-op that rebuilt the
 * array would wake every device for nothing.
 */
import type { ItemRecord, ItemStatusView } from '../../core/item.ts'
import { itemProgressOf, itemStatusOf, itemTitleOf } from '../../core/item.ts'

/** The four display groups, in the order they read top to bottom. */
export const ITEM_GROUPS = ['inProgress', 'open', 'blocked', 'done'] as const
export type ItemGroup = typeof ITEM_GROUPS[number]

/** Whether a group starts expanded when the panel first opens with it. */
const GROUP_OPEN_BY_DEFAULT: Readonly<Record<ItemGroup, boolean>> = {
  inProgress: true,
  open: true,
  blocked: true,
  // Done is history; it opens only when the reader filtered for it.
  done: false,
}

/** One grouped slice of the list, already ordered. */
export interface ItemGroupSlice {
  readonly group: ItemGroup
  readonly items: readonly ItemRecord[]
}

/** Row-height tiers. The reader picks one and we remember it. */
export type ItemDensity = 'compact' | 'comfy'

/** The filter the reader has applied. Absent means "no filter". */
export interface ItemFilter {
  /** Free text over title, body, notes and tags. */
  readonly text: string
  /** Which groups to show; empty means all of them. */
  readonly groups: readonly ItemGroup[]
}

/** A filter that shows everything. */
export const NO_ITEM_FILTER: ItemFilter = { text: '', groups: [] }

/** What one row says, decided once. */
export interface ItemRowView {
  readonly item: ItemRecord
  /** `#12` — the number the reader and the model both call this row by. */
  readonly ref: string
  /** Never blank: an untitled item borrows its body's first line. */
  readonly title: string
  readonly status: ItemStatusView
  /** `undefined` when the item has no steps — drawn as nothing at all. */
  readonly progress: { readonly done: number; readonly total: number; readonly ratio: number } | undefined
  /** The single right-aligned value; two candidates never both win. */
  readonly meta: ItemRowMeta
}

/** Why a row carries its badge. */
export type ItemRowMeta =
  | { readonly kind: 'none' }
  /** `3/8` — a step count, shown next to the bar and never inside it. */
  | { readonly kind: 'steps'; readonly done: number; readonly total: number }
  /** An overdue or near deadline wins over a step count. */
  | { readonly kind: 'due'; readonly at: number; readonly overdue: boolean; readonly hard: boolean }
  /** No deadline and no steps; the row stays quiet. */
  | { readonly kind: 'quiet' }

/** Text a reader typed, split the way a search box splits it. */
function haystack(item: ItemRecord): string {
  return [itemTitleOf(item), item.body, item.notes, ...item.tags].join('\n').toLowerCase()
}

/**
 * Whether a row carries a deadline, and how loud it is. A hard deadline is
 * louder than a soft one; an elapsed one is louder than both.
 */
function deadlineOf(item: ItemRecord, now: number): ItemRowMeta | undefined {
  const at = item.hardDueAt ?? item.dueAt
  if (at === undefined) return undefined
  const hard = item.hardDueAt !== undefined
  return { kind: 'due', at, overdue: at < now, hard }
}

/**
 * Build one row's view.
 *
 * The row answers THREE questions at once and the answers must fit a 300px
 * column: what is it, how far along is it, and when is it wanted. Deadline
 * beats step count because a missed date is a fact while a step count is
 * progress you chose to report.
 * @param item - the record.
 * @param linkedRunning - whether the board card this item hangs off is running.
 * @param now - the reading clock, so every row in one render agrees.
 * @returns what the row says.
 */
export function itemRowViewOf(item: ItemRecord, linkedRunning: boolean, now: number): ItemRowView {
  const progress = itemProgressOf(item)
  const deadline = deadlineOf(item, now)
  const meta: ItemRowMeta = deadline !== undefined
    ? deadline
    : progress !== undefined
      ? { kind: 'steps', done: progress.done, total: progress.total }
      : { kind: 'quiet' }
  return {
    item,
    ref: `#${item.ref}`,
    title: itemTitleOf(item),
    status: itemStatusOf(item, linkedRunning),
    progress,
    meta,
  }
}

/**
 * Filter, group and order the list in one pass.
 *
 * The reader is scanning, not auditing, so the order is: what is happening
 * now, what is waiting, what is stuck, what is finished — and inside a group,
 * the reader's own manual order (`order`) first, then the nearest deadline,
 * then the newest. Nothing here is stored; it is a pure function of the
 * document.
 * @param items - every item in the document.
 * @param filter - what to keep.
 * @param linkedRunning - per-item running flag, keyed by the board card id.
 * @returns one slice per non-empty group, in reading order.
 */
export function itemGroupSlicesOf(
  items: readonly ItemRecord[],
  filter: ItemFilter,
  linkedRunning: ReadonlyMap<string, boolean>,
): ItemGroupSlice[] {
  const needle = filter.text.trim().toLowerCase()
  const wanted = new Set<ItemGroup>(filter.groups)
  const buckets = new Map<ItemGroup, ItemRecord[]>(ITEM_GROUPS.map(g => [g, []]))
  for (const item of items) {
    const group = itemStatusOf(item, linkedRunning.get(item.taskId ?? '') === true)
    if (wanted.size > 0 && !wanted.has(group)) continue
    if (needle !== '' && !haystack(item).includes(needle)) continue
    buckets.get(group)?.push(item)
  }
  const slices: ItemGroupSlice[] = []
  for (const group of ITEM_GROUPS) {
    const slice = buckets.get(group) ?? []
    if (slice.length === 0) continue
    slice.sort((a, b) => {
      const byDue = (a.hardDueAt ?? a.dueAt ?? Infinity) - (b.hardDueAt ?? b.dueAt ?? Infinity)
      if (byDue !== 0) return byDue
      return b.updatedAt - a.updatedAt
    })
    slices.push({ group, items: slice })
  }
  return slices
}

/** Whether a group opens by default. */
export function groupOpenByDefault(group: ItemGroup, filtering: boolean): boolean {
  return filtering ? true : GROUP_OPEN_BY_DEFAULT[group]
}

/** A mutation the reader made, expressed as a partial patch. */
export type ItemEdit = Partial<Pick<ItemRecord, 'title' | 'body' | 'notes' | 'status' | 'priority' | 'tags' | 'startsAfter' | 'dueAt' | 'hardDueAt' | 'taskId'>>

/** Whether two items would produce the same document. */
function sameItem(a: ItemRecord, b: ItemRecord): boolean {
  return a.title === b.title
    && a.body === b.body
    && a.notes === b.notes
    && a.status === b.status
    && a.priority === b.priority
    && a.tags.length === b.tags.length
    && a.tags.every((tag, at) => tag === b.tags[at])
    && a.startsAfter === b.startsAfter
    && a.dueAt === b.dueAt
    && a.hardDueAt === b.hardDueAt
    && a.taskId === b.taskId
}

/**
 * Apply one edit to one item.
 *
 * Returns the SAME array when the edit would change nothing, so the caller can
 * hand it straight to the sync replica and know no revision will be burned.
 * That is the whole point of this function existing: the AI's write path
 * stamps `updatedAt` inside `applyItemsCommit`, and a human edit that forgot to
 * check would wake every device for a keystroke that changed no fact.
 * @param items - the current list.
 * @param id - the row to change.
 * @param edit - the fields to change.
 * @param now - the edit clock; only a real change moves `updatedAt`.
 * @returns the next list, or the very same one when nothing changed.
 */
export function editItem(
  items: readonly ItemRecord[],
  id: string,
  edit: ItemEdit,
  now: number,
): readonly ItemRecord[] {
  const at = items.findIndex(item => item.id === id)
  if (at < 0) return items
  const current = items[at] as ItemRecord
  const next: ItemRecord = { ...current, ...edit }
  if (sameItem(current, next)) return items
  next.updatedAt = now
  const out = items.slice()
  out[at] = next
  return out
}

/**
 * Toggle one step of one item, creating nothing.
 *
 * Steps are one level deep by model decision, so there is no recursion here
 * and none may be added: a nested checklist is the thing the narrow panel
 * cannot show and the design rules refuse to show.
 * @param items - the current list.
 * @param id - the row to change.
 * @param stepId - the step to toggle.
 * @param now - the edit clock.
 * @returns the next list, or the very same one when nothing changed.
 */
export function toggleItemStep(
  items: readonly ItemRecord[],
  id: string,
  stepId: string,
  now: number,
): readonly ItemRecord[] {
  const at = items.findIndex(item => item.id === id)
  if (at < 0) return items
  const current = items[at] as ItemRecord
  const stepAt = current.steps.findIndex(step => step.id === stepId)
  if (stepAt < 0) return items
  const steps = current.steps.slice()
  steps[stepAt] = { ...(steps[stepAt] as ItemRecord['steps'][number]), done: !(steps[stepAt] as ItemRecord['steps'][number]).done }
  const next: ItemRecord = { ...current, steps, updatedAt: now }
  const out = items.slice()
  out[at] = next
  return out
}

/**
 * Remove one item. The document keeps its tombstone, so this is recoverable
 * through the merge grammar — the panel says so rather than pretending a
 * delete is final.
 * @param items - the current list.
 * @param id - the row to drop.
 * @returns the next list, or the very same one when it was not there.
 */
export function removeItem(items: readonly ItemRecord[], id: string): readonly ItemRecord[] {
  const at = items.findIndex(item => item.id === id)
  if (at < 0) return items
  const out = items.slice()
  out.splice(at, 1)
  return out
}

/** The storage key for the reader's chosen density. */
const DENSITY_KEY = 'dsh.taskBoard.itemDensity.v1'

/**
 * The reader's chosen row height, remembered across sessions.
 *
 * A density the reader cannot change is a density they will fight. This is the
 * one preference the panel owns; everything else about the list is derived.
 * @returns the stored tier, defaulting to compact because the column is narrow.
 */
export function readItemDensity(): ItemDensity {
  try {
    const raw = window.localStorage.getItem(DENSITY_KEY)
    return raw === 'comfy' ? 'comfy' : 'compact'
  } catch {
    return 'compact'
  }
}

/** Remember the reader's chosen row height. */
export function writeItemDensity(density: ItemDensity): void {
  try {
    window.localStorage.setItem(DENSITY_KEY, density)
  } catch {
    // A private-mode browser with no storage keeps the default; that is not
    // worth a message, because the control still works for this session.
  }
}
