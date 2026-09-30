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
 *  4. **A COUNT AND ITS JUMP ARE ONE PREDICATE, BY CONSTRUCTION.** Every flag
 *     below is emitted together with the triage line and the filter it opens, so
 *     the number on a tile and the list under it cannot be made to disagree; see
 *     the note inside {@link itemMatches}, which is where that promise is kept.
 */
import type { ItemPriority, ItemRecord, ItemStatusView } from './item.ts'
import { ITEM_STATUSES, itemTitleOf } from './item.ts'
import { datePostureOf } from './item-dates.ts'
import { DEFAULT_STALE_DAYS, staleDaysOf } from './item-stale.ts'
import { derivedStatusOf, isInboxItem, isLiveItem } from './item-membership.ts'

/** Qualifier keys the grammar recognises, mapped onto STABLE field values. */
const PRIORITY_BY_TOKEN: Readonly<Record<string, ItemPriority>> = {
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
  /** The reader marked it blocked on something. */
  | 'blocked'
  /** Hangs off a board card. */
  | 'linked'
  | 'done'

/** The qualifier keys the grammar accepts, as the STABLE values behind them. */
export const ITEM_FLAGS: readonly ItemFlag[] = ['hardOverdue', 'behind', 'overdue', 'stale', 'undated', 'gated', 'blocked', 'linked', 'done']

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
  if (lower.startsWith('status:')) {
    const value = lower.slice('status:'.length)
    return value === 'inprogress' || (ITEM_STATUSES as readonly string[]).includes(value)
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
  /** The exact source text, so a surface can echo what was typed. */
  readonly text: string
}

/** The query that matches everything, and the shape every parse returns. */
export const EMPTY_ITEM_QUERY: ItemQuery = { words: [], tags: [], priority: [], status: [], flags: new Set(), text: '' }

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
  for (const raw of text.split(/\s+/)) {
    const token = raw.trim()
    if (token === '') continue
    if (token.startsWith('#') && token.length > 1) {
      tags.push(token.slice(1).toLowerCase())
      continue
    }
    if (token.startsWith('status:')) {
      const value = token.slice('status:'.length).toLowerCase()
      if ((ITEM_STATUSES as readonly string[]).includes(value)) status.push(value as ItemStatusView)
      else if (value === 'inprogress') status.push('inProgress')
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
  return { words, tags, priority, status, flags: new Set(flags), text }
}

/** What a row needs to know about the world for a filter to judge it. */
export interface ItemMatchContext {
  readonly now: number
  /** Untouched days past which a row counts as neglected. */
  readonly staleDays: number
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
  readonly running?: ReadonlyMap<string, boolean>
}

/** The default reading context: right now, the default threshold, no board. */
export function itemMatchContextOf(
  now: number,
  staleDays: number = DEFAULT_STALE_DAYS,
  running?: ReadonlyMap<string, boolean>,
): ItemMatchContext {
  return { now, staleDays, ...running === undefined ? {} : { running } }
}

/** The text a free word is matched against. Lower-cased once, here. */
function haystackOf(item: ItemRecord): string {
  return [itemTitleOf(item), item.body, item.notes, ...item.tags].join('\n').toLowerCase()
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
  if (query.status.length > 0 && !query.status.includes(derivedStatusOf(item, ctx.running))) return false
  if (query.flags.size === 0) return true
  const posture = datePostureOf(item, ctx.now)
  const stale = staleDaysOf(item, ctx.now)
  for (const flag of query.flags) {
    // A FLAG IS A JUMP, AND A JUMP MUST LAND EXACTLY WHERE ITS NUMBER SAYS.
    // `behind` and `undated` are produced by the triage lines, and both of those
    // count only UNFINISHED work (and `undated` only rows that are not bare
    // captures). The flag tests below had NO such test, so pressing 「去看」 on
    // 「落后 3」 listed every FINISHED row that once sat behind a date, and
    // pressing it on 「没日期」 listed every new capture plus every finished
    // undated row: a jump that lands on more than the number promised, with
    // nothing on screen saying the number had changed its meaning.
    //
    // This is the same defect the `overdue` comment below already describes for
    // the overview tile, and the fix is the same: **the count and the jump are
    // one predicate, by construction.** The scope lives in the flag test so it
    // cannot drift away from the line that produced the number.
    const live = isLiveItem(item)
    /* `overdue` IS 「either kind of late」, which is the one reading two flags
       share, and it is scoped to UNFINISHED work for the same reason `behind` is
       — the overview counts late rows out of the live ones, so a filter that
       also kept finished rows would land on more than the number promised, with
       nothing on screen saying the number had changed its meaning. `hardOverdue`
       carried the same missing guard for the same reason: it is the other half
       of this same union, and the facet a reader clicks for 「逾期」, so both
       halves now judge with the scope the count used.

       The scope lives in the flag tests rather than in the count, so it cannot
       drift away from the line that produced the number. */
    const holds = flag === 'hardOverdue' ? live && posture.kind === 'hardOverdue'
      : flag === 'behind' ? live && posture.kind === 'behind'
        : flag === 'overdue' ? live && (posture.kind === 'hardOverdue' || posture.kind === 'behind')
          : flag === 'stale' ? stale !== undefined && stale >= ctx.staleDays
            : flag === 'undated' ? live && !isInboxItem(item) && posture.kind === 'none'
              : flag === 'gated' ? posture.kind === 'gated'
                : flag === 'blocked' ? item.status === 'blocked'
                  : flag === 'linked' ? item.taskId !== undefined
                    : item.status === 'done'
    if (!holds) return false
  }
  return true
}
