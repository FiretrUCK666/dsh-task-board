/**
 * The checklist's ONE derivation layer: what a row says, which page it belongs
 * to, how a group of them reads, and what the three dates actually mean.
 *
 * WHY THIS IS A CORE MODULE AND NOT A CLIENT ONE. Two surfaces ask these
 * questions and they must never answer them differently: the panel a person
 * reads, and `taskboard_query`, which answers for the model. When both derive
 * their own, a search box that finds a row while the model says the same words
 * finds nothing — and nothing anywhere reports an error, because both halves
 * are individually correct. So the judgment lives here, framework-free, and
 * both read it. `task-search.ts` registers its item qualifiers against
 * {@link itemMatches} rather than carrying a second haystack.
 *
 * FOUR RULES EVERY EXPORT HERE FOLLOWS.
 *
 *  1. **STABLE KEYS, NEVER DISPLAY WORDS.** A predicate compares enum values
 *     (`'urgent'`, `'open'`), never the string a reader sees. A filter written
 *     against a display name silently matches nothing the moment that name is
 *     reworded — the failure mode every "saved filter" inherits from products
 *     that store their queries as text. Keys do not move; the dictionary does.
 *
 *  2. **ONE CLOCK, PASSED IN.** Nothing here reads `Date.now()`. One render, one
 *     `now`, so two rows cannot disagree about whether a day has passed, and a
 *     test does not need a fake timer to pin a deadline verdict.
 *
 *  3. **PROGRESS AND POSTURE ARE DERIVED, NEVER STORED.** {@link itemProgressOf}
 *     returns `undefined` for a row with no steps (an empty 0% bar reads as a
 *     failed load; absence reads as "there is nothing here yet"), and
 *     {@link datePostureOf} derives urgency from the same three date fields the
 *     reader typed.
 *
 *  4. **A NO-OP IS NOT AN ANSWER.** The absences here are `undefined` and the
 *     empty collection, never a zero or a "none" string standing in for a
 *     value nobody computed — so a surface that forgot to ask cannot paint a
 *     confident nothing.
 */
import type { ItemDateConflict, ItemPriority, ItemRecord, ItemStatusView } from './item.ts';
/**
 * The status a row DISPLACES as, re-exported so a surface reading this module
 * does not have to know that the vocabulary lives one file over. The name is
 * the model's, and this is the same name — not a second type that happens to
 * be spelled the same way.
 */
export type { ItemPriority, ItemStatus, ItemStatusView } from './item.ts';
/** How far ahead a hard deadline counts as "soon". Amber, not red. */
export declare const HARD_SOON_DAYS = 7;
/** Days without a change before an open row counts as neglected. */
export declare const DEFAULT_STALE_DAYS = 14;
/**
 * Past this, a row stops being "neglected" and becomes simply old. A staleness
 * signal with no ceiling turns into a guilt generator: the user is scolded
 * about rows they deliberately parked, learns the signal is noise, and turns it
 * off for good. The two exemptions in {@link staleDaysOf} are the other half of
 * the same promise — see its doc comment.
 */
export declare const STALE_CEILING_DAYS = 90;
/**
 * What the three date fields mean for a row RIGHT NOW.
 *
 * The three fields are three different promises and this is the single place
 * that says which promise is being broken. A missed soft `dueAt` is a plan that
 * slipped; a missed `hardDueAt` is a missed commitment. Rendering both as the
 * same red "overdue" is the defect every mainstream task app is criticised for
 * — it makes a date that a reader moves as normal planning indistinguishable
 * from a date that has an external consequence, and the reader's only remedy
 * is to stop setting dates at all.
 *
 * `hardDueAt` therefore outranks `dueAt` for the VERDICT, and a row carrying
 * both still reports the soft one as {@link DatePosture.soft}.
 */
