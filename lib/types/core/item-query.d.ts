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
import type { TaskStatus } from './tasks.ts';
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
 * The tier behind each `!N` — **derived from the table above**, so the two spellings
 * of one ladder cannot drift. It is the single source the row's mark, the keyboard's
 * `1`–`4` and the capture grammar's `!N` all read: three hand-written digit tables
 * used to exist beside it, each one edit away from disagreeing with the others.
 */
export declare const PRIORITY_DIGIT: Readonly<Record<ItemPriority, string>>;
/**
 * The token that writes each tier — the inverse of the table above, derived rather
 * than retyped. Two callers (the rail's filter rows and the search box's facet) ask
 * 「what do I put in the box for this tier」, and an inverse written by hand is the
 * classic place for a re-tiered priority to keep pointing at the old number.
 */
export declare const TOKEN_BY_PRIORITY: ReadonlyMap<ItemPriority, string>;
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
/**
 * 有日子，而且那个日子**还没到**（今天也算没到）。
 *
 * 它存在的理由是读者对左栏那一组的一句问话：「它这个日期的逻辑是什么呢？我有点看不懂。」
 * 那一组当时是「已超期 · 迟迟没动 · 没定日期」——**三个行里有一个不是日期问题**（多久没人
 * 碰），而剩下两个也没把日期说完：一份未来到期的行**落在这一组之外**，于是「按日子」这四个
 * 字在屏上并不成立。
 *
 * 有了这一枚，那一组才真的在按日子分：**已经过期 / 还没到 / 没定日期**——一条行里只要
 * 分过流（不是刚记下的那句），它的日子就必定在过去、在未来、或者根本没有，**落进且只落进
 * 一格**，三个数加得起来。而「多久没人碰」搬去它自己那一组（`item-rail.ts` 的 `idle`）。
 *
 * 两种「不在任何一格」的行，都是**故意的**，且各有各的读者：刚记下的一句（`isInboxItem`）
 * 还没到能谈日子的阶段；三个日期互相矛盾的那一条（`contradiction`）**两边都有日子**，
 * 它自己有那句话去说（「最早开始 比 截止 早」），把它们硬塞进「已经过期」会让那个词变成
 * 一句不完整的话。
 */
 | 'ahead'
/** `startsAfter` is in the future. */
 | 'gated'
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
 * **AND IT SPELLED OUT ONE HALF OF ITS OWN TYPE FOR SIX RELEASES' WORTH.** 那些
 * `status:` 词原来取自 `ITEM_STATUSES`（人能选的那几个），而**派生的那一个**（当时叫
 * `inProgress`）不在那张表里，于是解析器一直收它、`isItemQualifierToken` 一直答 yes，
 * 而教给模型的这一份词表从来没有它。现在两个表都取自看板那五栏的同一个来源
 * （{@link ITEM_STATUS_VIEWS} = `ALL_STATUSES`），所以「能被显示的全部」与「被教出去的
 * 全部」是同一句话——`status:` 后面能出现的词就是那五个，一个不多、一个不少。
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
     * **看板的栏，按卡片 id 索引** —— 一条行「现在在哪一栏」的那张输入。
     *
     * 它原来叫 `running`，装的是 `boolean`（那张卡在不在跑）；现在装的是 `TaskStatus`
     * （那张卡在哪一栏），因为清单自己的状态只剩两个值，而其余三栏只有看板知道。名字
     * 跟着事实改：一个叫 `running` 的字段装着「待审核」，下一个人会以为那是笔误。
     *
     * Optional rather than required, and the absence is a real answer rather than
     * a gap: a caller with no board in front of it (a dry run, a host that cannot
     * see the engine) passes nothing, and then a mounted row reads its OWN two
     * values — it does not pretend to know a column it cannot see. What that caller
     * must not do is guess a column, which is what hard-coding `false` did:
     * `status:inProgress` was a documented filter that silently matched nothing, in
     * the search box AND in the model's query.
     */
    readonly cards?: ReadonlyMap<string, TaskStatus>;
}
/** The default reading context: right now, the default threshold, no board. */
export declare function itemMatchContextOf(now: number, staleDays?: number, cards?: ReadonlyMap<string, TaskStatus>): ItemMatchContext;
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
