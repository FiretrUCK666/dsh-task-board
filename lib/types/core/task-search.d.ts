/**
 * Board-wide task search: one input, every surface a task owns. A task
 * matches when EVERY whitespace-separated term appears ANYWHERE in its
 * title, description, execution prompt, comment bodies or linked-session
 * titles (case-insensitive AND — narrowing as you type, never a surprise
 * OR flood). Empty query matches all (the filter is a sieve, not a gate).
 *
 * Pure and framework-free so the matcher unit-tests in isolation; TaskBoard
 * supplies the linked titles from its existing resolvers (no new data
 * plumbing — the haystack is assembled at the call site).
 */
/** All searchable text of one task (the caller appends session titles). */
export declare function taskHaystack(task: {
    title: string;
    description: string;
    prompt: string;
    executions: readonly {
        comment?: string;
    }[];
}, sessionTitles?: readonly string[]): string;
/** Whether a task matches a raw query string (blank query = match). */
export declare function matchTask(task: {
    title: string;
    description: string;
    prompt: string;
    executions: readonly {
        comment?: string;
    }[];
    /** Card accent color (for the `has:color` qualifier). */
    color?: string;
}, query: string, sessionTitles?: readonly string[], facets?: BoardQueryFacets): boolean;
/** Caller-resolved facets a qualifier can test (the board wires its live
 *  resolvers; absent = the qualifier cannot match, never an error). */
export interface BoardQueryFacets {
    workspaceTitle?: string;
    hasAutomation?: boolean;
    isUnviewed?: boolean;
}
/** One parsed `key:value` qualifier (see QUALIFIER_KEYS for the key set).
 *  Anything else stays a literal search term — an unknown qualifier narrows
 *  like ordinary text instead of failing. */
export interface BoardQualifier {
    key: string;
    value: string;
}
/**
 * Split a raw query into plain terms plus recognized qualifiers (see
 * QUALIFIER_KEYS/QUALIFIER_VALUES for the key set and enumerated values).
 * Matching is case-insensitive; `has:` accepts `auto`, `is:` accepts
 * `unread`/`read`, `ws:` takes any text —
 * quoted (`ws:"a b"`) when the name holds a space, first word otherwise.
 * Anything unrecognized stays a literal search term: an unknown qualifier
 * narrows like ordinary text instead of failing.
 */
export declare function parseBoardQuery(query: string): {
    terms: string[];
    qualifiers: BoardQualifier[];
};
/** Qualifier keys the filter understands — derived from the registry. */
export declare const QUALIFIER_KEYS: readonly string[];
/** Completion candidates for the token being typed (at most 8, key-first):
 *  a key prefix offers keys (`h` → `has:`), a bare key offers its values
 *  (`has:` → `has:auto`), a value prefix narrows them (`has:a` → `has:auto`).
 *  Free-text keys (`ws:`) and complete tokens offer nothing — the
 *  native datalist narrows the offered set further as typing continues.
 *  The token reads THE single scanner (a `ws:"..."` span is one token —
 *  completion never fires from inside quotes). */
export declare function completeBoardQuery(query: string): string[];
/** Assemble a full query from a completion candidate: the last token is
 *  replaced in place (earlier tokens, their case and every separator survive
 *  — a native datalist swaps the WHOLE value, so candidates must arrive as
 *  whole queries, never bare tokens). A trailing separator means a fresh
 *  empty token: the candidate appends instead of replacing. The boundary
 *  reads THE single scanner (no trailing separator ⇒ the last token is the
 *  string's suffix — a `ws:"..."` span can never be torn, even if a caller
 *  passes a candidate for a quoted context). */
export declare function applyCompletion(query: string, candidate: string): string;
/** Split a filter query into removable tokens — THE one scanner both the
 *  parser and the overview chips read, so chips remove exactly what the
 *  parser sees. Only `ws:"..."` spans stay atomic (the one quoted form);
 *  every other quote splits normally (unclosed/non-ws quotes are literal
 *  text to the parser, so the chips must show them split too). */
export declare function splitFilterTokens(query: string): string[];
/** Remove the token at `index` (single-token removal for the overview
 *  chips — Clear-all is just `setFilter('')`, never this). Out-of-range
 *  indexes return the query unchanged. */
export declare function removeFilterToken(query: string, index: number): string;
