/**
 * The query grammar: what a reader (or a model) may ASK of a row, and the one
 * matcher that answers.
 *
 * WHY A GRAMMAR AND NOT A HAYSTACK. The search box a person types into, the pages
 * that filter by the same text, and `taskboard_query`'s `filter` are three views
 * of ONE vocabulary. The moment a fourth surface assembles its own haystack, two
 * of them will disagree — and they will disagree silently, because each half is
 * individually correct. So the vocabulary is data here, and `task-search.ts`
 * holds nothing but the one door into it.
 *
 * FOUR RULES EVERY CLAUSE HERE FOLLOWS.
 *
 *  1. **STABLE KEYS, NEVER DISPLAY WORDS.** A predicate compares enum values
 *     (`'urgent'`, `'open'`), never the string a reader sees. A filter written
 *     against a display name silently matches nothing the moment that name is
 *     reworded — the failure mode every "saved filter" inherits from products
 *     that store their queries as text. Keys do not move; the dictionary does.
 *  2. **ONE CLOCK, PASSED IN.** Nothing here reads `Date.now()`. One render, one
 *     `now`, so two rows cannot disagree about whether a day has passed, and a
 *     test does not need a fake timer to pin a deadline verdict.
 *  3. **A NO-OP IS NOT AN ANSWER.** The absences here are `undefined` and the
 *     empty collection, never a zero or a "none" string standing in for a value
 *     nobody computed — so a surface that forgot to ask cannot paint a confident
 *     nothing.
 *  4. **A COUNT AND ITS JUMP ARE ONE PREDICATE, BY CONSTRUCTION.** Every flag is
 *     a named entry in {@link ITEM_FLAG_TESTS}, and anything that COUNTS one
 *     calls the same function the jump calls — so the number on a tile and the
 *     list under it cannot be made to disagree.
 */
import type { ItemPriority, ItemRecord, ItemStatusView } from './item.ts';
import type { DatePosture } from './item-dates.ts';
/** Qualifier keys the grammar recognises, mapped onto STABLE field values.
 *
 *  **Exported so the model can be taught this table instead of a copy of it.**
 *  It used to be private, which is why `taskboard_query`'s filter help could only
 *  report the BOARD's keys: the item vocabulary had no reader outside this file,
 *  so anything that wanted to describe it had to retype it — and a retyped list is
 *  a list that goes stale silently.
 */
export declare const PRIORITY_BY_TOKEN: Readonly<Record<string, ItemPriority>>;
/**
 * A row-level test the query can name.
 *
 * Each one is a fact about the row that a reader can also see on it. A test
 * that is not visible on the row belongs in a page, not in a filter.
 */
export type ItemFlag = 
/** A hard deadline has passed. */
'hardOverdue'
/** A wanted-by date has passed and nothing was done about it. */
 | 'behind'
/**
 * EITHER kind of lateness.
 *
 * It exists because 「逾期」 is a word a reader reaches for and the grammar had
 * no way to say: `hardOverdue` and `behind` are two different promises that
 * were once missed, and a surface that counts 「逾期」 as both while offering
 * only one of them is a number that does not match the list under it. One
 * flag, one predicate, shared by the count and the filter.
 */
 | 'overdue'
/** Untouched past the threshold, past the exemptions and under the ceiling. */
 | 'stale'
/** No date of any kind: not scheduled, not gated. */
 | 'undated'
/** `startsAfter` is in the future. */
 | 'gated'
/** The reader marked it blocked on something. */
 | 'blocked'
/** Hangs off a board card. */
 | 'linked' | 'done';