export type DatePosture = 
/**
 * The three dates cannot all be true: a start date after the wanted-by date,
 * or a wanted-by date after the hard deadline.
 *
 * This branch comes FIRST, before every other verdict, because a row that
 * contradicts itself has no honest "how late is it" answer and picking one
 * anyway would draw a confident schedule built on impossible data. The
 * document deliberately does not repair such a row — rearranging the reader's
 * three dates and reporting success is worse than leaving them visible, and
 * dropping the row over a date field is worse still — so this is where the
 * truth is finally said, in the one place that can see all three fields.
 */
{
    readonly kind: 'contradiction';
    readonly conflict: ItemDateConflict;
}
/** No date on the row at all: the reader never made a promise. */
 | {
    readonly kind: 'none';
}
/** `startsAfter` is still in the future — by definition it cannot be touched. */
 | {
    readonly kind: 'gated';
    readonly startsAfter: number;
}
/** The hard deadline has passed. The only verdict that may read as an alarm. */
 | {
    readonly kind: 'hardOverdue';
    readonly at: number;
    readonly days: number;
}
/** The hard deadline is inside {@link HARD_SOON_DAYS}. Worth noticing, not yet late. */
 | {
    readonly kind: 'hardSoon';
    readonly at: number;
    readonly days: number;
}
/** The hard deadline is set and comfortably ahead. */
 | {
    readonly kind: 'hardAhead';
    readonly at: number;
    readonly days: number;
}
/** The wanted-by date is today. */
 | {
    readonly kind: 'dueToday';
    readonly at: number;
}
/** The wanted-by date passed: behind plan, which is not the same as overdue. */
 | {
    readonly kind: 'behind';
    readonly at: number;
    readonly days: number;
}
/** The wanted-by date is ahead. */
 | {
    readonly kind: 'upcoming';
    readonly at: number;
    readonly days: number;
};
/** The soft `dueAt` read separately, so a row with both dates says both. */
export interface SoftPosture {
    readonly at: number | undefined;
    readonly days: number | undefined;
    readonly overdue: boolean;
    readonly today: boolean;
}
/**
 * The soft date, read apart from the verdict.
 *
 * Kept separate because a row with a hard deadline AND a wanted-by date is the
 * normal shape for real work, and collapsing the two into one chip is what
 * makes the row say only half of what the reader set.
 * @param item - the row.
 * @param now - the reading clock.
 * @returns the soft date's own standing.
 */
export declare function softPostureOf(item: ItemRecord, now: number): SoftPosture;
/**
 * The one verdict the row's right side speaks.
 *
 * Precedence, in order: a row whose own dates contradict each other, then a
 * gate that has not opened, then the hard deadline (passed / soon / ahead), then
 * the soft date (today / passed / ahead). The first two come first because they
 * are the two cases where there is no verdict to give — the row is either
 * impossible or not yet startable, and picking a date out of either one would be
 * a confident answer to a question nobody asked.
 *
 * The hard deadline outranks the soft one for the VERDICT, because a missed hard
 * deadline is the only one a reader cannot re-negotiate by themselves.
 * @param item - the row.
 * @param now - the reading clock.
 * @returns what the row's date situation is.
 */
export declare function datePostureOf(item: ItemRecord, now: number): DatePosture;
/**
 * How long this row has sat untouched, or `undefined` when it is exempt.
 *
 * The exemptions are the whole point, not a nicety bolted on. Two kinds of row
 * are not neglected when nothing has happened to them: one whose `startsAfter`
 * has not arrived (it cannot be worked on yet) and one that is `blocked` (it
 * cannot be worked on at all until something else moves). A naive "days since
 * last change" counts both as neglect, points at rows the reader gated on
 * purpose, and the first time that happens the reader switches the whole thing
 * off. So the question asked is "how long has this been waiting to be touched
 * AND been touchable", and a row that fails the second half simply has no
 * answer.
 *
 * The ceiling is the same promise from the other side: past
 * {@link STALE_CEILING_DAYS} a row stops being reported, because at that point
 * it is not neglected work, it is history.
 * @param item - the row.
 * @param now - the reading clock.
 * @returns whole days since the last change, or `undefined` when exempt or too old.
 */
