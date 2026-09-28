/**
 * The client half of the checklist's pure layer: what an edit DOES to the
 * document, and how a date is written for a human.
 *
 * EVERY JUDGMENT LEFT THIS FILE. What a row says, which page it belongs to, how
 * a group of them reads, what its three dates mean — all of that lives in
 * `core/item-view.ts`, because the panel answering those questions one way and
 * the model another is how a search box finds a row the model cannot. What is
 * left here is the part only a browser can do: the edits, the id minting, and
 * the formatting.
 *
 * TWO RULES, THE SAME TWO THE REST OF THE LAYER KEEPS.
 *
 *  - **AN EDIT THAT CHANGES NOTHING MUST NOT COMMIT.** Every function here
 *    returns the SAME array when the edit is a no-op. The sync replica only
 *    stamps a revision and broadcasts when it is handed a different array, so a
 *    no-op that rebuilt the array would wake every device for a keystroke that
 *    changed no fact. This is the client-side counterpart of the board's
 *    `userEdit` funnel.
 *  - **A REFUSED WRITE KEEPS THE READER'S WORDS.** `addItem` refuses a blank
 *    note by returning the same list and no row, and the caller keeps what was
 *    typed, so a thought can be finished rather than lost to a disabled
 *    button's surprise.
 */
import type { ItemRecord, ItemStep } from '../../core/item.ts'
import { newItem } from '../../core/item.ts'

/** A mutation the reader made, expressed as a partial patch. */
export type ItemEdit = Partial<Pick<ItemRecord, 'title' | 'body' | 'notes' | 'status' | 'priority' | 'tags' | 'startsAfter' | 'dueAt' | 'hardDueAt' | 'taskId'>>

/** Whether two rows would produce the same document. */
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
 * Apply one edit to one row.
 *
 * Returns the SAME array when the edit would change nothing, so the caller can
 * hand it straight to the sync replica and know no revision will be burned.
 * That is the whole point of this function existing: the write path stamps
 * `updatedAt` itself, and an edit that forgot to check would wake every device
 * for a keystroke that changed no fact.
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
 * Toggle one step of one row, creating nothing.
 *
 * Steps are one level deep by model decision, so there is no recursion here and
 * none may be added: a nested checklist is the thing a narrow column cannot
 * show and the design rules refuse to show.
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
  const step = current.steps[stepAt] as ItemStep
  steps[stepAt] = { ...step, done: !step.done }
  const out = items.slice()
  out[at] = { ...current, steps, updatedAt: now }
  return out
}

/**
 * Remove one row. The document keeps its tombstone, so the row does not come
 * back on its own — the surface that owns recovery says so rather than
 * pretending a delete is final.
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
 * Mint a row identity.
 *
 * `crypto.randomUUID` is a secure-context API and the harness is served from a
 * loopback origin, so this is the path that always runs; the composed fallback
 * exists so a note is never left without an identity rather than failing a
 * note-taking gesture over a browser quirk.
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

/** What a capture hands over to become a row. */
export interface CapturedItem {
  readonly title: string
  readonly body: string
  readonly notes: string
  readonly status: ItemRecord['status']
  readonly priority: ItemRecord['priority']
  readonly steps: readonly { readonly text: string; readonly done: boolean }[]
  readonly tags: readonly string[]
  readonly startsAfter?: number
  readonly dueAt?: number
  readonly hardDueAt?: number
}

/**
 * Append one fresh row, or refuse a blank one.
 *
 * A note with no words in it is not a note, and the empty state promises the
 * reader they can write down a thought — so the gesture that creates the row is
 * the same gesture that writes the first words. Refusing changes nothing AND
 * keeps the words, so the reader can finish the thought instead of losing it.
 * @param items - the current list.
 * @param input - what was captured.
 * @param now - the writing clock.
 * @returns the next list and the row that was added, or no row and the same list.
 */
export function addItem(
  items: readonly ItemRecord[],
  input: CapturedItem,
  now: number,
): { readonly items: readonly ItemRecord[]; readonly added: ItemRecord | undefined } {
  if (input.title.trim() === '' && input.body.trim() === '' && input.steps.length === 0) {
    return { items, added: undefined }
  }
  // The steps arrive without ids because the capture box has no reason to mint
  // any; the document owns them, exactly as it owns the row's short number.
  const added = newItem({
    ...input,
    steps: input.steps.map((step, at) => ({ id: `step-${at}-${now}`, text: step.text, done: step.done })),
  }, { source: 'human', at: now }, newItemId(), now)
  return { items: [...items, added], added }
}

/**
 * Format a date the way the rest of this product formats one.
 *
 * `toLocaleDateString()` with no options is a different answer per machine —
 * `2026/9/28` here, `28/09/2026` there — so it goes through the same language
 * switch the board uses. One rule, one answer, in both places.
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
 * The inputs are date fields, so they speak a day and not a clock. Building the
 * moment in local time is the whole point: a date typed as 28 September must
 * land on 28 September for the person who typed it, whatever timezone the
 * browser happens to be in.
 * @param value - the field's value.
 * @returns the moment, or `undefined` for an empty or unparseable field.
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

/** Row-height tiers. The reader picks one; `view-prefs.ts` is where it is kept. */
export type ItemDensity = 'compact' | 'comfy'