/** The qualifier keys the grammar accepts, as the STABLE values behind them. */
export declare const ITEM_FLAGS: readonly ItemFlag[];
/**
 * **EVERY token this grammar reads as a qualifier, derived from the tables above.**
 *
 * This exists because the model was being taught a vocabulary that was half of
 * this one. `taskboard_query`'s filter help reported the BOARD's keys only, and
 * the same string is parsed by `matchItemQuery` for the item list — so `has:auto`
 * and `is:unread` (both board keys, both taught) fell through as **free words and
 * matched nothing**, while `status:`, `p1`–`p4`, `!1`–`!4`, `has:` and `#标签` —
 * everything the list actually speaks — were never mentioned at all.
 *
 * A vocabulary that is only half-taught is worse than none: the model uses the
 * half it knows, gets silence, and has no way to tell 「no match」 from
 * 「I used it wrong」.
 *
 * **DERIVED, NEVER TYPED.** Every entry comes from `ITEM_FLAGS`, `PRIORITY_BY_TOKEN`
 * or {@link ITEM_STATUS_VIEWS} — the same tables the parser reads — so adding a
 * flag is one edit here and one edit there, and they cannot disagree because
 * there is only one of each.
 *
 * **AND IT SPELLED OUT `status:inProgress` FOR SIX RELEASES' WORTH.** The
 * statuses came from `ITEM_STATUSES`, which is the three a person can CHOOSE
 * (`open` / `blocked` / `done`); `inProgress` is the fourth a person can only be
 * SHOWN, and it is not in that table because it is derived from a card. The
 * parser has always accepted `status:inprogress` and `isItemQualifierToken` has
 * always said yes — but this list, which is what `taskboard_query` teaches the
 * model, never mentioned it. So the token worked for a reader who guessed it and
 * was invisible to the model that was told the whole vocabulary. **A vocabulary
 * that is derived from one of the two halves of a type teaches one half.**
 */
export declare function itemQualifierVocabulary(): readonly string[];
/**
 * Is this token one the GRAMMAR speaks — a filter, rather than the reader's word?
 *
 * Exported so the search box can ask the SAME question the parser answers,
 * instead of keeping its own list of the qualifiers. It used to: the box built a
 * set from the three fixed facets, so a flag the grammar knew and the facets did
 * not (there have been several) was classified as a free word — the raw
 * `has:stale` appeared inside the field the reader was typing in, and NO CHIP WAS
 * DRAWN, which is a filter applied with nothing on screen saying what applied it.
 *
 * One predicate, asked in both places, is the only arrangement in which 「the box
 * shows a word」 and 「the word is a filter」 cannot come apart.
 *
 * @param token - one whitespace-separated word from the query text.
 * @returns whether the grammar would read it as a qualifier.
 */
export declare function isItemQualifierToken(token: string): boolean;
/** A parsed query: free words plus recognised qualifiers. */
export interface ItemQuery {
    readonly words: readonly string[];
    readonly tags: readonly string[];
    readonly priority: readonly ItemPriority[];
    readonly status: readonly ItemStatusView[];
    readonly flags: ReadonlySet<ItemFlag>;
    /**
     * ONE DAY, AS `YYYY-MM-DD` — 「只看这一天」.
     *
     * A single day rather than a list, because the question a calendar asks is
     * 「那一天有什么」 and nobody asks it about two days at once: two days is a range
     * (a different control) or it is a reader who has not finished choosing. Making
     * it single is also what stops the token from accumulating in the box, which is
     * what the field was doing when every press added another `on:` and each one
     * narrowed the list toward zero.
     */
    readonly day: string | null;
    /** The exact source text, so a surface can echo what was typed. */
    readonly text: string;
}
/** The query that matches everything, and the shape every parse returns. */
export declare const EMPTY_ITEM_QUERY: ItemQuery;
/**
 * The one spelling of a day token, so the writer and the reader cannot disagree.
 * @param day - `YYYY-MM-DD`, as the calendar's own cells carry it.
 * @returns the token the grammar reads.
 */
export declare function dayTokenOf(day: string): string;
/**
 * Parse a search box's contents into words and qualifiers.
 *
 * Unrecognised `key:value` stays a literal word, exactly as the board's own
 * parser treats it: a reader typing `notes:xyz` means the literal text, and
 * silently swallowing it into a qualifier would lose their words.
 *
 * The qualifier VALUES are the model's enum values, never the reader's words —
 * see rule 1 in the module header.
 * @param text - what is in the search box.
 * @returns the parsed query.
 */
