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
/**
 * **一套日期词，两个入口。**
 *
 * 读者在哪儿学、在哪儿用，认的都该是同一批写法：固定的近日子（`今天`/`明天`/`前天`…）、
 * 星期几（`三`/`周三`/`下三`）、`+N`、`2026/10/15`、`10/15`（还没到才算），以及字段里那个
 * 严格形式 `2026-10-15`。开头可以带 `@`，也可以带那个日子的名字（`@不晚于 10/9`）——
 * 名字在这里只是**读者说话的方式**：这个框本来就知道自己是哪个日子。
 *
 * 两个入口曾经各认一半：快记认星期几与 `+N`，日期框只认 `2026-10-15` 与「明天」——
 * 于是读者在快记得学会的写法，在它旁边那个框里被拒，而那两个框说的是同一件事。
 * @param text - what the reader wrote.
 * @param now - the reading clock; every word resolves against it.
 * @returns the local midnight of that day, or `undefined` when the words do not name one.
 */
export declare function parseDateExpression(text: string, now: number): number | undefined;
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
