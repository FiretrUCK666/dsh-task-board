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
import type { ItemPriority, ItemRecord, ItemStatusView } from './item.ts'
import { ITEM_STATUS_VIEWS, itemTitleOf } from './item.ts'
import type { TaskStatus } from './tasks.ts'
import { datePostureOf } from './item-dates.ts'
import type { DatePosture } from './item-dates.ts'
import { DEFAULT_STALE_DAYS, staleDaysOf } from './item-stale.ts'
import { derivedStatusOf, isInboxItem, isLiveItem } from './item-membership.ts'

/** Qualifier keys the grammar recognises, mapped onto STABLE field values.
 *
 *  **Exported so the model can be taught this table instead of a copy of it.**
 *  It used to be private, which is why `taskboard_query`'s filter help could only
 *  report the BOARD's keys: the item vocabulary had no reader outside this file,
 *  so anything that wanted to describe it had to retype it — and a retyped list is
 *  a list that goes stale silently.
 */
export const PRIORITY_BY_TOKEN: Readonly<Record<string, ItemPriority>> = {
  p1: 'urgent', p2: 'high', p3: 'normal', p4: 'low',
}

/**
 * A row-level test the query can name.
 *
 * Each one is a fact about the row that a reader can also see on it. A test
 * that is not visible on the row belongs in a page, not in a filter.
 */
export type ItemFlag =
  /** A hard deadline has passed. */
  | 'hardOverdue'
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
  /** Hangs off a board card. */
  | 'linked'
  | 'done'

/** The qualifier keys the grammar accepts, as the STABLE values behind them. */
export const ITEM_FLAGS: readonly ItemFlag[] = ['hardOverdue', 'behind', 'overdue', 'stale', 'undated', 'gated', 'linked', 'done']

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
export function itemQualifierVocabulary(): readonly string[] {
  return [
    ...ITEM_STATUS_VIEWS.map(view => `status:${view.toLowerCase()}`),
    ...Object.keys(PRIORITY_BY_TOKEN).sort().map(token => token),
    '!1', '!2', '!3', '!4',
    ...ITEM_FLAGS.map(flag => `has:${flag}`),
    'on:YYYY-MM-DD',
    '#标签',
  ]
}

/**
 * Lowercased token to flag, so the grammar is case-insensitive WITHOUT
 * lowercasing the value it stores. The stored value is the enum's own spelling
 * because a stored flag is compared against a verdict elsewhere, and a
 * lowercased copy of a camelCase constant is a value that compares false to
 * everything.
 */
const ITEM_FLAG_BY_TOKEN: ReadonlyMap<string, ItemFlag> = new Map(ITEM_FLAGS.map(flag => [flag.toLowerCase(), flag]))

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
export function isItemQualifierToken(token: string): boolean {
  const lower = token.toLowerCase()
  if (DAY_TOKEN.test(lower)) return true
  if (lower.startsWith('status:')) {
    const value = lower.slice('status:'.length)
    return (ITEM_STATUS_VIEWS as readonly string[]).includes(value)
  }
  if (PRIORITY_BY_TOKEN[lower] !== undefined) return true
  if (/^![1-4]$/.test(lower)) return true
  if (lower.startsWith('has:')) return ITEM_FLAG_BY_TOKEN.get(lower.slice(4)) !== undefined
  // A tag is a qualifier too, and it is the READER's own word, so it is
  // recognised by its sigil rather than by a table. `#` alone is not a tag.
  return lower.startsWith('#') && lower.length > 1
}

/** A parsed query: free words plus recognised qualifiers. */
export interface ItemQuery {
  readonly words: readonly string[]
  readonly tags: readonly string[]
  readonly priority: readonly ItemPriority[]
  readonly status: readonly ItemStatusView[]
  readonly flags: ReadonlySet<ItemFlag>
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
  readonly day: string | null
  /** The exact source text, so a surface can echo what was typed. */
  readonly text: string
}

/** The query that matches everything, and the shape every parse returns. */
export const EMPTY_ITEM_QUERY: ItemQuery = { words: [], tags: [], priority: [], status: [], flags: new Set(), day: null, text: '' }