export declare function staleDaysOf(item: ItemRecord, now: number): number | undefined;
/**
 * The rows a reader has stopped moving, oldest first.
 * @param items - every row in the document.
 * @param now - the reading clock.
 * @param thresholdDays - how many untouched days count; below the default is the reader's choice.
 * @returns the neglected rows, most neglected first.
 */
export declare function staleItemsOf(items: readonly ItemRecord[], now: number, thresholdDays?: number): ItemRecord[];
/**
 * The panel's three pages, in reading order.
 *
 * A page is a QUESTION ("what have I not dealt with yet", "what is on me
 * today", "what have I set down"), not a layout. Layouts are a property of a
 * page, and a surface that grows one page per layout ends up with a navigation
 * strip nobody reads — so the set is closed here, in data, and nothing in the
 * interface may add a fourth.
 */
export declare const ITEM_PAGES: readonly ["inbox", "list", "schedule"];
export type ItemPageId = typeof ITEM_PAGES[number];
/**
 * Whether a row is still an unsorted capture.
 *
 * "Structured" means the reader put it into the taxonomy: it has a priority
 * above the default, a date of any of the three kinds, a tag, or a board card.
 * Give it any of those and it has been filed; leave it bare and it is still
 * waiting to be decided about. That is the whole rule, and it is why steps and
 * body text do NOT count: they are content, not a place in the taxonomy, and a
 * note that arrives with a checklist is still a thought that needs a decision.
 * @param item - the row.
 * @returns whether it belongs to the inbox.
 */
export declare function isInboxItem(item: ItemRecord): boolean;
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
/** A parsed query: free words plus recognised qualifiers. */
export interface ItemQuery {
    readonly words: readonly string[];
    readonly tags: readonly string[];
    readonly priority: readonly ItemPriority[];
    readonly status: readonly ItemStatusView[];
    readonly flags: ReadonlySet<ItemFlag>;
    /** The exact source text, so a surface can echo what was typed. */
    readonly text: string;
}
/** The query that matches everything, and the shape every parse returns. */
export declare const EMPTY_ITEM_QUERY: ItemQuery;
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
}
/** The default reading context: right now, the default threshold. */
export declare function itemMatchContextOf(now: number, staleDays?: number): ItemMatchContext;
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
 * The one-call form, for a caller that filters a set in a single pass.
 *
 * This is {@link parseItemQuery} followed by {@link itemMatches}, and it exists
 * because a surface that types into a search box re-filters the WHOLE document
 * on every keystroke, so the parse has to happen outside the per-row loop. A
 * caller with that shape uses this; a caller that walks a list several times
 * with one query parses once and calls {@link itemMatches} directly.
 *
 * Named apart from {@link itemMatches} on purpose: two same-named functions
 * differing only in whether the first argument is a string is the easiest kind
 * of drift to introduce and the hardest to notice.
 * @param item - the row.
 * @param text - the raw query, parsed on each call.
 * @param now - the reading clock.
 * @param staleDays - the neglect threshold; the default when omitted.
 * @returns whether the row passes.
 */
export declare function itemMatchesText(item: ItemRecord, text: string, now: number, staleDays?: number): boolean;
/** The short number a row is called by, or the unnumbered placeholder. */
export interface ItemRef {
    /** `#12`, or `undefined` while the document has not numbered it yet. */
    readonly text: string | undefined;
    /** The number, or `undefined` when the host has not settled one. */
    readonly number: number | undefined;
    /** Whether a number exists yet. A row the host has not numbered shows a dash. */
    readonly numbered: boolean;
}
/**
 * How a row names itself.
 *
 * The number is minted by the document, so a row the reader JUST created has
 * none yet — `ref: 0` is the document's way of saying "nobody has numbered me".
 * That is a fact about the storage, not about the work, and a row that shows
 * `#0` on screen is quoting the ledger at the reader. So the projection carries
 * a separate `numbered` flag and the row draws a neutral placeholder instead.
 * @param item - the row.
 * @returns what to show, and whether a number exists.
 */
