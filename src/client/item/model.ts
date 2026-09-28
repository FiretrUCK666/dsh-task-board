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

/**
 * Why a row carries its badge.
 *
 * Three shapes and no fourth: a row either has a date worth saying out loud, a
 * step count worth saying out loud, or nothing worth saying. There is no "none"
 * variant here on purpose — an arm of the union that nothing ever builds is a
 * branch the next reader has to reason about for nothing, and "quiet" already
 * says it.
 */
export type ItemRowMeta =
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
 * the nearest deadline first, then the most recently touched. Nothing here is
 * stored; it is a pure function of the document. There is deliberately no
 * reader-movable order: `ItemRecord` has no `order` field, because the columns
 * cannot offer a drag affordance honestly, and a stored order nobody can move
 * is a lie about who arranged it.
 *
 * Empty groups are KEPT, not dropped: the group header is the reader's map of
 * the whole list, and a group that vanishes when it hits zero reads as "the
 * filter broke" rather than "there is nothing here". A caller that needs the
 * filtered count sums the slices; a caller that needs "did anything match"
 * checks that sum, not the slice count.
 * @param items - every item in the document.
 * @param filter - what to keep.
 * @param linkedRunning - per-item running flag, keyed by the board card id.
 * @returns one slice per group in reading order, empty slices included. When
 *   the filter names groups, only those groups are returned.
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
  const ordered: readonly ItemGroup[] = wanted.size > 0
    ? ITEM_GROUPS.filter(group => wanted.has(group))
    : ITEM_GROUPS
  for (const group of ordered) {
    const slice = buckets.get(group) ?? []
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

/**
 * A fresh row, ready to be appended.
 *
 * The id is MINTED HERE and the short number is NOT. That split is the whole
 * point: the merge grammar keys on the id, and a client-minted uuid cannot
 * collide with another device's. The short number is the document's to hand
 * out — `assignItemRefs` fills in anything missing or already taken — so this
 * row arrives as `ref: 0`, meaning "nobody has numbered me yet", and the
 * number the reader sees is the one the host settled on. Minting a number here
 * would be two devices picking the same one and the host having to undo it.
 * @param input - what the reader typed.
 * @param now - the creation clock.
 * @param id - the identity, minted by the caller.
 * @returns a row the document will accept.
 */
export function newItem(
  input: Pick<ItemRecord, 'title' | 'body' | 'notes' | 'status' | 'priority'> & Partial<Pick<ItemRecord, 'steps' | 'tags'>>,
  now: number,
  id: string,
): ItemRecord {
  return {
    id,
    ref: 0,
    title: input.title.trim(),
    body: input.body.trim(),
    notes: input.notes.trim(),
    steps: input.steps ?? [],
    status: input.status,
    priority: input.priority,
    tags: input.tags ?? [],
    startsAfter: undefined,
    dueAt: undefined,
    hardDueAt: undefined,
    taskId: undefined,
    origin: { source: 'human', at: now },
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Mint a row identity.
 *
 * `crypto.randomUUID` is a secure-context API and the harness is served from
 * a loopback origin, so this is the path that always runs; the composed
 * fallback exists so a row is never left without an identity rather than
 * failing a note-taking gesture over a browser quirk.
 * @returns a fresh identity.
 */
export function newItemId(): string {
  const webCrypto = globalThis.crypto
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID()
  const bytes = webCrypto?.getRandomValues?.(new Uint8Array(16)) ?? Uint8Array.from({ length: 16 }, () => Math.floor(Math.random() * 256))
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Append one fresh row, or refuse an empty one.
 *
 * A note with no words in it is not a note, and the empty state promises you
 * can write down a thought — so the gesture that creates the row is the same
 * gesture that writes the first words. Returning the SAME array on refusal is
 * the same no-op discipline every other edit here follows.
 * @param items - the current list.
 * @param input - what the reader typed.
 * @param now - the creation clock.
 * @returns the next list and the row that was added.
 */
export function addItem(
  items: readonly ItemRecord[],
  input: Pick<ItemRecord, 'title' | 'body' | 'notes' | 'status' | 'priority'>,
  now: number,
): { readonly items: readonly ItemRecord[]; readonly added: ItemRecord | undefined } {
  // Nothing is written and nothing is cleared: the caller keeps what it typed
  // so the reader can finish the thought instead of losing it to a refusal.
  if (input.title.trim() === '' && input.body.trim() === '') return { items, added: undefined }
  const added = newItem(input, now, newItemId())
  return { items: [...items, added], added }
}

/**
 * Format a deadline the way the rest of this product formats one.
 *
 * `toLocaleDateString()` with no options is a different answer per machine —
 * `2026/9/28` here, `28/09/2026` there, and a 300px column has no room for
 * either. This goes through the same `isEnglish()` switch the board uses, so a
 * Chinese reader gets 年月日 and an English reader gets a short date, in BOTH
 * the panel and the board. One rule, one answer, in both places.
 * @param at - the moment, in milliseconds.
 * @param english - whether the active UI language is English.
 * @returns a short human date.
 */
export function formatItemDate(at: number, english: boolean): string {
  const date = new Date(at)
  return english
    ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

/**
 * Parse a `yyyy-mm-dd` field back into a moment, or `undefined` when blank.
 *
 * The inputs are date fields, so they speak a date and not a clock. Building the
 * moment in local time is the whole point: a deadline typed as 28 September must
 * land on 28 September for the person who typed it, whatever timezone the
 * browser happens to be in.
 * @param value - the field's value.
 * @returns the moment, or undefined for an empty field.
 */
export function parseItemDate(value: string): number | undefined {
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (parts === null) return undefined
  const [year, month, day] = parts.slice(1).map(Number) as [number, number, number]
  const at = new Date(year, month - 1, day).getTime()
  return Number.isFinite(at) ? at : undefined
}

/** Render a moment for a `yyyy-mm-dd` date field. */
export function toItemDateField(at: number | undefined): string {
  if (at === undefined) return ''
  const date = new Date(at)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
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