/**
 * The one spelling of a day token, so the writer and the reader cannot disagree.
 * @param day - `YYYY-MM-DD`, as the calendar's own cells carry it.
 * @returns the token the grammar reads.
 */
export function dayTokenOf(day: string): string {
  return `on:${day}`
}

/** `YYYY-MM-DD`, and nothing looser: a partial date is not a day. */
const DAY_TOKEN = /^on:(\d{4}-\d{2}-\d{2})$/

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
export function parseItemQuery(text: string): ItemQuery {
  const words: string[] = []
  const tags: string[] = []
  const priority: ItemPriority[] = []
  const status: ItemStatusView[] = []
  const flags = new Set<ItemFlag>()
  let day: string | null = null
  for (const raw of text.split(/\s+/)) {
    const token = raw.trim()
    if (token === '') continue
    if (token.startsWith('#') && token.length > 1) {
      tags.push(token.slice(1).toLowerCase())
      continue
    }
    /* ONE DAY. `on:2026-10-06`, and the LAST one wins rather than the first: the
       field is a single-slot filter, so a hand-edited box holding two of them has
       to resolve to something, and resolving to the most recently written one is
       the same answer a reader gets from every other single-slot control. */
    const asDay = DAY_TOKEN.exec(token.toLowerCase())
    if (asDay !== null) {
      day = asDay[1] ?? null
      continue
    }
    if (token.startsWith('status:')) {
      const value = token.slice('status:'.length).toLowerCase()
      if ((ITEM_STATUS_VIEWS as readonly string[]).includes(value)) status.push(value as ItemStatusView)
      else words.push(token.toLowerCase())
      continue
    }
    if (token.startsWith('p') && token.length === 2 && PRIORITY_BY_TOKEN[token.toLowerCase()] !== undefined) {
      priority.push(PRIORITY_BY_TOKEN[token.toLowerCase()] as ItemPriority)
      continue
    }
    /* `!N` IS THE AFFIRMATIVE PRIORITY SIGIL, and it is the SAME one the capture
       box teaches: `!1`..`!4` mean 紧急/高/普通/低 in both fields, which is the
       point of having one sigil. So this branch is not a half-finished negation —
       there is no `!pN` token in the grammar at all, and an audit that read the
       discarded `!` as a negation would have deleted a documented behaviour.

       `p1`..`p4` also exist, so the two spellings coexist; that is deliberate,
       because the model reads `p1` while a person typing in the same field as
       `!1` should not have to learn a second alphabet. */
    if (token.startsWith('!') && token.length === 2) {
      const value = PRIORITY_BY_TOKEN[`p${token.slice(1)}`]
      if (value !== undefined) priority.push(value)
      else words.push(token.toLowerCase())
      continue
    }
    if (token.startsWith('has:')) {
      /* THE FLAG IS LOOKED UP THROUGH A LOWERCASE INDEX, and it has to be: the
         token arrives lower-cased while the flags are camelCase, so
         `has:hardOverdue` becomes `hardoverdue` and a comparison against
         `ItemFlag` never matches. It then falls through to being a literal
         search for the word "hardoverdue" — a documented filter that silently
         matches nothing, which is the one failure a filter box cannot recover
         from and the reader cannot diagnose. The stored value stays camelCase,
         because it is compared against a verdict elsewhere. */
      const flag = ITEM_FLAG_BY_TOKEN.get(token.slice('has:'.length).toLowerCase())
      if (flag !== undefined) {
        flags.add(flag)
        continue
      }
      words.push(token.toLowerCase())
      continue
    }
    words.push(token.toLowerCase())
  }
  return { words, tags, priority, status, flags: new Set(flags), day, text }
}

/** What a row needs to know about the world for a filter to judge it. */
export interface ItemMatchContext {
  readonly now: number
  /** Untouched days past which a row counts as neglected. */
  readonly staleDays: number
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
  readonly cards?: ReadonlyMap<string, TaskStatus>
}

/** The default reading context: right now, the default threshold, no board. */
export function itemMatchContextOf(
  now: number,
  staleDays: number = DEFAULT_STALE_DAYS,
  cards?: ReadonlyMap<string, TaskStatus>,
): ItemMatchContext {
  return { now, staleDays, ...cards === undefined ? {} : { cards } }
}

