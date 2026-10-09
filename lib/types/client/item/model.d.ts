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
 *    `<input type="date">` — a shape only a browser draws.
 *
 * A ROW-HEIGHT TYPE IS DELIBERATELY NOT HERE, and no density control is offered,
 * because a preference whose effect the reader cannot see is worse than no
 * preference: the control still takes a track in the header, still spends a
 * dictionary word, and still teaches the reader that this row height is
 * something they set — and when they change it and nothing moves, they conclude
 * the panel is broken. A row's block padding is a FLOOR for a coarse pointer,
 * not a tier: 12px is what a finger needs to hit, and it is the same number on a
 * desk, so the honest form of this fact is a constant rather than a setting.
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
export declare function newItemId(): string;
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
export declare function formatItemDate(at: number, english: boolean, now?: number): string;
/**
 * A `YYYY-MM-DD` key as the reader's own words — `9月29日` / `Sep 29`.
 *
 * WHY THE KEY IS NOT PRINTED. The raw form is storage's spelling of a day: it is
 * fixed-width, it sorts, and it is the right thing to put in a query token. It is
 * the wrong thing to put in front of a reader — the chip that says which day the
 * list is filtered to is the one place the filter is stated in words rather than
 * in the grammar, and `on:2026-09-29` there would be the same defect as printing
 * `has:hardOverdue` beside a facet.
 *
 * It goes through the SAME formatter every other date on this surface uses, so a
 * day reads the same whether it is on a row, in the detail, or in the chip row.
 * @param key - a local day key, `YYYY-MM-DD`.
 * @param english - whether the active UI language is English.
 * @param now - the reading clock, for the same-year rule.
 * @returns the day as a reader says it.
 */
export declare function formatDayKey(key: string, english: boolean, now?: number): string;
/**
 * Parse a date field back into a moment, or `undefined` when unreadable.
 *
 * The field speaks a day and not a clock, and it speaks three ways — the same
 * three the reader has met everywhere else on this surface: `2026-10-15`, the
 * word form (`明天`/`today`), and the `@`-prefixed word. A field that taught a
 * reader one spelling in the capture and then refused it in place was a
 * grammar that changed between two steps of the same edit.
 *
 * Building the moment in local time is the whole point: a date typed as 28
 * September must land on 28 September for the person who typed it, whatever
 * timezone the browser happens to be in. `undefined` here is not a failure — it
 * is how a cleared field says 「no promise any more」 (an empty field), and the
 * patch it goes into is a spread, so an explicit `undefined` clears the date
 * while an absent key leaves it alone.
 * @param value - the field's value.
 * @param now - the reading clock; a WORD resolves against it, so a test pins
 *   `明天` with a fixed clock instead of the machine's today.
 * @returns the moment, or `undefined` for an empty or unparseable field.
 */
export declare function parseItemDate(value: string, now?: number): number | undefined;
/** Render a moment for a `yyyy-mm-dd` date field. */
export declare function toItemDateField(at: number | undefined): string;
/**
 * A moment as `yyyy-mm-dd`, in LOCAL time.
 *
 * LOCAL, not UTC, and that is the whole comment. The reader's calendar is local:
 * a row due today is due today on the machine they are sitting at, and a key
 * built from `toISOString()` puts every row that falls after the evening
 * cutoff — or anywhere west of Greenwich — on the wrong day. It is the same
 * reason `startOfDay` is local in core, and the same reason a stored instant is
 * never printed as a bare date without going through here.
 */
export declare function localDayKey(at: number): string;
