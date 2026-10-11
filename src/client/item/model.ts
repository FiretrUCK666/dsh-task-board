/**
 * The browser-only half of the checklist's pure layer: an identity, and the
 * three ways a human reads and writes a date.
 *
 * WHAT IS LEFT HERE, AND WHY IT IS EXACTLY THIS. An edit written here as well as
 * in the model — a field patch, a step toggle, a delete and a
 * capture, each with its own no-op test and its own step-id scheme — is the
 * second copy this project keeps removing, and the checklist is the second
 * SYNCED document, so a copy is not untidy there: it is two devices disagreeing
 * about which edits happened. All of it lives in `core/item-transitions.ts`,
 * which the panel, the detail pane and the model's six `item.*` verbs call
 * alike.
 *
 * What cannot move out of a browser is what is left:
 *  - the identity, because `crypto.randomUUID` is a secure-context API and the
 *    document only ever hands out the SHORT number, which a replica must guess
 *    optimistically;
 *  - the date formatting, because the wording is a locale and the input is a
 *    `<input type="date">` — a shape only a browser draws.
 *
 * A ROW-HEIGHT TYPE IS DELIBERATELY NOT HERE, and no density control is offered, * because a preference whose effect the reader cannot see is worse than no
 * preference: the control still takes a track in the header, still spends a
 * dictionary word, and still teaches the reader that this row height is
 * something they set — and when they change it and nothing moves, they conclude
 * the panel is broken. A row's block padding is a FLOOR for a coarse pointer,
 * not a tier: 12px is what a finger needs to hit, and it is the same number on a
 * desk, so the honest form of this fact is a constant rather than a setting.
 *
 * NOTHING HERE JUDGES ANYTHING about a row. What a row says, which page it is
 * on, how it groups, what its three dates mean, and what an edit DOES to the
 * document are all core derivations read by the human surface and by
 * `taskboard_query` alike — see `core/item-view.ts` and
 * `core/item-transitions.ts`.
 */
