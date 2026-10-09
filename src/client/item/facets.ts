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
import { isItemQualifierToken, type ItemFlag, type ItemQuery, type ItemStatusView } from '../../core/item-view.ts'
import { ITEM_STATUS_VIEWS } from '../../core/item.ts'
import type { ItemPriority } from '../../core/item.ts'
import { STATUS_KEY } from '../board/status.ts'
import type { TaskBoardKey } from '../locales.ts'

/** The four faces a filter row offers. */
export type ItemFacetId = 'status' | 'priority' | 'tag' | 'date'

/** One selectable value of a FIXED facet: the token, and a word we have. */
export interface FacetValue {
  /** Exactly what is written into the search box. */
  readonly token: string
  /** The stable value, for asking core whether it is already on. */
  readonly key: string
  readonly label: TaskBoardKey
}

/**
 * A tag's own chip. A separate type rather than a `FacetValue` with an empty
 * label, because a tag is the READER'S word and the locale has no entry for it
 * — and a chip that renders `undefined` because it reached for a dictionary it
 * was never going to find is the exact failure a closed Record exists to stop.
 */
export interface TagFacetValue {
  readonly token: string
  /** Lower-cased, because the grammar lower-cases tags and the comparison has to. */
  readonly key: string
  /** Spelled the way the reader spelled it. */
  readonly text: string
}

/** The three fixed facets, and their values, in reading order. */
export const ITEM_FACETS: readonly { readonly id: ItemFacetId; readonly label: TaskBoardKey; readonly values: readonly FacetValue[] }[] = [
  {
    id: 'status',
    label: 'item.facet.status',
    /* **五栏，就是看板那五栏**，词也取自看板那一份（`STATUS_KEY`）：挂卡的行走在
     * 哪一栏由那张卡回答，没挂卡的行走在清单自己的两个值上。表是派生的（
     * `ITEM_STATUS_VIEWS`），所以加一栏时这一屏不会漏。 */
    values: ITEM_STATUS_VIEWS.map(view => ({
      token: `status:${view}`,
      key: view,
      label: STATUS_KEY[view],
    })),
  },
  {
    id: 'priority',
    label: 'item.facet.priority',
    values: [
      { token: 'p1', key: 'urgent', label: 'item.priority.urgent' },
      { token: 'p2', key: 'high', label: 'item.priority.high' },
      { token: 'p3', key: 'normal', label: 'item.priority.normal' },
      { token: 'p4', key: 'low', label: 'item.priority.low' },
    ],
  },
  {
    id: 'date',
    label: 'item.facet.date',
    values: [
      { token: 'has:hardOverdue', key: 'hardOverdue', label: 'item.due.overdueShort' },
      { token: 'has:behind', key: 'behind', label: 'item.triage.behindShort' },
      { token: 'has:undated', key: 'undated', label: 'item.due.undated' },
      { token: 'has:gated', key: 'gated', label: 'item.bucket.gated' },
    ],
  },
]

/**
 * Every token the FACET EDITS speak, lower-cased — kept only so a reader's own
 * free text is never mistaken for a control. The QUESTION it answers is now
 * asked of the model itself (`isItemQualifierToken`), so a qualifier the grammar
 * knows and this file does not is still recognised as one: the hand-built set
 * this replaced had drifted from the grammar twice, and each time the cost was
 * the same — the filter applied, the raw token appeared in the field the reader
 * was typing in, and no chip was drawn to say what had filtered the list.
 */
function qualifierTokensOf(): ReadonlySet<string> {
  const out = new Set<string>()
  for (const facet of ITEM_FACETS) {
    for (const value of facet.values) out.add(value.token.toLowerCase())
  }
  return out
}

const QUALIFIER_TOKENS = qualifierTokensOf()

/** Is this token one the facets write — a control the reader set, not a word? */
function isQualifierToken(token: string): boolean {
  return isItemQualifierToken(token) || QUALIFIER_TOKENS.has(token.toLowerCase())
}

/**
 * The part of the query that is the reader TYPING — their words, and nothing else.
 *
 * THIS IS THE WHOLE POINT OF THE FUNCTION, so it is worth being explicit about
 * what it buys. The query is ONE string, and it stays one string: the model reads
 * the same grammar, and a reader who wants it can still type `status:todo` into
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
export function freeTextOf(text: string): string {
  return text.split(/\s+/).filter(part => part !== '' && !isQualifierToken(part)).join(' ')
}

/**
 * One qualifier, as the reader sees it.
 *
 * `facet` and `value` are the two halves of the chip's own name; `tag` exists
 * because a tag is the reader's word and has no dictionary entry, and a chip that
 * reached for one would render `undefined`. `token` is the exact string in the
 * box, so removing the chip is the same byte-for-byte operation as adding it was.
 */