export declare function parseItemQuery(text: string): ItemQuery;
/** What a row needs to know about the world for a filter to judge it. */
export interface ItemMatchContext {
    readonly now: number;
    /** Untouched days past which a row counts as neglected. */
    readonly staleDays: number;
    /**
     * The board's live state, keyed by card id — the input the DERIVED status
     * needs, and the reason 进行中 is filterable at all.
     *
     * Optional rather than required, and the absence is a real answer rather than
     * a gap: a caller with no board in front of it (a dry run, a host that cannot
     * see the engine) passes nothing, 进行中 then matches nothing, and a row that
     * is quietly running is never reported as 待办. What that caller must not do
     * is guess "not running" and filter the running rows into 待办, which is what
     * hard-coding `false` did — `status:inProgress` was a documented filter that
     * silently matched nothing, in the search box AND in the model's query.
     */
    readonly running?: ReadonlyMap<string, boolean>;
}
/** The default reading context: right now, the default threshold, no board. */
export declare function itemMatchContextOf(now: number, staleDays?: number, running?: ReadonlyMap<string, boolean>): ItemMatchContext;
/** What a flag test is given. ONE probe per row, so two flags cannot disagree
 *  about the same row's date posture — a disagreement that is invisible until a
 *  rail prints a number the jump does not honour. */
export interface ItemFlagProbe {
    readonly item: ItemRecord;
    readonly posture: DatePosture;
    readonly stale: number | undefined;
    readonly ctx: ItemMatchContext;
}
/** Build the probe a flag test reads. One posture, one staleness, one clock. */
export declare function flagProbeOf(item: ItemRecord, ctx: ItemMatchContext): ItemFlagProbe;
/**
 * EVERY FLAG, AS A NAMED PREDICATE, IN A TABLE KEYED ON THE UNION.
 *
 * These were a nested ternary chain inside {@link itemMatches}, and the chain's
 * final `else` was the `done` test. Nothing checked that every flag had an arm:
 * add a flag to {@link ItemFlag} and to {@link ITEM_FLAGS}, forget the arm, and
 * the row silently filters as 「已完成」 — a compile-clean build and a filter
 * that lies. That is the same shape {@link ITEM_SORTS} refuses with
 * `Record<ItemSort, …>` in `item-sort.ts`, and the same one
 * {@link ITEM_FIELDS} refuses with `as const satisfies Record<…>` in `item.ts`.
 * Three tables, one reason: a table keyed on the union is a BUILD FAILURE when a
 * member has no entry, and an `if` chain is a runtime surprise when it does not.
 *
 * THE SCOPE LIVES HERE, not in the count. `behind` and `undated` are produced by
 * the triage lines, and both count only UNFINISHED work (`undated` only rows
 * that are not bare captures). The flag tests below carry that same scope so a
 * jump cannot land on more rows than the number promised — a defect that was real
 * here once, and the reason the scope is written next to the predicate instead of
 * next to the number that reads it.
 */
export declare const ITEM_FLAG_TESTS: Readonly<Record<ItemFlag, (probe: ItemFlagProbe) => boolean>>;
/**
 * Does this row pass this flag? The surface form of {@link ITEM_FLAG_TESTS},
 * for anything that has the row and the context but not a probe yet.
 *
 * **This is also how a number is COUNTED.** A rail, a tile or a count line that
 * wants 「how many rows does this flag hold」 calls this on the same row — so the
 * number on screen and the list behind it are one predicate by construction,
 * which is the promise rule 4 of this module makes.
 */
export declare function itemHasFlag(item: ItemRecord, flag: ItemFlag, ctx: ItemMatchContext): boolean;
/**
 * Whether a row satisfies a parsed query.
 *
 * Every clause ANDs. Tag clauses OR against each other (asking for two tags
 * means "either"), because "these two things at once" is not a question a
 * reader asks a tag filter and answering it that way makes the filter useless
 * for its only real job, which is narrowing.
 * @param item - the row.
 * @param query - the parsed query.
 * @param ctx - the clock and the staleness threshold.
 * @returns whether it passes.
 */
export declare function itemMatches(item: ItemRecord, query: ItemQuery, ctx: ItemMatchContext): boolean;
/**
 * Which days this row is ON, as `YYYY-MM-DD`, in the reader's own local calendar.
 *
 * Local rather than UTC, and that is the whole reason this is a function: the
 * calendar's cells are local days, so a row due at 23:00 local on the 6th must be
 * found by the 6th and not by the 7th. Deriving from `toISOString()` would put it
 * on the 7th for half the planet.
 * @param item - the row.
 * @returns the days it belongs to, in a stable order, without duplicates.
 */
export declare function itemDatesOf(item: ItemRecord): readonly string[];