import { DAY_MS, startOfDay } from '../../core/item-view.ts'
import type { ItemDateKey } from '../../core/item.ts'

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
export function newItemId(): string {
  const webCrypto = globalThis.crypto
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID()
  const bytes = webCrypto?.getRandomValues?.(new Uint8Array(16)) ?? Uint8Array.from({ length: 16 }, () => Math.floor(Math.random() * 256))
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80
  const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

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
export function formatItemDate(at: number, english: boolean, now: number = Date.now()): string {
  const date = new Date(at)
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  if (english) {
    /* `year: 'numeric'` IS the whole condition, not a preference: the default
     * drops the year on every date, so a deadline in the next year reads exactly
     * like one in this year — and 「明年十月」 is the one date a reader cannot
     * afford to misread. */
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      ...(sameYear ? {} : { year: 'numeric' }),
    })
  }
  /* THE YEAR IS DROPPED ONLY WHEN IT IS THIS YEAR'S. 同一年的日期印不印年份，
   * 规则不随调用点变：四个地方读日期（行尾、详情、日程日名、卡片）如果各自
   * 决定一次，就会出现同一份文档里两种写法。
   *
   * `now` 是一个参数而不是内部读钟：面板有一份可注入的钟，测试要的是**给定**
   * 的今天而不是机器的今天，而一个「自己读钟」的格式化函数没法被确定地测。 */
  return sameYear
    ? `${date.getMonth() + 1}月${date.getDate()}日`
    : `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

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
export function formatDayKey(key: string, english: boolean, now: number = Date.now()): string {
  const [year, month, day] = key.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined
    || Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return key
  return formatItemDate(new Date(year, month - 1, day).getTime(), english, now)
}

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
export function parseItemDate(value: string, now: number = Date.now()): number | undefined {
  const reading = readDateExpression(value, now)
  return reading.kind === 'at' ? reading.at : undefined
}

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
  | 'unreadable'
  /** 有日期没年份，而那个日期今年已经过去了。改法：把年份写上。 */
  | 'past'
  /** 日历上没有这一天。改法：核对月份与日期。 */
  | 'impossible'

/** 一次读日期的结果：读到了那一刻，或者读不懂并说得出是哪一种不懂。 */
export type DateReading =
  | { readonly kind: 'at'; readonly at: number }
  | { readonly kind: 'bad'; readonly reason: DateBadReason }

/** WHAT A DATE FIELD SAYS, IN THREE ANSWERS INSTEAD OF ONE `undefined`. */
export type DateDraft =
  | { readonly kind: 'empty' }
  | { readonly kind: 'bad'; readonly reason: DateBadReason }
  | { readonly kind: 'at'; readonly at: number }

/** Read a date field's draft. See {@link DateDraft} for why this is not `parseItemDate`. */
export function readDateDraft(text: string, now: number): DateDraft {
  if (text.trim() === '') return { kind: 'empty' }
  return readDateExpression(text, now)
}

/** Weekday words, Monday first, to match `Date.getDay()` after the offset. */
const WEEKDAYS: Readonly<Record<string, number>> = {
  '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7,
}

/** Fixed words for the near days. */
const NEAR_DAYS: Readonly<Record<string, number>> = {
  前天: -2, 昨天: -1, 今天: 0, 今日: 0, 明天: 1, 明日: 1, 后天: 2, 大后天: 3,
  yesterday: -1, today: 0, tomorrow: 1,
}

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
export function readDateExpression(text: string, now: number): DateReading {
  const today = startOfDay(now)
  const word = text.trim()
    .replace(/^@/, '')
    .replace(DATE_NAME_STRIP, '')
    .toLowerCase()
  if (word === '') return { kind: 'bad', reason: 'unreadable' }
  const offset = NEAR_DAYS[word]
  if (offset !== undefined) return { kind: 'at', at: today + offset * DAY_MS }
  if (word === '下周') return { kind: 'at', at: today + 7 * DAY_MS }
  const weekday = WEEKDAYS[word.replace(/^下/, '')]
  if (weekday !== undefined) {
    // Strictly forward: a weekday that has already passed this week means the next
    // one, and saying so is arithmetic rather than a guess. `下X` pins the following
    // week, which is the one case where "next" is the whole point.
    const isNextWeek = word.startsWith('下')
    const named = new Date(today).getDay()
    let delta = weekday - (named === 0 ? 7 : named)
    if (delta <= 0) delta += 7
    return { kind: 'at', at: today + (isNextWeek ? delta + 7 : delta) * DAY_MS }
  }
  const relative = /^\+(\d{1,3})$/.exec(word)
  if (relative !== null) return { kind: 'at', at: today + Number(relative[1]) * DAY_MS }
  const day = readCalendarDay(word)
  if (day === undefined) return { kind: 'bad', reason: 'unreadable' }
  return momentOf(day, now)
}

/**
 * 三个日期的**名字表**：一处定义，三个读者（字段那一侧的剥离、一行那一侧的解析、
 * 名字本身的意思）。`早` / `晚` 是打字的活儿留下的单字短写，与 `开始` / `截止` 同义。
 */
export const DATE_NAME_FIELD: Readonly<Record<string, ItemDateKey>> = {
  开始: 'startsAfter', 早: 'startsAfter',
  计划: 'dueAt',
  截止: 'hardDueAt', 晚: 'hardDueAt',
  start: 'startsAfter', starts: 'startsAfter',
  target: 'dueAt',
  deadline: 'hardDueAt',
}

/** 那张表的剥离式：`@截止 10/9` 里的名字在这里只是读者的说话方式。 */
const DATE_NAME_STRIP = new RegExp(`^(?:${Object.keys(DATE_NAME_FIELD).join('|')})\\s*`, 'i')

/** 印出来的英文月份（`formatItemDate` 的 `en-US` 那一半），三个字母。 */
const MONTH_NAMES: Readonly<Record<string, number>> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

/** 一个日历上的日期：哪一年（读者没写就是 `undefined`）、哪个月、哪一天。 */
interface CalendarDay {
  readonly year: number | undefined
  readonly month: number
  readonly day: number
}

/**
 * 读一个**日历上的日期**，中文与英文两套写法。
 *
 * 这里只管「读者写出了哪三个数」，不管那一天存不存在、也不管它过去了没有——
 * 那是 {@link momentOf} 的事。分开是因为「写法没读懂」与「这一天不成立」是两种拒绝。
 * @param word - 已经去掉 `@`、名字与大小写的那些字。
 * @returns 三个数，或者 `undefined`（这串字不是日历写法）。
 */
function readCalendarDay(word: string): CalendarDay | undefined {
  const yearFirst = /^(\d{4})(?:年|[-/])(\d{1,2})(?:月|[-/])(\d{1,2})日?$/.exec(word)
  if (yearFirst !== null) {
    return { year: Number(yearFirst[1]), month: Number(yearFirst[2]), day: Number(yearFirst[3]) }
  }
  const monthDay = /^(\d{1,2})月(\d{1,2})日?$/.exec(word)
  if (monthDay !== null) return { year: undefined, month: Number(monthDay[1]), day: Number(monthDay[2]) }
  const numeric = /^(\d{1,2})[-/](\d{1,2})$/.exec(word)
  if (numeric !== null) return { year: undefined, month: Number(numeric[1]), day: Number(numeric[2]) }
  const english = /^([a-z]{3})\.?\s+(\d{1,2})(?:,\s*(\d{4}))?$/.exec(word)
  if (english !== null) {
    const month = MONTH_NAMES[english[1] as string]
    if (month === undefined) return undefined
    return { year: english[3] === undefined ? undefined : Number(english[3]), month, day: Number(english[2]) }
  }
  return undefined
}

/**
 * 三个数 → 那一刻，或者两种拒绝之一。
 *
 * **回读比对是这件事的全部实质**：`new Date(2026, 12, 45)` 是一个合法的 `Date`
 * （它滚到 2027-02-14），所以「构造成功」不证明那一天存在——把它读回来，三个数与
 * 写进去的对不上，就说明日历上没有这一天。没有这一步，读者的笔误会被静默改写成
 * 另一个日期，而屏上没有一个字说这件事。
 * @param day - 读者写下的三个数。
 * @param now - 读钟：年份没写时用它的那一年。
 * @returns 那一刻，或者 `impossible` / `past`。
 */
function momentOf(day: CalendarDay, now: number): DateReading {
  const year = day.year ?? new Date(now).getFullYear()
  const at = new Date(year, day.month - 1, day.day)
  if (at.getFullYear() !== year || at.getMonth() !== day.month - 1 || at.getDate() !== day.day) {
    return { kind: 'bad', reason: 'impossible' }
  }
  const stamp = at.getTime()
  /* 没写年份 + 已经过去 = 今年与明年都成立。猜一个就是把一天挪一年，所以拒；带上年份
   * 就能精确说清（`momentOf` 的 `day.year` 一给，这一天就不再歧义）。 */
  if (day.year === undefined && stamp < startOfDay(now)) return { kind: 'bad', reason: 'past' }
  return { kind: 'at', at: stamp }
}

/**
 * **这串字看起来是在写一个日期吗。**
 *
 * 快记里的一串字读不懂时要不要出声，判据就是它：`@13/45`、`@下个月`、`@截止 下个月` 是在
 * 写日期，读不懂必须说；而 `@每周`、`@张三`、`@晚餐的菜单`、`@日本料理` 里的 `@` 只是一个
 * 符号，说了就是噪声——而一句会被读者学会忽略的提示，等于没有提示。
 *
 * 判据只读**形状**，不读意思：数字、单个星期字、以及那几个只有日期会用的词头。写成
 * 「含 `月` 或 `日` 二字」是不行的——`月光曲` 与 `日本料理` 会因此开始报错，而这条判据的
 * 全部价值就在于它不乱说话。
 * @param word - `@` 后面那些字（名字已经剥掉）。
 * @returns 是否像在写一个日期。
 */
export function looksLikeDate(word: string): boolean {
  const text = word.trim()
  if (text === '') return false
  if (/\d/.test(text)) return true
  if (/^(?:下|周)?[一二三四五六日天]$/.test(text)) return true
  return /^(?:今天|今日|明天|明日|昨天|前天|后天|大后天|下周|下个月|这个月|下月|本月|月底|月初|周末|今年|明年|去年)/.test(text)
}

/** Render a moment for a `yyyy-mm-dd` date field. */
export function toItemDateField(at: number | undefined): string {
  return at === undefined ? '' : localDayKey(at)
}

/**
 * A moment as `yyyy-mm-dd`, in LOCAL time.
 *
 * LOCAL, not UTC, and that is the whole comment. The reader's calendar is local:
 * a row due today is due today on the machine they are sitting at, and a key
 * built from `toISOString()` puts every row that falls after the evening
 * cutoff — or anywhere west of Greenwich — on the wrong day. It is the same
 * reason `startOfDay` is local in core, and the same reason a stored instant is
 * never printed as a bare date without going through here.
 */
export function localDayKey(at: number): string {
  const date = new Date(at)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