export interface QueryChip {
  readonly facet: TaskBoardKey
  readonly value: TaskBoardKey | null
  readonly tag: string | null
  /**
   * A DAY, as the key the grammar stores (`YYYY-MM-DD`), for a chip that stands
   * for one calendar cell.
   *
   * IT IS ITS OWN FIELD AND NOT A `tag`. A tag is the reader's own word and is
   * printed back the way they spelled it; a day is a key that has to go through
   * the date formatter, because `on:2026-09-29` in front of a reader is the
   * implementation of the filter, not the filter. Two facts with two spellings
   * are two fields.
   */
  readonly day: string | null
  readonly token: string
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
export function queryChipsOf(text: string, tags: readonly (readonly string[])[] = []): QueryChip[] {
  const byTag = new Map<string, string>()
  for (const list of tags) {
    for (const tag of list) {
      const key = tag.trim()
      if (key !== '' && !byTag.has(key.toLowerCase())) byTag.set(key.toLowerCase(), key)
    }
  }
  const present = new Set(text.split(/\s+/).filter(part => part !== '').map(part => part.toLowerCase()))
  const chips: QueryChip[] = []
  /* THE DAY FILTER IS A CHIP LIKE ANY OTHER, and it took a while to get here.
   *
   *  A day was the one filter that could be ON with nothing on screen saying so:
   *  the calendar's own cell wears a ring, but a ring in a 26px square is a weak
   *  way to say 「your list is narrowed to one day」 — and on the band where the
   *  calendar is folded there was no ring at all. A reader pressed the 8th, saw an
   *  empty list, pressed the 9th, saw an empty list, and had no way to read back
   *  what they had asked for. It is a chip now, because every other filter is. */
  for (const token of dayTokensIn(text)) {
    const day = token.slice(3)
    chips.push({ facet: 'item.facet.date', value: null, tag: null, day, token })
  }
  for (const facet of ITEM_FACETS) {
    for (const value of facet.values) {
      if (!present.has(value.token.toLowerCase())) continue
      chips.push({ facet: facet.label, value: value.label, tag: null, day: null, token: value.token })
    }
  }
  // A tag the reader typed by hand and that this document does not hold is still
  // a filter on screen, so it gets a chip too — with the spelling THEY used,
  // because the whole point of the chip is to show their own word back to them.
  for (const spelled of byTag.values()) {
    const token = `#${spelled}`
    if (!present.has(token.toLowerCase())) continue
    chips.push({ facet: 'item.facet.tag', value: null, tag: spelled, day: null, token })
  }
  for (const part of text.split(/\s+/)) {
    const lower = part.toLowerCase()
    if (lower === '' || !lower.startsWith('#') || lower.length < 2) continue
    if (byTag.has(lower)) continue
    if (chips.some(chip => chip.token.toLowerCase() === lower)) continue
    chips.push({ facet: 'item.facet.tag', value: null, tag: part.slice(1), day: null, token: part })
  }
  return chips
}

/**
 * Every `on:` day token in the box, exactly as written.
 *
 * The one reader of the day grammar on this side of the wall, and it exists
 * because the day predicate needs BOTH halves of the same set: the chips that
 * show the filter, and the sibling list that makes a new press replace the old
 * one. Two spellings of `on:` in two files is how one of them ends up matching
 * `on:2026-9-3` and the other not.
 */
export function dayTokensIn(text: string): string[] {
  return text.split(/\s+/).filter(part => /^on:\d{4}-\d{2}-\d{2}$/i.test(part))
}

/**
 * The status facet's values, keyed the way the model names a group.
 *
 * **派生，不是抄的**：它原来是四个硬编码字符串（`inProgress`/`open`/`blocked`/`done`）,
 * 而 `ITEM_STATUS_VIEWS` 就是那张表——加一栏时这里漏一份不会报错，只会让新那一栏的
 * 芯片**按下去不亮**（查询里有它、判断里没有它）。
 */
const STATUS_KEYS: ReadonlySet<string> = new Set<string>(ITEM_STATUS_VIEWS)

/**
 * Whether a facet's value is currently in the query.
 *
 * Asked of the PARSE, never of a set this module kept: the box's text is the
 * only state there is, so a value the reader typed by hand lights up exactly
 * like one they clicked, which is the behaviour that makes the box and the chips
 * read as one control instead of two that happen to share a row.
 */
export function isFacetOn(query: ItemQuery, facet: ItemFacetId, key: string): boolean {
  if (facet === 'status') return query.status.includes(key as ItemStatusView) && STATUS_KEYS.has(key)
  if (facet === 'priority') return query.priority.includes(key as ItemPriority)
  if (facet === 'date') return query.flags.has(key as ItemFlag)
  return query.tags.includes(key.toLowerCase())
}

/**
 * Is this exact token already in the query?
 *
 * The grammar lower-cases what it stores but the BOX is the reader's, so the
 * comparison has to fold case without rewriting anything. Three surfaces asked
 * this question and two of them wrote their own answer inline — which is how the
 * bar came to disagree with the palette about whether a filter was on, and print
 * `aria-pressed="true"` beside a chip row that said otherwise.
 */
export function isTokenIn(text: string, token: string): boolean {
  const wanted = token.toLowerCase()
  return text.split(/\s+/).some(part => part !== '' && part.toLowerCase() === wanted)
}

/**
 * Add or remove one token, leaving every other character alone — and, when the
 * caller names its SIBLINGS, replacing them instead of piling up beside them.
 *
 * `siblings` is what makes a rail row mean 「只看这一个」 rather than 「再加上这
 * 一个」. The rail's rows come in groups whose members are alternatives: a row has
 * exactly one priority and one status, and the date predicates are verdicts about
 * one row's dates. Two tokens from one group in the box is therefore never a
 * narrower question — it is either a WIDER one (priority and status are matched
 * with `includes`, so `p1 p2` is urgent UNION high) or an IMPOSSIBLE one (`has:`
 * flags are ANDed over a single posture, so `has:overdue has:undated` is
 * constant-false and the list is empty for any document).
 *
 * Turning a token ON therefore drops its siblings; turning one OFF drops only
 * itself, because a sibling the reader TYPED by hand is theirs and pressing a rail
 * row must not quietly delete a filter they wrote.
 *
 * @param text - the search box's contents, exactly as typed.
 * @param token - the facet token, e.g. `status:open`.
 * @param on - whether it should end up present.
 * @param siblings - the other tokens in its group, which it replaces when it goes on.
 * @returns the new text. An absent token and an explicit removal both leave the
 *   reader's other words as they were typed, capitalisation included.
 */
export function withFacetToken(text: string, token: string, on: boolean, siblings: readonly string[] = []): string {
  const wanted = token.toLowerCase()
  const replaced = new Set(on ? siblings.map(one => one.toLowerCase()) : [])
  const kept = text.split(/\s+/).filter(part =>
    part !== '' && part.toLowerCase() !== wanted && !replaced.has(part.toLowerCase()))
  if (!on) return kept.join(' ')
  return [...kept, token].join(' ')
}

/**
 * The reader's own words, replaced — with every qualifier left standing.
 *
 * THIS IS THE MISSING HALF OF `withFacetToken`, and the two are not
 * interchangeable. A text field bound to `withFacetToken(base, value, true)`
 * treats the WHOLE field as one token: type a, then b, then c and the box reads
 * `a ab a abc`, because each keystroke appends the field to the field. The base
 * has to be the QUALIFIERS only, and the incoming value is the reader's words —
 * which is exactly this function.
 *
 * Position is preserved rather than normalised: the words go back where the first
 * free word stood, so `#画廊 重做地板 status:open` keeps the reader's order
 * instead of being rebuilt as `#画廊 status:open 重做地板`. A search box that
 * reorders itself under the typist is a box they cannot point at.
 *
 * @param text - the whole query, exactly as it stands.
 * @param value - the field's new contents, which are all words.
 * @returns the new text.
 */
export function withFreeText(text: string, value: string): string {
  const parts = text.split(/\s+/).filter(part => part !== '')
  const words = value.split(/\s+/).filter(part => part !== '')
  const firstWord = parts.findIndex(part => !isQualifierToken(part))
  if (firstWord === -1) return [...parts, ...words].join(' ')
  const before = parts.slice(0, firstWord).filter(part => isQualifierToken(part))
  const after = parts.slice(firstWord).filter(part => isQualifierToken(part))
  return [...before, ...words, ...after].join(' ')
}

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
export function tagFacetValuesOf(tagLists: readonly (readonly string[])[]): TagFacetValue[] {
  const byLower = new Map<string, string>()
  for (const tags of tagLists) {
    for (const tag of tags) {
      const key = tag.trim()
      if (key === '') continue
      const lower = key.toLowerCase()
      if (!byLower.has(lower)) byLower.set(lower, key)
    }
  }
  return [...byLower.entries()]
    .sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([lower, spelled]) => ({ token: `#${spelled}`, key: lower, text: spelled }))
}