/** The text a free word is matched against. Lower-cased once, here. */
function haystackOf(item: ItemRecord): string {
  return [itemTitleOf(item), item.body, item.notes, ...item.tags].join('\n').toLowerCase()
}

/** What a flag test is given. ONE probe per row, so two flags cannot disagree
 *  about the same row's date posture — a disagreement that is invisible until a
 *  rail prints a number the jump does not honour. */
export interface ItemFlagProbe {
  readonly item: ItemRecord
  readonly posture: DatePosture
  readonly stale: number | undefined
  readonly ctx: ItemMatchContext
}

/** Build the probe a flag test reads. One posture, one staleness, one clock. */
export function flagProbeOf(item: ItemRecord, ctx: ItemMatchContext): ItemFlagProbe {
  return { item, posture: datePostureOf(item, ctx.now), stale: staleDaysOf(item, ctx.now), ctx }
}

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
export const ITEM_FLAG_TESTS: Readonly<Record<ItemFlag, (probe: ItemFlagProbe) => boolean>> = {
  hardOverdue: probe => isLiveItem(probe.item) && probe.posture.kind === 'hardOverdue',
  behind: probe => isLiveItem(probe.item) && probe.posture.kind === 'behind',
  overdue: probe => isLiveItem(probe.item)
    && (probe.posture.kind === 'hardOverdue' || probe.posture.kind === 'behind'),
  stale: probe => probe.stale !== undefined && probe.stale >= probe.ctx.staleDays,
  undated: probe => isLiveItem(probe.item) && !isInboxItem(probe.item) && probe.posture.kind === 'none',
  gated: probe => probe.posture.kind === 'gated',
  linked: probe => probe.item.taskId !== undefined,
  done: probe => probe.item.status === 'done',
}

/**
 * Does this row pass this flag? The surface form of {@link ITEM_FLAG_TESTS},
 * for anything that has the row and the context but not a probe yet.
 *
 * **This is also how a number is COUNTED.** A rail, a tile or a count line that
 * wants 「how many rows does this flag hold」 calls this on the same row — so the
 * number on screen and the list behind it are one predicate by construction,
 * which is the promise rule 4 of this module makes.
 */
export function itemHasFlag(item: ItemRecord, flag: ItemFlag, ctx: ItemMatchContext): boolean {
  return ITEM_FLAG_TESTS[flag](flagProbeOf(item, ctx))
}

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
export function itemMatches(item: ItemRecord, query: ItemQuery, ctx: ItemMatchContext): boolean {
  for (const word of query.words) {
    if (!haystackOf(item).includes(word)) return false
  }
  if (query.tags.length > 0 && !query.tags.some(tag => item.tags.some(row => row.toLowerCase() === tag))) return false
  if (query.priority.length > 0 && !query.priority.includes(item.priority)) return false
  if (query.status.length > 0 && !query.status.includes(derivedStatusOf(item, ctx.cards))) return false
  /* THE DAY IS READ AGAINST EVERY DATE THE ROW HAS, and 「has」 is the right verb:
     a row whose day is the 6th because its hard deadline is the 6th belongs on the
     6th's page whether or not it also has a plan date. The three dates are three
     answers to 「when」, and a calendar asks the question once — picking one of the
     three fields to read would hide rows on a day the reader can see them on. */
  if (query.day !== null && !itemDatesOf(item).includes(query.day)) return false
  if (query.flags.size === 0) return true
  // One probe for the whole row, so two flags cannot read two different postures.
  const probe = flagProbeOf(item, ctx)
  for (const flag of query.flags) {
    if (!ITEM_FLAG_TESTS[flag](probe)) return false
  }
  return true
}

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
export function itemDatesOf(item: ItemRecord): readonly string[] {
  const days = [item.dueAt, item.hardDueAt, item.startsAfter]
    .filter((at): at is number => at !== undefined)
    .map(at => {
      const when = new Date(at)
      const month = String(when.getMonth() + 1).padStart(2, '0')
      const date = String(when.getDate()).padStart(2, '0')
      return `${when.getFullYear()}-${month}-${date}`
    })
  return [...new Set(days)]
}
