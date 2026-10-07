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
 * A ROW-HEIGHT TYPE IS DELIBERATELY NOT HERE, and no density control is offered,
 * because a preference whose effect the reader cannot see is worse than no
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
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  /* THE WORD FORMS, by offset in days from today's own midnight. Both the
   * bare word and the `@`-stamped word resolve the same way; the stamp is how
   * the capture grammar says 「this is a date」, and here it costs nothing to
   * accept what the reader already typed. */
  const said = trimmed.replace(/^@/, '').toLowerCase()
  const offset = WORD_DAYS[said]
  if (offset !== undefined) {
    const day = new Date(now)
    day.setHours(0, 0, 0, 0)
    day.setDate(day.getDate() + offset)
    return day.getTime()
  }
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (parts === null) return undefined
  const [year, month, day] = parts.slice(1).map(Number) as [number, number, number]
  const at = new Date(year, month - 1, day).getTime()
  return Number.isFinite(at) ? at : undefined
}

/** The word forms the field accepts, keyed by their day offset from today. */
const WORD_DAYS: Readonly<Record<string, number>> = {
  前天: -2, 昨天: -1, 今天: 0, 明天: 1, 后天: 2,
  yesterday: -1, today: 0, tomorrow: 1,
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
