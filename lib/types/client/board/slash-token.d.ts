import type { SlashCandidate } from '../../core/controller.ts';
/** The trigger token at the caret, when the caret sits in one. */
export interface CommandToken {
    /** Index of the token's first character (the trigger). */
    start: number;
    /** One past the token's last character (the whole word, for replacement). */
    end: number;
    /** Text after the trigger, up to the caret (the filter query). */
    query: string;
    /** Whether the token starts a line (slash commands with hints show only then). */
    leading: boolean;
    /** Whether the token is an open quoted path (`@"…`); '@' only. */
    quoted?: boolean;
}
/**
 * Find the slash token at `caret`. Scans back to the nearest separator to
 * locate the word start, forward to the next separator for the word end;
 * when the word starts with '/', the caret is inside a slash token. The
 * filter query is the typed text between the '/' and the caret. Returns
 * undefined otherwise.
 */
export declare function commandTokenAt(text: string, caret: number): CommandToken | undefined;
/**
 * Find the mention token at `caret` — the OFFICIAL `@` grammar from
 * `@deepseek-ai/dsh-file-reference/grammar`: an `@` must sit at a word
 * boundary, and an open quoted path (`@"…`) is one token that may span
 * whitespace. The span covers the whole trigger prefix (`@` or `@"`);
 * `quoted` rides the token so the reference bridge can suppress session
 * discovery inside quoted paths (the official source's rule).
 */
export declare function mentionTokenAt(text: string, caret: number): CommandToken | undefined;
/**
 * Filter slash candidates against the query, mirroring the native composer:
 * commands match case-insensitively (prefix first, then includes) and only
 * appear at any position when they take no hint; skills match by
 * `startsWith` and appear at any position. Commands rank before skills;
 * each group stays sorted.
 */
export declare function filterSlashCandidates(candidates: readonly SlashCandidate[], query: string, leading: boolean): SlashCandidate[];
/** The replacement text for a picked slash candidate, mirroring the native
 *  menu: commands complete to `/<name>`, skills and commands with an input
 *  hint add a trailing space so typing continues. */
export declare function commandCompletion(candidate: SlashCandidate): string;
/**
 * Replace the whole token word with the picked candidate's completion.
 * @returns the new text and the caret position after insertion.
 */
export declare function insertCommand(text: string, token: CommandToken, candidate: SlashCandidate): {
    text: string;
    caret: number;
};
/**
 * Replace the whole '@' token span with an official mention splice (a
 * `@path` / `@"path"` file mention or a canonical `@[label](dsh-session:…)`
 * session mention). Pure span surgery shared by every board input.
 * @returns the new text and the caret position after insertion.
 */
export declare function insertMention(text: string, token: CommandToken, insert: string): {
    text: string;
    caret: number;
};
/** THE '@' menu capability gate — same discipline as '/' (which needs the
 *  slash catalog): the reference menu opens only when a target session
 *  scopes the discovery AND the official reference bridge exists. A missing
 *  capability never shows an empty "no match" menu — it behaves as if the
 *  trigger did not exist at all. */
export declare function referenceMenuAvailable(sessionId: string | undefined, bridgePresent: boolean): boolean;
/** Whether picking a row should re-open the menu right after insertion.
 *  ONLY the official directory-descent splice (`@"路径/` keeps its quote
 *  open for the next level) continues; a plain file mention, a session
 *  mention and every slash completion all close the menu silently — the
 *  cursor sits inside a live token after their splice and would otherwise
 *  instantly re-open the very menu the user just used. */
export declare function continueAfterPick(row: {
    insert?: string;
    continue?: boolean;
} | undefined): boolean;
