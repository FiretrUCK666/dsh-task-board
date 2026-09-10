/**
 * Free-typed time parsing for the cruise TimeField, plus the canonical text
 * formatting. The field reads like any text input: type a time, press Enter
 * or blur, done. Accepts the common short forms and normalizes them; anything
 * unparseable returns undefined (the caller flags it inline, never swallows
 * the user's text). Pure and framework-free so it unit-tests in isolation.
 */
/** Format an epoch millisecond as the field's canonical text (`YYYY-MM-DD HH:mm`). */
export declare function formatTimeInput(ms: number): string;
/**
 * Parse a free-typed time text into epoch ms (minute precision):
 * - `HH:mm`              → today at that clock
 * - `MM-DD HH:mm`        → this year
 * - `YYYY-MM-DD HH:mm`   → exact (also accepts a `T` separator)
 * - empty / whitespace   → undefined (a clear, not an error)
 * Any other text returns undefined, meaning "unparseable".
 */
export declare function parseTimeText(text: string, now?: number): number | undefined;
