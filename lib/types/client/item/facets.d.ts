/**
 * The facets are an EDITOR for the search box, and that is the whole design.
 *
 * WHY NOT A SECOND FILTER ENGINE. The list already has one grammar — the one in
 * `core/item-view.ts`, which `parseItemQuery` reads and `itemMatches` applies,
 * and which `task-search.ts` registers the model's qualifiers against. If the
 * facet row kept its own state and merely happened to produce the same result,
 * then a filter set in the panel and the same filter typed into the box would be
 * two different things that agree today: retype one as the other and the list
 * changes, and nothing anywhere reports an error. So the facets own no state at
 * all. Clicking one writes a token into the search box, and the search box is
 * the only filter that exists.
 *
 * WHY THE RAW TEXT IS EDITED AND NEVER REBUILT FROM THE PARSE. The obvious
 * implementation is: parse, drop the facet's value, re-serialize, write back.
 * It is wrong in a way no test catches. `parseItemQuery` NORMALIZES — it
 * lowercases every free word and every tag — so a round trip silently
 * lowercases everything the reader typed, drops their capitalisation, and
 * re-orders nothing but changes the text they will see in the box. A reader who
 * searched for 「Gallery」 finds their own query rewritten under them, and a
 * reader who typed a tag in capitals can no longer type it again.
 *
 * So this module splits the ORIGINAL string on whitespace, adds or removes
 * exactly one token, and writes the rest back with the reader's own WORDS,
 * their capitalisation and their order intact. The one thing it does not
 * preserve is the run of spaces BETWEEN them: the box is a single line, so
 * collapsing whitespace there is invisible, while capitalisation is something
 * the reader typed on purpose. This is the rule to state, because the next
 * reader will find the round-trip version shorter and think it is the better
 * one.
 *
 * WHAT IS NOT DECIDED HERE. Nothing. Which values exist per facet is a table of
 * tokens and words; whether one is currently ON is asked of
 * `parseItemQuery`; which rows a query matches is asked of `itemMatches`. This
 * file is a text editor with a vocabulary, and the vocabulary is the grammar
 * core already speaks.
 */
import { type ItemQuery } from '../../core/item-view.ts';
import type { TaskBoardKey } from '../locales.ts';
/** The four faces a filter row offers. */
export type ItemFacetId = 'status' | 'priority' | 'tag' | 'date';
/** One selectable value of a FIXED facet: the token, and a word we have. */
export interface FacetValue {
    /** Exactly what is written into the search box. */
    readonly token: string;
    /** The stable value, for asking core whether it is already on. */
    readonly key: string;
    readonly label: TaskBoardKey;
}
/**
 * A tag's own chip. A separate type rather than a `FacetValue` with an empty
 * label, because a tag is the READER'S word and the locale has no entry for it
 * — and a chip that renders `undefined` because it reached for a dictionary it
 * was never going to find is the exact failure a closed Record exists to stop.
 */
export interface TagFacetValue {
    readonly token: string;
    /** Lower-cased, because the grammar lower-cases tags and the comparison has to. */
    readonly key: string;
    /** Spelled the way the reader spelled it. */
    readonly text: string;
}
/** The three fixed facets, and their values, in reading order. */
export declare const ITEM_FACETS: readonly {
    readonly id: ItemFacetId;
    readonly label: TaskBoardKey;
    readonly values: readonly FacetValue[];
}[];
/**
 * The part of the query that is the reader TYPING — their words, and nothing else.
 *
 * THIS IS THE WHOLE POINT OF THE FUNCTION, so it is worth being explicit about
 * what it buys. The query is ONE string, and it stays one string: the model reads
 * the same grammar, and a reader who wants it can still type `status:open` into
 * the box. What changes is only how the page SHOWS it. Before this, every facet
 * press printed its own implementation into a field labelled 「搜索标题、正文、
 * 备注与标签」, so a control showed the reader its source code; now the box holds
 * the words and the qualifiers stand beside it as chips that say 「状态：进行中」.
 *
 * Split on whitespace and keep, because that is the only lossless direction —
 * `parseItemQuery` lower-cases, so anything derived from it would come back
 * rewritten under the reader's hands.
 *
 * @param text - the whole query, exactly as it stands.
 * @returns the reader's own words, joined by single spaces.
 */
export declare function freeTextOf(text: string): string;
/**
 * One qualifier, as the reader sees it.
 *
 * `facet` and `value` are the two halves of the chip's own name; `tag` exists
 * because a tag is the reader's word and has no dictionary entry, and a chip that
 * reached for one would render `undefined`. `token` is the exact string in the
 * box, so removing the chip is the same byte-for-byte operation as adding it was.
 */
export interface QueryChip {
    readonly facet: TaskBoardKey;
    readonly value: TaskBoardKey | null;
    readonly tag: string | null;
    readonly token: string;
}
/**
 * The qualifiers in a query, as chips, in a stable order.
 *
 * Ordered by FACET and then by the facet's own value order rather than by where
 * the token happens to sit in the text: a chip row that reorders as the reader
 * types is a row nobody can learn, and the reader's own words can be in any order
 * at all. Tokens this module does not recognise are left in the BOX — a qualifier
 * typed by hand that is not in the tables is still a filter, and quietly hiding it
 * would be the worst kind of wrong: the list would be filtered with nothing on
 * screen saying so.
 *
 * @param text - the whole query, exactly as it stands.
 * @param tags - the document's tags, so a tag chip can show the reader's spelling.
 * @returns one chip per recognised qualifier, in reading order.
 */
export declare function queryChipsOf(text: string, tags?: readonly (readonly string[])[]): QueryChip[];
/**
 * Whether a facet's value is currently in the query.
 *
 * Asked of the PARSE, never of a set this module kept: the box's text is the
 * only state there is, so a value the reader typed by hand lights up exactly
 * like one they clicked, which is the behaviour that makes the box and the chips
 * read as one control instead of two that happen to share a row.
 */
export declare function isFacetOn(query: ItemQuery, facet: ItemFacetId, key: string): boolean;
/**
 * Add or remove one token, leaving every other character alone.
 *
 * @param text - the search box's contents, exactly as typed.
 * @param token - the facet token, e.g. `status:open`.
 * @param on - whether it should end up present.
 * @returns the new text. An absent token and an explicit removal both leave the
 *   reader's other words as they were typed, capitalisation included.
 */
export declare function withFacetToken(text: string, token: string, on: boolean): string;
/**
 * The tag facet's values: the tags this document actually holds.
 *
 * Derived here rather than asked of core, and the reason is worth being honest
 * about: it is a DISPLAY list, not a judgment. Nothing decides whether a row
 * matches a tag — `itemMatches` does, against the tags on the row — so a tag
 * that is missing from this list is a tag the reader cannot click, not a tag the
 * search cannot find. Typing it still works, which is why this is allowed to be
 * a convenience rather than the gate.
 *
 * Sorted, and de-duplicated case-insensitively while keeping the first spelling
 * seen: a list of chips whose order changes between renders is a list nobody
 * can find anything in.
 */
export declare function tagFacetValuesOf(tagLists: readonly (readonly string[])[]): TagFacetValue[];
