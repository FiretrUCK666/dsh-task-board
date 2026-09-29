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
 * @param running - the board's live state, for the derived 进行中; without it
 *   that one status matches nothing rather than matching everything.
 * @returns whether the row passes.
 */
export declare function itemMatchesText(item: ItemRecord, text: string, now: number, staleDays?: number, running?: ReadonlyMap<string, boolean>): boolean;
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
/**
 * How a page orders its rows. ONE order, shared by every page.
 *
 * Seven keys, and the set is CLOSED for the same reason the page set is: an
 * ordering is a question a reader can ask, and a list that grows one per
 * preference is a list whose menu nobody reads. Every key is a pure derivation
 * of fields the row already carries — no key asks the document for anything, so
 * ordering a page never needs a round trip and two devices holding one document
 * can never order it differently.
 */
export type ItemSort = 'sequence' | 'starts' | 'due' | 'hard' | 'priority' | 'birth' | 'title';
/** The orderings, in the order the surface offers them — the first is the default. */
export declare const ITEM_SORTS: readonly ItemSort[];
/**
 * The ordering a reader meets before choosing one.
 *
 * 顺序 rather than a date column, and the reason is that the date columns
 * cannot be right for a list that is mostly not scheduled: a row with no date
 * has to sort somewhere, and a date-first default spends the reader's first
 * screen on rows they never dated while the dated ones — the ones with a
 * promise attached — sink. 顺序 is the document's own order, so the first thing
 * a reader sees is what the document already believes.
 */
export declare const DEFAULT_ITEM_SORT: ItemSort;
/**
 * Order rows under one rule.
 *
 * A total order, and the same one everywhere — which is the promise all seven
 * orderings have to keep, and the reason the comparison is built as one chain
 * rather than as seven independent comparators. The chain, in order, and EVERY
 * link is load-bearing:
 *
 *  - **the number cohort decides first** ({@link numberCohortOf}): a row the
 *    document has not numbered yet waits at the end, in all seven orderings, so
 *    a note the reader just typed never displaces their own work;
 *  - then this ordering's own key, read from {@link KEY_GAPS} — one row per
 *    ordering, so an ordering nobody wrote a key for is a build failure rather
 *    than a quiet fallback;
 *  - then the short number, which the document hands out exactly once and never
 *    reuses, so it is the one key that can end any chain of numbered rows;
 *  - then the freshest change, and finally the identity, which is unique. Those
 *    last two are what make the chain total on a REPLICA as well as on the host:
 *    two rows the document has not numbered yet tie the number too, and something
 *    still has to break that.
 *
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
 * Whether a row is a MEMBER of the agenda — the one membership test, read by the
 * agenda fill and by the page rail's count, so the number on the rail is the
 * number of rows the page actually holds.
 *
 * Two exclusions, each one borrowed rather than re-argued:
 *
 *  - **FINISHED WORK IS HISTORY.** An agenda that lists work as still to do is
 *    the one lie an agenda cannot carry, and the reader's own "show me what I
 *    finished" belongs on the list page where the finished group is.
 *  - **AN UNFILED CAPTURE IS NOT ON AN AGENDA.** This is the half that used to
 *    be wrong: a bare note landed in the agenda's 「没有日期」 bucket, while the
 *    triage strip exempted exactly those rows from its own 「没有日期」 line —
 *    two surfaces, one predicate, two answers, and the second one was wrong. A
 *    thought the reader wrote a minute ago has not failed to be scheduled, it has
 *    not been READ twice yet, and the inbox is the page that holds it. So the
 *    agenda takes {@link isInboxItem}, the very predicate the triage strip uses,
 *    and `收件 ∩ 日程 = ∅` becomes true in the code rather than only in the
 *    product note.
 *
 * A filed row with no date still belongs here — it is in the 「没有日期」
 * bucket, which is a named container rather than nowhere.
 * @param item - the row.
 * @returns whether the agenda holds it.
 */
export declare function isAgendaItem(item: ItemRecord): boolean;
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
/**
 * The three numbers on the page rail, in page order.
 *
 * A `Record` keyed by {@link ItemPageId} rather than an array, so a page cannot
 * be added to the rail without a count and a page cannot be counted twice — the
 * same closed-Record idiom the sort menu and the group heads use, and for the
 * same reason: a key that does not exist is a compile error, and a key nobody
 * reads is a question that will be answered differently by the next surface.
 */
