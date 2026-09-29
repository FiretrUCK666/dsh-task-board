/**
 * The browser-only half of the checklist's pure layer: an identity, and the
 * three ways a human reads and writes a date.
 *
 * WHAT IS LEFT HERE, AND WHY IT IS EXACTLY THIS. An edit used to be written
 * here as well as in the model — a field patch, a step toggle, a delete and a
 * capture, each with its own no-op test and its own step-id scheme. That was the
 * second copy this project keeps removing, and the checklist is the second
 * SYNCED document, so a copy is not untidy there: it is two devices disagreeing
 * about which edits happened. All of it now lives in `core/item-transitions.ts`,
 * which the panel, the detail pane and the model's six `item.*` verbs call
 * alike.
 *
 * What cannot move out of a browser is what is left:
 *  - the identity, because `crypto.randomUUID` is a secure-context API and the
 *    document only ever hands out the SHORT number, which a replica must guess
 *    optimistically;
 *  - the date formatting, because the wording is a locale and the input is a
 *    `<input type="date">` — a shape only a browser draws;
 *  - the row-height type, which is a preference key rather than a fact.
 *
 * NOTHING HERE JUDGES ANYTHING about a row. What a row says, which page it is
 * on, how it groups, what its three dates mean, and what an edit DOES to the
 * document are all core derivations read by the human surface and by
 * `taskboard_query` alike — see `core/item-view.ts` and
 * `core/item-transitions.ts`.
 */

/**
 * Mint a row identity.
 *
 * `crypto.randomUUID` is a secure-context API and the harness is served from a
 * loopback origin, so this is the path that always runs; the composed fallback
 * exists so a note is never left without an identity rather than failing a
 * note-taking gesture over a browser quirk. The id is never shown and never
 * spoken — the row is called by the short number the document mints.
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
 * browser happens to be in. `undefined` here is not a failure — it is how a
 * cleared field says 「no promise any more」, and the patch it goes into is a
 * spread, so an explicit `undefined` clears the date while an absent key leaves
 * it alone.
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
