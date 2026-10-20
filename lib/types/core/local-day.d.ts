/**
 * The reader's calendar day — one place that knows what a day is.
 *
 * ── 为什么是「本地的」，而且是唯一的 ────────────────────────────────────────
 *
 * 一个时刻属于哪一天，取决于**谁的日历**：读者的日历是本地的，所以
 * `yyyy-mm-dd` 必须按本地年月日拼（`getFullYear` / `getMonth` / `getDate`），
 * 而不是 `toISOString()`——后者按 UTC 算，于是每个落在傍晚之后、或格林尼治
 * 以西的行都会落到错误的那一天。
 *
 * 这个函数曾经有**两个家**：清单那一份叫 `localDayKey`，活动流那一份叫
 * `dayBucketOf`。两个名字、同一段算法、连补零都一样——而「同一个家」那道门禁
 * 按**名字**查，所以它一次也没报。两个家意味着改一处不动另一处，而屏上不会
 * 有任何东西说得出为什么某一天的分组和某一天的日期对不上。
 *
 * 所以这里只有一个家，一个名字：**它是一个键，不是一个桶**——「桶」是界面
 * 拿它去分的组，键才是它本身。
 *
 * 与 `item-dates.ts` 的 `startOfDay` 是同一件事的两种读法：那是那一天的**起
 * 点**，这是那一天的**键**。
 * @module dsh-task-board/core/local-day
 */
/**
 * A moment as `yyyy-mm-dd`, in LOCAL time.
 *
 * LOCAL, not UTC, and that is the whole comment. The reader's calendar is
 * local: a row due today is due today on the machine they are sitting at, and
 * a key built from `toISOString()` puts every row that falls after the evening
 * cutoff — or anywhere west of Greenwich — on the wrong day. It is the same
 * reason `startOfDay` is local in core, and the same reason a stored instant
 * is never printed as a bare date without going through here.
 * @param at - the instant.
 * @returns the local calendar day, as `yyyy-mm-dd`.
 */
export declare function localDayKey(at: number): string;