export type ItemPageCounts = Readonly<Record<ItemPageId, number>>;
/**
 * How many rows each page holds.
 *
 * EVERY COUNT IS A JUDGMENT ALREADY MADE ELSEWHERE, and this function adds no
 * new one. The inbox is {@link isInboxItem} — the very predicate the agenda's
 * membership and the triage strip's "no date" line share, so a row cannot be
 * filed on the rail and unfiled in the strip. The agenda is {@link isAgendaItem},
 * which is what the agenda itself fills by, so the number on the rail is the
 * number of rows the page actually holds rather than a second opinion about it.
 *
 * AND THE LIST PAGE COUNTS EVERYTHING, INCLUDING FINISHED WORK. That is not an
 * oversight, it is the product's central promise: completion is a switch inside
 * the list, never a fourth page, and a rail that quietly stopped counting the
 * rows a reader finished would be a second, invisible 「已完成」 page. So the
 * total the header shows is this number, and a filter says 「显示 X 条，共 M 条」
 * rather than replacing it.
 *
 * THERE IS NO CLOCK AND NO CONTEXT IN THE SIGNATURE, and that is the design
 * rather than an omission. The rail is a map of the DOCUMENT, and a number that
 * moved with the time of day — or with the search box, or with a board that is
 * not attached — would be a map that redraws itself under the person following
 * it. Which of the three dates a row has is the agenda's business; how many rows
 * the agenda holds is not.
 *
 * @param items - every row in the document, tombstones already settled.
 * @returns one number per page, in page order.
 */
export declare function itemPageCountsOf(items: readonly ItemRecord[]): ItemPageCounts;
/**
 * The four group counts, ALWAYS all four.
 *
 * The shape is a `Record` over the four derived statuses, which is the model's
 * way of saying that a surface may not invent a fifth group and may not drop
 * one: a header that renders only the groups it has rows for is a header that
 * hides the map of the list, and a detail pane's empty state that counts
 * differently from the header above it is the same defect in a second place.
 *
 * 进行中 is DERIVED, so this count is only as good as the `running` map it is
 * handed — which is the board's live state, read by the same derivation the row
 * itself reads. A caller that has no board in front of it (a query answer, a
 * dry run) passes an EMPTY map, which makes 进行中 zero rather than guessing:
 * a row that is quietly running must not be counted as 待办 and must never be
 * counted as 进行中 on a host that cannot see the session.
 *
 * @param items - every row in the document.
 * @param running - card id → whether that card is running, right now.
 * @returns one count per group, in {@link ITEM_STATUS_ORDER}.
 */
export declare function itemGroupCountsOf(items: readonly ItemRecord[], running: ReadonlyMap<string, boolean>): Readonly<Record<ItemStatusView, number>>;
/** The four tiles of the overview, in reading order. */
export declare const ITEM_INSIGHT_IDS: readonly ["open", "overdue", "today", "week"];
export type ItemInsightId = typeof ITEM_INSIGHT_IDS[number];
/** One overview tile: how many, and how much of the list that is. */
export interface ItemInsightTile {
    /** Stable id, so a surface maps it to a word rather than to a position. */
    readonly id: ItemInsightId;
    readonly count: number;
    /**
     * This tile's share of {@link ItemInsight.total}, 0..1 — the fill of a 2px
     * hairline meter.
     *
     * It is a SHARE OF THE LIST and not a gauge: a meter that filled to the brim
     * for "3 of 3 late" would draw full confidence over the reader's worst day.
     * With one denominator for all four tiles the numbers are also comparable with
     * each other, which is the only thing a row of four meters is for.
     */
    readonly ratio: number;
}
/** The whole overview: four tiles and the one number they are shares of. */
export interface ItemInsight {
    /**
     * What the tiles are shares OF: the rows that are still live, finished work
     * included in nothing. A reader's overdue count is a share of what is left to
     * do, and a list with nothing left has no share to give — which is why `total`
     * is stated rather than inferred from a ratio.
     */
    readonly total: number;
    readonly tiles: readonly ItemInsightTile[];
}
/**
 * The overview: how much is left, how much of it is late, what is on today and
 * what is inside the week.
 *
 * FOUR QUESTIONS, FOUR ANSWERS, EACH ONE A COUNT OF WHOLE ROWS — no estimate, no
 * trend, no comparison with last week. A tile that answered "trending worse"
 * would need a history this document does not keep, and a number invented from
 * a history nobody stored is the exact shape of a lie a dashboard tells.
 *
 * The buckets come from {@link scheduleBucketOf} rather than from a second set
 * of date tests, which is what makes "逾期" mean here exactly what "逾期" means
 * on the agenda: the two late buckets, and nothing else. A gated row is not
 * overdue and not due — it is waiting on a date the reader set — so it counts
 * for neither, and saying otherwise would nag about work that cannot be done
 * today.
 *
 * 本周 IS THE SEVEN-DAY HORIZON FROM TODAY (today, tomorrow and the coming week),
 * not the calendar week: a week that has not started yet answers a question the
 * reader did not ask, and a horizon is what a personal list is actually
 * planning on. It deliberately OVERLAPS 今天, because both tiles are read
 * together and a 本周 that excluded today would make the pair disagree by one
 * row for no reason.
 *
 * @param items - every row in the document.
 * @param now - the reading clock.
 * @returns the four tiles and the number they are shares of.
 */
export declare function itemInsightOf(items: readonly ItemRecord[], now: number): ItemInsight;
