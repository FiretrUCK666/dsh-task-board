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
 * WHAT A DATE FIELD SAYS, IN THREE ANSWERS INSTEAD OF ONE `undefined`.
 *
 * `parseItemDate` answers 「which moment is this」, and it folds two different
 * facts into a single `undefined`: **no promise at all** (an empty field) and
 * **I could not read this**. Every surface that WRITES a date needs those two
 * apart, because one of them is a legitimate answer and the other must never be
 * dropped quietly. A new-row sheet that calls `parseItemDate` directly and spreads
 * the result into the capture turns a date it cannot read into
 * `{ dueAt: undefined }` — the row is saved, the day the reader typed is
 * gone, and nothing on screen says a word about it. That is a silent data loss,
 * and it is the difference between a refusal and an omission.
 *
 * So both readers of a date draft — the detail's in-place field and the sheet's
 * field — ask THIS function instead of each deciding what `undefined` means.
 * One verdict table, two consumers: 「读不懂就不写，并且当场说」 is then a
 * property of the vocabulary rather than a habit each surface has to remember.
 * @param text - what the reader has typed so far.
 * @param now - the reading clock; a WORD resolves against it.
 * @returns empty, unreadable, or the moment it named.
 */
/**
 * 读不懂的三种原因。**三件事，三种改法**——所以它们不是同一句话。
 *
 * `parseItemDate` 把所有读不出来的字都折成一个 `undefined`（它回答的是「这是哪一刻」），
 * 而一处**拒绝**要回答的是「接下来改什么」：换一种写法、把年份补上、还是核对月份与日期。
 * 一句话盖住三种情况，就是把三种改法说成一种。
 */
export type DateBadReason = 
/** 这串字不在这门语言里。改法：换一种写法。 */
'unreadable'
/** 有日期没年份，而那个日期今年已经过去了。改法：把年份写上。 */
 | 'past'
/** 日历上没有这一天。改法：核对月份与日期。 */
 | 'impossible';
/** 一次读日期的结果：读到了那一刻，或者读不懂并说得出是哪一种不懂。 */
type DateReading = {
    readonly kind: 'at';
    readonly at: number;
} | {
    readonly kind: 'bad';
    readonly reason: DateBadReason;
};
/** WHAT A DATE FIELD SAYS, IN THREE ANSWERS INSTEAD OF ONE `undefined`. */
export type DateDraft = {
    readonly kind: 'empty';
} | {
    readonly kind: 'bad';
    readonly reason: DateBadReason;
} | {
    readonly kind: 'at';
    readonly at: number;
};
/** Read a date field's draft. See {@link DateDraft} for why this is not `parseItemDate`. */
export declare function readDateDraft(text: string, now: number): DateDraft;
/**
 * **一套日期词，一处定义。**
 *
 * 读者在哪儿学、在哪儿用，认的都该是同一批写法：邻近的那几天（`今天`/`明天`/`前天`…）、
 * 星期几（`三`/`周三`/`下三`）、`+N`、以及**日历上的那一天**——`2026-10-15`、`2026/10/15`、
 * `2026年10月15日`、`10月15日`、`10/15`。开头可以带 `@`，也可以带那个日期的名字
 * （`@截止 10/9`）——名字在这里只是**读者说话的方式**：这个框本来就知道自己是哪个日期。
 *
 * ── 为什么日历那几种写法必须都认 ──────────────────────────────────────────────
 *
 * 因为**这一页自己就是这么印的**：行尾、详情、日程节头印的是 `10月15日`。印得出来、
 * 读不回来，就是读者照着屏上的样子打一遍，然后被告知「这个读法我没读懂」——
 * 而这门语言里最不该拒的就是自家印的那一种。所以「印出来的读得回来」是一条性质，
 * 由 `.spec.ts` 里那个从 `formatItemDate` 生成的用例守着，而不是靠这里多列一行。
 *
 * ── 三种拒绝，三种改法 ────────────────────────────────────────────────────────
 *
 * 「日历上没有这一天」与「这串字不认识」是两件事：前者 `new Date(2026, 12, 45)` 会
 * **悄悄滚**到 2027-02-14，于是读者的「12 月 45 日」变成二月里的一天（`impossible`）；
 * 后者是换一种写法（`unreadable`）。而写着日期却没写年份、那个日期今年已经过去了，
 * 是第三件：今年 / 明年两个意思都成立，猜一个就是**把一天挪一年**（`past`，
 * `PRODUCT.md` 把这条歧义钉成了拒绝——补上年份即可）。三种各有一句话，见
 * `date-field.tsx`。
 * @param text - what the reader wrote.
 * @param now - the reading clock; every word resolves against it.
 * @returns the local midnight of that day, or which of the three refusals it is.
 */
export declare function readDateExpression(text: string, now: number): DateReading;
/** Render a moment for a `yyyy-mm-dd` date field. */
export declare function toItemDateField(at: number | undefined): string;
export {};
