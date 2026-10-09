/**
 * The browser-only half of the checklist's pure layer: an identity, and the
 * three ways a human reads and writes a date.
 *
 * WHAT IS LEFT HERE, AND WHY IT IS EXACTLY THIS. An edit used to be written
 * here as well as in the model — a field patch, a step toggle, a delete and a
 * capture, each with its own no-op test and its own step-id scheme. That was the
 * second copy this project keeps removing, and the checklist is the second
 * SYNCED document, so a copy is not untidy there: it is two devices disagreeing
 * about which edits happened. All of it now lives in `core/item-transitions.ts`,
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
  if (value.trim() === '') return undefined
  return parseDateExpression(value, now)
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
 * **一套日期词，两个入口。**
 *
 * 读者在哪儿学、在哪儿用，认的都该是同一批写法：固定的近日子（`今天`/`明天`/`前天`…）、
 * 星期几（`三`/`周三`/`下三`）、`+N`、`2026/10/15`、`10/15`（还没到才算），以及字段里那个
 * 严格形式 `2026-10-15`。开头可以带 `@`，也可以带那个日子的名字（`@不晚于 10/9`）——
 * 名字在这里只是**读者说话的方式**：这个框本来就知道自己是哪个日子。
 *
 * 两个入口曾经各认一半：快记认星期几与 `+N`，日期框只认 `2026-10-15` 与「明天」——
 * 于是读者在快记得学会的写法，在它旁边那个框里被拒，而那两个框说的是同一件事。
 * @param text - what the reader wrote.
 * @param now - the reading clock; every word resolves against it.
 * @returns the local midnight of that day, or `undefined` when the words do not name one.
 */
export function parseDateExpression(text: string, now: number): number | undefined {
  const today = startOfDay(now)
  const word = text.trim()
    .replace(/^@/, '')
    .replace(/^(?:不早于|不晚于|希望(?:在)?|早|晚|not before|wanted by|deadline)\s*/i, '')
    .toLowerCase()
  if (word === '') return undefined
  const offset = NEAR_DAYS[word]
  if (offset !== undefined) return today + offset * DAY_MS
  if (word === '下周') return today + 7 * DAY_MS
  const weekday = WEEKDAYS[word.replace(/^下/, '')]
  if (weekday !== undefined) {
    // Strictly forward: a weekday that has already passed this week means the next
    // one, and saying so is arithmetic rather than a guess. `下X` pins the following
    // week, which is the one case where "next" is the whole point.
    const isNextWeek = word.startsWith('下')
    const named = new Date(today).getDay()
    let delta = weekday - (named === 0 ? 7 : named)
    if (delta <= 0) delta += 7
    return today + (isNextWeek ? delta + 7 : delta) * DAY_MS
  }
  const relative = /^\+(\d{1,3})$/.exec(word)
  if (relative !== null) return today + Number(relative[1]) * DAY_MS
  const full = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(word)
  if (full !== null) {
    const at = new Date(Number(full[1]), Number(full[2]) - 1, Number(full[3]))
    return Number.isFinite(at.getTime()) ? at.getTime() : undefined
  }
  const short = /^(\d{1,2})[/-](\d{1,2})$/.exec(word)
  if (short !== null) {
    const at = new Date(new Date(now).getFullYear(), Number(short[1]) - 1, Number(short[2]))
    const stamp = at.getTime()
    // Past means ambiguous, and ambiguous means untouched. A year-qualified date is
    // there for the year the reader actually means.
    return Number.isFinite(stamp) && stamp >= today ? stamp : undefined
  }
  return undefined
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