export declare function itemRefOf(item: ItemRecord): ItemRef;
/** What one row says, decided once. */
export interface ItemRowView {
    readonly item: ItemRecord;
    readonly ref: ItemRef;
    /** Never blank: an untitled row borrows its body's first line. */
    readonly title: string;
    /** The derived status, in-progress included (a linked running card). */
    readonly status: ItemStatusView;
    /** The one date verdict. `undefined` when the row has no steps. */
    readonly progress: {
        readonly done: number;
        readonly total: number;
        readonly ratio: number;
    } | undefined;
    readonly posture: DatePosture;
    readonly soft: SoftPosture;
    /** Untouched days, or `undefined` when the row is exempt or too old. */
    readonly staleDays: number | undefined;
    /** Whether the row should be given a priority chip at all. */
    readonly priorityLoud: boolean;
}
/** The reading context one row is projected against. */
export interface ItemRowContext {
    readonly now: number;
    /** Whether the linked board card is running, keyed by card id. */
    readonly running: ReadonlyMap<string, boolean>;
}
/**
 * Build one row's view.
 *
 * Every judgment the row draws is made here and nowhere else, so a row cannot
 * say two things about itself: the header that grouped it and the line inside it
 * read this one function, not two.
 * @param item - the row.
 * @param ctx - the clock and the board's live state.
 * @returns what the row says.
 */
export declare function itemRowViewOf(item: ItemRecord, ctx: ItemRowContext): ItemRowView;
/** How a page orders its rows. ONE order, shared by every page. */
export type ItemSort = 'due' | 'priority' | 'recent' | 'ref';
/** The orderings, in the order the surface offers them. */
export declare const ITEM_SORTS: readonly ItemSort[];
/**
 * Order rows under one rule.
 *
 * A total order, and the same one everywhere: every branch breaks ties, so two
 * devices holding the same rows render the same sequence and a row that moves
 * between pages does not reshuffle under the reader. A "nearest date" order
 * that leaves undated rows in document order is not a total order, and that is
 * how a list ends up looking different on two devices holding one document.
 * @param rows - the rows to order.
 * @param sort - which rule.
 * @returns the ordered copy.
 */
export declare function sortItemsOf(rows: readonly ItemRecord[], sort: ItemSort): ItemRecord[];
/** One grouped run of rows, already ordered. */
export interface ItemSlice {
    /** The STATUS the run holds; a row is in exactly one run per render. */
    readonly status: ItemStatusView;
    readonly items: readonly ItemRecord[];
    /** Step arithmetic for the run, or `undefined` when it has no steps at all. */
    readonly progress: {
        readonly done: number;
        readonly total: number;
    } | undefined;
}
/** The four groups, in the order they read top to bottom. */
export declare const ITEM_STATUS_ORDER: readonly ItemStatusView[];
/** What one grouping pass needs to know. One bag, so the order stays stable. */
export interface ItemSliceOptions {
    readonly query: ItemQuery;
    readonly ctx: ItemMatchContext & {
        readonly running: ReadonlyMap<string, boolean>;
    };
    readonly sort: ItemSort;
    /**
     * Whether finished rows come back as their own group.
     *
     * Off by default, and that is a decision rather than an omission: a finished
     * row is history, and a group that is only opened to be dismissed is a group
     * a reader learns to skip. The list page carries a switch instead, so the
     * finished rows are one gesture away and occupy nothing until asked for.
     */
    readonly includeDone?: boolean;
}
/**
 * Group rows by their DERIVED status and order each run.
 *
 * A run that comes out empty is KEPT, and the group header reports the zero. A
 * group that vanishes the moment it empties reads as a broken filter rather
 * than an empty queue, and the reader loses the map of the whole list — which
 * is the only reason the grouping earns its place at all.
 *
 * A caller that needs "did anything match" sums the runs' lengths; a caller
 * that needs "how many were there" uses the document length. The two are
 * different facts and the surface states both.
 * @param items - every row in the document.
 * @param options - the filter, the clock, the live state, the order and the switch.
 * @returns one run per group, in reading order, empty runs included.
 */
export declare function itemSlicesOf(items: readonly ItemRecord[], options: ItemSliceOptions): ItemSlice[];
/** Whether a row belongs on a working page at all. Finished work is history. */
export declare function isLiveItem(item: ItemRecord): boolean;
/**
 * The agenda's buckets, in the order they read.
 *
 * An agenda of personal work is a list, not a grid. A grid needs a time of day
 * to give a row a position on an axis, and this model has none — inventing
 * "09:00" for a bare date and then rendering it is a lie the reader has to
 * learn to ignore. The buckets exist so the list answers "what is on me", and
 * the two that answer a different question — nothing scheduled, and not yet
 * startable — are named containers rather than absences, for the same reason an
 * empty group keeps its header: a reader who cannot see where a row went will
 * assume it was lost.
 */
export declare const SCHEDULE_BUCKETS: readonly ["hardOverdue", "behind", "today", "tomorrow", "week", "later", "undated", "gated"];
export type ScheduleBucketId = typeof SCHEDULE_BUCKETS[number];
/** One bucket of the agenda. */
export interface ScheduleBucket {
    readonly id: ScheduleBucketId;
    readonly items: readonly ItemRecord[];
    /**
     * The day this bucket is about, when it is about one: a date the reader can
     * point at, not a label to re-derive. `undefined` for the buckets that are
     * not about a day.
     */
    readonly day: number | undefined;
}
/**
 * Which agenda bucket a row belongs to.
 *
 * A gated row never reaches a day bucket: it is not late, it is not due, it is
 * not startable, and showing it beside today's work is a lie about what can be
 * done today. A row whose own dates contradict each other is placed by the date
 * it does have, so it stays on the agenda to be fixed rather than vanishing
 * from it.
 * @param item - the row.
 * @param now - the reading clock.
 * @returns the bucket id.
 */
export declare function scheduleBucketOf(item: ItemRecord, now: number): ScheduleBucketId;
/**
 * Fill the agenda: every bucket, in reading order, rows ordered within.
 *
 * The set is FIXED and complete. Adding a bucket to the model adds a column to
 * every reader's agenda for a case nobody has, and a page that grows columns
 * under demand is a page nobody scans.
 * @param items - every row in the document.
 * @param query - the parsed filter.
 * @param ctx - the clock, the threshold and the board's live state.
 * @param sort - the ordering within a bucket.
 * @returns one entry per bucket, empty buckets included.
 */
export declare function scheduleBucketsOf(items: readonly ItemRecord[], query: ItemQuery, ctx: ItemMatchContext & {
    readonly running: ReadonlyMap<string, boolean>;
}, sort: ItemSort): ScheduleBucket[];
/** How loudly a triage line is allowed to speak. */
export type TriageSeverity = 'warn' | 'muted';
/**
 * One line of the triage strip: a sentence, a count, and the list it opens.
 *
 * Every line here has an action, because a number a reader cannot act on is a
 * scoreboard, and a scoreboard on a personal list rewards opening the app rather
 * than finishing anything. A line is therefore only ever emitted together with
 * the filter it opens; there is no shape here that is a bare number.
 */
export interface TriageLine {
    /** Stable id, also the filter this line applies. */
    readonly id: ItemFlag;
    readonly count: number;
    readonly severity: TriageSeverity;
    /** The rows the line is about, so the jump shows exactly what the count counted. */
    readonly items: readonly ItemRecord[];
    /** The oldest untouched days among them, when the line is about neglect. */
    readonly worstDays: number | undefined;
}
/**
 * The lines the reader has to act on, loudest first, and nothing else.
 *
 * Only lines with something in them exist: a strip that lists four zeros is
 * four rows of chrome saying nothing, and the reader learns to skip it. An
 * empty answer is a sentence on its own ("nothing is waiting"), which is a
 * different thing from four empty rows.
 *
 * The `undated` line is here and NOT in the plan, because "no date" is a
 * decision the reader has not made yet, and it is the one line a reader can
 * always clear: schedule it, park it, or delete it.
 * @param items - every row in the document.
 * @param now - the reading clock.
 * @param staleDays - the neglect threshold.
 * @returns the lines, loudest first.
 */
export declare function triageLinesOf(items: readonly ItemRecord[], now: number, staleDays?: number): TriageLine[];
