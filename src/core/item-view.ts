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
import type { ItemDateConflict, ItemPriority, ItemRecord, ItemStatusView } from './item.ts'
import {
  ITEM_STATUSES,
  itemDateConflict,
  itemPriorityRankOf,
  itemProgressOf,
  itemStatusOf,
  itemTitleOf,
} from './item.ts'
// The 顺序 ordering IS the document's own order, read as a comparator rather
// than restated: the reader's 顺序 and the order the document stores are one
// promise, and a second copy of five keys would be free to disagree with the
// first about which of two rows comes first.
import { compareItemOrder } from './items-doc.ts'

/**
 * The status a row DISPLACES as, re-exported so a surface reading this module
 * does not have to know that the vocabulary lives one file over. The name is
 * the model's, and this is the same name — not a second type that happens to
 * be spelled the same way.
 */
export type { ItemPriority, ItemStatus, ItemStatusView } from './item.ts'

/** A whole day, in milliseconds — the unit every date verdict counts in. */
const DAY_MS = 86_400_000

/** How far ahead a hard deadline counts as "soon". Amber, not red. */
export const HARD_SOON_DAYS = 7

/** Days without a change before an open row counts as neglected. */
export const DEFAULT_STALE_DAYS = 14

/**
 * Past this, a row stops being "neglected" and becomes simply old. A staleness
 * signal with no ceiling turns into a guilt generator: the user is scolded
 * about rows they deliberately parked, learns the signal is noise, and turns it
 * off for good. The two exemptions in {@link staleDaysOf} are the other half of
 * the same promise — see its doc comment.
 */
export const STALE_CEILING_DAYS = 90

// ── the three dates ────────────────────────────────────────────────────────

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
  | { readonly kind: 'contradiction'; readonly conflict: ItemDateConflict }
  /** No date on the row at all: the reader never made a promise. */
  | { readonly kind: 'none' }
  /** `startsAfter` is still in the future — by definition it cannot be touched. */
  | { readonly kind: 'gated'; readonly startsAfter: number }
  /** The hard deadline has passed. The only verdict that may read as an alarm. */
  | { readonly kind: 'hardOverdue'; readonly at: number; readonly days: number }
  /** The hard deadline is inside {@link HARD_SOON_DAYS}. Worth noticing, not yet late. */
  | { readonly kind: 'hardSoon'; readonly at: number; readonly days: number }
  /** The hard deadline is set and comfortably ahead. */
  | { readonly kind: 'hardAhead'; readonly at: number; readonly days: number }
  /** The wanted-by date is today. */
  | { readonly kind: 'dueToday'; readonly at: number }
  /** The wanted-by date passed: behind plan, which is not the same as overdue. */
  | { readonly kind: 'behind'; readonly at: number; readonly days: number }
  /** The wanted-by date is ahead. */
  | { readonly kind: 'upcoming'; readonly at: number; readonly days: number }

/** The soft `dueAt` read separately, so a row with both dates says both. */
export interface SoftPosture {
  readonly at: number | undefined
  readonly days: number | undefined
  readonly overdue: boolean
  readonly today: boolean
}

/** Whole days between two instants, truncated toward zero, never negative. */
function daysBetween(at: number, now: number): number {
  return Math.floor(Math.abs(at - now) / DAY_MS)
}

/** True when two instants fall on the same calendar day in the local zone. */
function sameLocalDay(a: number, b: number): boolean {
  const first = new Date(a)
  const second = new Date(b)
  return first.getFullYear() === second.getFullYear()
    && first.getMonth() === second.getMonth()
    && first.getDate() === second.getDate()
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
export function softPostureOf(item: ItemRecord, now: number): SoftPosture {
  const at = item.dueAt
  if (at === undefined) return { at: undefined, days: undefined, overdue: false, today: false }
  const today = sameLocalDay(at, now)
  return { at, days: today ? 0 : daysBetween(at, now), overdue: at < now && !today, today }
}

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
export function datePostureOf(item: ItemRecord, now: number): DatePosture {
  // The document keeps a row whose three dates contradict each other exactly as
  // written, so somebody has to say so. This is that place.
  const conflict = itemDateConflict(item)
  if (conflict !== undefined) return { kind: 'contradiction', conflict }
  // A gate outranks everything that remains: a row that may not be started
  // cannot be late.
  if (item.startsAfter !== undefined && item.startsAfter > now) {
    return { kind: 'gated', startsAfter: item.startsAfter }
  }
  if (item.hardDueAt !== undefined) {
    const at = item.hardDueAt
    if (at < now) return { kind: 'hardOverdue', at, days: daysBetween(at, now) }
    if (at - now <= HARD_SOON_DAYS * DAY_MS) return { kind: 'hardSoon', at, days: daysBetween(at, now) }
    return { kind: 'hardAhead', at, days: daysBetween(at, now) }
  }
  if (item.dueAt === undefined) return { kind: 'none' }
  const at = item.dueAt
  if (sameLocalDay(at, now)) return { kind: 'dueToday', at }
  if (at < now) return { kind: 'behind', at, days: daysBetween(at, now) }
  return { kind: 'upcoming', at, days: daysBetween(at, now) }
}

// ── staleness, with the exemptions that make it usable ─────────────────────

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
export function staleDaysOf(item: ItemRecord, now: number): number | undefined {
  if (item.status === 'done') return undefined
  if (item.status === 'blocked') return undefined
  if (item.startsAfter !== undefined && item.startsAfter > now) return undefined
  const days = daysBetween(item.updatedAt, now)
  if (days > STALE_CEILING_DAYS) return undefined
  return days
}

/**
 * The rows a reader has stopped moving, oldest first.
 * @param items - every row in the document.
 * @param now - the reading clock.
 * @param thresholdDays - how many untouched days count; below the default is the reader's choice.
 * @returns the neglected rows, most neglected first.
 */
export function staleItemsOf(items: readonly ItemRecord[], now: number, thresholdDays: number = DEFAULT_STALE_DAYS): ItemRecord[] {
  const out: ItemRecord[] = []
  for (const item of items) {
    const days = staleDaysOf(item, now)
    if (days !== undefined && days >= thresholdDays) out.push(item)
  }
  return out.sort((a, b) => (staleDaysOf(a, now) ?? 0) - (staleDaysOf(b, now) ?? 0))
}

// ── pages ──────────────────────────────────────────────────────────────────

/**
 * The panel's three pages, in reading order.
 *
 * A page is a QUESTION ("what have I not dealt with yet", "what is on me
 * today", "what have I set down"), not a layout. Layouts are a property of a
 * page, and a surface that grows one page per layout ends up with a navigation
 * strip nobody reads — so the set is closed here, in data, and nothing in the
 * interface may add a fourth.
 */
export const ITEM_PAGES = ['inbox', 'list', 'schedule'] as const
export type ItemPageId = typeof ITEM_PAGES[number]

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
export function isInboxItem(item: ItemRecord): boolean {
  if (item.status === 'done') return false
  if (item.priority !== 'normal') return false
  if (item.tags.length > 0) return false
  if (item.taskId !== undefined) return false
  return item.startsAfter === undefined && item.dueAt === undefined && item.hardDueAt === undefined
}

// ── query grammar ──────────────────────────────────────────────────────────

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
      // The flag table is matched through a LOWERCASE INDEX, not by comparing
      // the lowercased token against the camelCase constants. Doing the latter
      // looks right and is dead: `has:hardOverdue` lowercases to
      // `hardoverdue`, never matches, and falls through to being a literal
      // search for the word "hardoverdue" — a documented filter that silently
      // matches nothing, which is the one failure a filter box cannot recover
      // from and the reader cannot diagnose.
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

/**
 * The row's DERIVED status, from the board's live state — the ONE place a row is
 * asked whether it is 进行中.
 *
 * Every surface that shows or filters a status goes through here: the row
 * projection, the group counts, the group fill and the query. Four call sites
 * spelling out `taskId !== undefined && running.get(taskId) === true` is four
 * places for the derived status to be quietly wrong in one of them — and the
 * wrong one is always the facet, because a facet that disagrees with the row it
 * counts is a facet that sends the reader to an empty group.
 *
 * @param item - the row.
 * @param running - the board's live state keyed by card id, or `undefined` when
 *   the caller has no board. A row whose card is not in the map is not running;
 *   a card this host cannot see is `false` here, which is why the live verdict
 *   itself is `unknown` upstream and never arrives as a guess.
 * @returns the stored status, or the derived 进行中.
 */
function derivedStatusOf(item: ItemRecord, running: ReadonlyMap<string, boolean> | undefined): ItemStatusView {
  return itemStatusOf(item, item.taskId !== undefined && running?.get(item.taskId) === true)
}

/**
 * The row's DERIVED status against a reading context — the one door between the
 * two, so the search box, the pages and the model's query cannot disagree about
 * which rows are 进行中.
 * @param item - the row.
 * @param ctx - the clock and the board's live state.
 * @returns the stored status, or the derived 进行中.
 */
function statusInContext(item: ItemRecord, ctx: ItemMatchContext): ItemStatusView {
  return derivedStatusOf(item, ctx.running)
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
  if (query.status.length > 0 && !query.status.includes(statusInContext(item, ctx))) return false
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
    const holds = flag === 'hardOverdue' ? posture.kind === 'hardOverdue'
      : flag === 'behind' ? live && posture.kind === 'behind'
        /* `overdue` IS 「either kind of late」, which is the one reading two flags
           share. The overview tile counts `hardOverdue || behind` and used to
           filter `has:hardOverdue` alone, so a reader pressed a tile reading
           「逾期 3」 and got one row, with nothing on screen saying the number had
           changed its meaning. The count and the filter are now the same
           predicate by construction, which is the only arrangement in which a
           number on a tile and the list under it can be made to agree. */
          : flag === 'overdue' ? posture.kind === 'hardOverdue' || posture.kind === 'behind'
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
export function itemMatchesText(
  item: ItemRecord,
  text: string,
  now: number,
  staleDays: number = DEFAULT_STALE_DAYS,
  running?: ReadonlyMap<string, boolean>,
): boolean {
  return itemMatches(item, parseItemQuery(text), itemMatchContextOf(now, staleDays, running))
}

// ── rows ───────────────────────────────────────────────────────────────────

/** The short number a row is called by, or the unnumbered placeholder. */
export interface ItemRef {
  /** `#12`, or `undefined` while the document has not numbered it yet. */
  readonly text: string | undefined
  /** The number, or `undefined` when the host has not settled one. */
  readonly number: number | undefined
  /** Whether a number exists yet. A row the host has not numbered shows a dash. */
  readonly numbered: boolean
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
export function itemRefOf(item: ItemRecord): ItemRef {
  const numbered = Number.isInteger(item.ref) && item.ref > 0
  return { text: numbered ? `#${item.ref}` : undefined, number: numbered ? item.ref : undefined, numbered }
}

/** What one row says, decided once. */
export interface ItemRowView {
  readonly item: ItemRecord
  readonly ref: ItemRef
  /** Never blank: an untitled row borrows its body's first line. */
  readonly title: string
  /** The derived status, in-progress included (a linked running card). */
  readonly status: ItemStatusView
  /** The one date verdict. `undefined` when the row has no steps. */
  readonly progress: { readonly done: number; readonly total: number; readonly ratio: number } | undefined
  readonly posture: DatePosture
  readonly soft: SoftPosture
  /** Untouched days, or `undefined` when the row is exempt or too old. */
  readonly staleDays: number | undefined
  /** Whether the row should be given a priority chip at all. */
  readonly priorityLoud: boolean
}

/** The reading context one row is projected against. */
export interface ItemRowContext {
  readonly now: number
  /** Whether the linked board card is running, keyed by card id. */
  readonly running: ReadonlyMap<string, boolean>
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
export function itemRowViewOf(item: ItemRecord, ctx: ItemRowContext): ItemRowView {
  const soft = softPostureOf(item, ctx.now)
  return {
    item,
    ref: itemRefOf(item),
    title: itemTitleOf(item),
    status: derivedStatusOf(item, ctx.running),
    progress: itemProgressOf(item),
    posture: datePostureOf(item, ctx.now),
    soft,
    staleDays: staleDaysOf(item, ctx.now),
    // The default tier stays quiet: a chip on every row is a chip nobody reads,
    // and the reader who cares about priority is the one who filters on it.
    priorityLoud: item.priority !== 'normal',
  }
}

// ── grouping, sorting, slicing ─────────────────────────────────────────────

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
export type ItemSort = 'sequence' | 'starts' | 'due' | 'hard' | 'priority' | 'birth' | 'title'

/** The orderings, in the order the surface offers them — the first is the default. */
export const ITEM_SORTS: readonly ItemSort[] = ['sequence', 'starts', 'due', 'hard', 'priority', 'birth', 'title']

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
export const DEFAULT_ITEM_SORT: ItemSort = 'sequence'

/**
 * The instant a row is sorted by under the `due` order: the nearest date it owns.
 *
 * The "no date" sentinel is a LARGE FINITE number, never `Infinity`. Two rows
 * without dates both answer `Infinity`, and `Infinity - Infinity` is `NaN`; a
 * comparator that returns `NaN` makes `Array.prototype.sort` treat the pair as
 * equal and move on, so the two rows are never ordered against each other at
 * all — which quietly makes this NOT a total order, and a list that is not a
 * total order renders differently on two devices holding one document. The
 * defect is invisible on any screen showing a single device and impossible to
 * spot in a screenshot.
 */
function dueSortKeyOf(item: ItemRecord): number {
  return item.hardDueAt ?? item.dueAt ?? UNSET_DATE
}

/**
 * The same sentinel for every date column that has one. Named once because the
 * law is one: a row without this field is not "at the beginning" and not
 * "unbounded", it is at the END, and only a FINITE end can be subtracted.
 */
const UNSET_DATE = Number.MAX_SAFE_INTEGER

/**
 * 最早开始 — the gate, soonest first, and a row with no gate at the END.
 *
 * Stated in full because the two bugs this file has had were both "the sentinel
 * was right in the key and the comment said nothing about where the row lands":
 * a row with no date is not at the beginning of a column, it is past all of them,
 * and only the finite sentinel puts it there. Same law as {@link dueSortKeyOf},
 * so it is spelled the same way.
 */
function startsSortKeyOf(item: ItemRecord): number {
  return item.startsAfter ?? UNSET_DATE
}

/**
 * 硬期限 — the one date that does not move, soonest first, and a row with none
 * at the END. The same finite sentinel as the other two date columns, for the
 * same reason: `Infinity` here would make two undated rows compare `NaN`, and a
 * `NaN` comparator stops comparing that pair altogether.
 */
function hardSortKeyOf(item: ItemRecord): number {
  return item.hardDueAt ?? UNSET_DATE
}

/**
 * The four tiers as ONE number, read from the model — never re-ranked here.
 *
 * This used to be `ITEM_PRIORITIES.indexOf(item.priority)`, and that was wrong in
 * the most user-visible way a sort can be: the enum is declared lowest-first
 * because that is how the tiers are named in a dropdown, so the index put 紧急
 * LAST while 顺序 — which reads the model's rank — put it FIRST. Switching the
 * sort on one page therefore moved the reader's most urgent row from the top to
 * the bottom, and the comment above this function claimed the two scales were
 * one. They were two rulers pointing opposite ways.
 *
 * {@link itemPriorityRankOf} is the one ruler, and it lives in the model because
 * that is what owns what a priority IS; the document's order and this ordering
 * are its two readers. A second ranking written here would be free to drift again,
 * and a drift in a RANKING is invisible until a reader notices their list
 * reshuffling.
 */
function prioritySortKeyOf(item: ItemRecord): number {
  return itemPriorityRankOf(item.priority)
}

/**
 * Compare two titles WITHOUT the reader's locale.
 *
 * `localeCompare` is the obvious tool and the wrong one here: its answer depends
 * on the device's language, so two devices sorting the same rows could put
 * 「Zebra」 and 「Ärger」 in either order, and the checklist would differ between
 * a phone and a laptop for no reason a reader could see. Code-unit order is
 * boring and identical everywhere, and the case-folded first pass is what keeps
 * `apple` and `Apple` next to each other instead of splitting the alphabet in
 * two — a Latin-1 case fold, not a locale's, so it stays device-independent.
 */
function compareTitles(a: string, b: string): number {
  const left = a.toLowerCase()
  const right = b.toLowerCase()
  if (left < right) return -1
  if (left > right) return 1
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

/**
 * ONE ROW PER ORDERING, keyed by the union — so the table cannot fall behind the
 * set. This replaced an `if` chain, and the chain had a defect that only the
 * table removes: its last line was a shared exit that served 「title」 (which has
 * no numeric key) AND any ordering somebody added without a key, and the comment
 * above that line explained only `title`. So the missing branch would arrive
 * wearing a comment that said it was deliberate — a defect coming back in
 * borrowed clothes. Here there is no such exit: `title` is a row like any other,
 * and a new member of {@link ItemSort} that nobody wrote a key for is a BUILD
 * FAILURE (`Property 'brandNew' is missing in type …`) rather than a quiet
 * fallback.
 *
 * It is the same move, and for the same reason, as deriving the patch type from
 * the model's ruling table: a hand-kept list of "the things you may do here"
 * stops agreeing with the real one the first time somebody adds a member, and the
 * failure is invisible because nothing about the old list looks wrong.
 *
 * EVERY ROW RETURNS A FINITE NUMBER, which is the contract the defect
 * {@link dueSortKeyOf} documents: a comparator that ever returns `NaN` stops
 * comparing that pair, which makes the order partial, which makes two devices
 * holding one document show two lists. `0` is the row's way of saying "these two
 * rows tie on me" — never a shrug.
 */
const KEY_GAPS: Readonly<Record<ItemSort, (a: ItemRecord, b: ItemRecord) => number>> = {
  sequence: (a, b) => compareItemOrder(a, b),
  starts: (a, b) => startsSortKeyOf(a) - startsSortKeyOf(b),
  due: (a, b) => dueSortKeyOf(a) - dueSortKeyOf(b),
  hard: (a, b) => hardSortKeyOf(a) - hardSortKeyOf(b),
  priority: (a, b) => prioritySortKeyOf(a) - prioritySortKeyOf(b),
  // 出生时刻 is the one row with NO sentinel, and it is correct for a reason
  // worth writing down: every row has a birth instant, so there is no "unset" to
  // stand at the wrong end of the column, and the two values are plain finite
  // numbers whose difference is always a number. Subtracting a sentinel is only
  // ever a bug when there IS a sentinel.
  birth: (a, b) => a.createdAt - b.createdAt,
  // 标题 is the one row that is not arithmetic, and it is here rather than
  // special-cased by the caller so that this table is the whole answer to "what
  // does each ordering read". Code units, never the reader's locale.
  title: (a, b) => compareTitles(itemTitleOf(a), itemTitleOf(b)),
}

/**
 * Which cohort a row is in for the purpose of WHERE IT SITS: `0` for a row the
 * document has numbered, `1` for one it has not.
 *
 * THIS IS THE FIRST KEY OF ALL SEVEN, BEFORE ANY OTHER, and that position is the
 * whole law. The tempting fix is to let the sentinel do its work where the
 * document's own comparator ends — last, after the dates and the age — but then a
 * row the reader has just typed still jumps above their existing work whenever
 * its own key happens to favour it, which is exactly the reshuffle the default
 * ordering exists to prevent. A number the DOCUMENT has not handed out yet means
 * the row's place in the reader's own sequence is not decided yet, and an
 * undecided row waits at the end until it is.
 *
 * AND IT IS NOT A SORTING PREFERENCE, WHICH IS WHY 标题 IS NOT AN EXCEPTION TO IT.
 * An ordering changes 「按什么维度读」, not 「这份列表由谁组成」: the rows under the
 * title ordering are the same rows, and the batch the reader has just written is
 * in it either way. Make this one an exception and switching orderings would move
 * that batch from 「all at the end」 to 「sorted in among the others」, which reads
 * as "my notes were reorganized" — one inexplicable event instead of one
 * learnable rule. An exception has to be kept alive by a comment, comments expire,
 * and an expired exception is the next silent fork.
 *
 * THE PRICE, STATED RATHER THAN DISCOVERED. Under 标题 a note called 「AAA」 waits
 * below one called 「ZZZ」 for the length of one round trip, which looks wrong for
 * about a second and is then right for good. The window is short on a connected
 * host and is the whole offline case, and it is the offline case where a list that
 * reshuffles under every keystroke costs the reader the most. A list that moves
 * once when a note joins it is cheaper than a list that moves every time. And the
 * price is not peculiar to 标题 — it is the same price in every ordering, which is
 * the other reason to pay it once instead of seven times.
 *
 * It is also the same law `items-doc.ts` applies to its own last key, at a
 * narrower scope: there it settles a tie between two rows the document HAS
 * numbered, here it keeps an unnumbered row out of the way of every numbered one.
 * One principle, two scopes — not one rule written twice.
 */
function numberCohortOf(item: ItemRecord): number {
  return item.ref > 0 ? 0 : 1
}

/**
 * The short number a row is ordered by, with the unnumbered pushed to the end.
 *
 * The same law the previous 编号 ordering used, kept as a function because after
 * {@link numberCohortOf} has separated the two cohorts it is what orders the
 * numbered ones among themselves, and it is still the last word for two rows the
 * document has not numbered yet.
 */
function refSortKeyOf(item: ItemRecord): number {
  return item.ref > 0 ? item.ref : UNSET_DATE
}

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
export function sortItemsOf(rows: readonly ItemRecord[], sort: ItemSort): ItemRecord[] {
  // Hoisted out of the comparator, and the fallback is NOT what keeps the table
  // honest — the table's TYPE is, and that is what turns a forgotten key into a
  // build failure. This covers the one input the type cannot: a string that
  // arrived from outside it, which in this plugin means a device-local
  // preference written by an older build. 顺序 is the truthful answer to "an
  // ordering I do not know" (it is the default, and the document's own order),
  // where throwing would take the whole panel down over a row height.
  const gapOf = KEY_GAPS[sort] ?? KEY_GAPS.sequence
  const out = [...rows]
  out.sort((a, b) => {
    const cohort = numberCohortOf(a) - numberCohortOf(b)
    if (cohort !== 0) return cohort
    const gap = gapOf(a, b)
    if (gap !== 0) return gap
    if (refSortKeyOf(a) !== refSortKeyOf(b)) return refSortKeyOf(a) - refSortKeyOf(b)
    if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  return out
}

/** One grouped run of rows, already ordered. */
export interface ItemSlice {
  /** The STATUS the run holds; a row is in exactly one run per render. */
  readonly status: ItemStatusView
  readonly items: readonly ItemRecord[]
  /** Step arithmetic for the run, or `undefined` when it has no steps at all. */
  readonly progress: { readonly done: number; readonly total: number } | undefined
}

/** The four groups, in the order they read top to bottom. */
export const ITEM_STATUS_ORDER: readonly ItemStatusView[] = ['inProgress', 'open', 'blocked', 'done']

/** What one grouping pass needs to know. One bag, so the order stays stable. */
export interface ItemSliceOptions {
  readonly query: ItemQuery
  readonly ctx: ItemMatchContext & { readonly running: ReadonlyMap<string, boolean> }
  readonly sort: ItemSort
  /**
   * Whether finished rows come back as their own group.
   *
   * Off by default, and that is a decision rather than an omission: a finished
   * row is history, and a group that is only opened to be dismissed is a group
   * a reader learns to skip. The list page carries a switch instead, so the
   * finished rows are one gesture away and occupy nothing until asked for.
   */
  readonly includeDone?: boolean
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
export function itemSlicesOf(items: readonly ItemRecord[], options: ItemSliceOptions): ItemSlice[] {
  const { query, ctx, sort, includeDone = false } = options
  const groups = includeDone ? ITEM_STATUS_ORDER : ITEM_STATUS_ORDER.filter(status => status !== 'done')
  const buckets = new Map<ItemStatusView, ItemRecord[]>(groups.map(status => [status, []]))
  for (const item of items) {
    const status = derivedStatusOf(item, ctx.running)
    if (!buckets.has(status)) continue
    if (!itemMatches(item, query, ctx)) continue
    buckets.get(status)?.push(item)
  }
  return groups.map(status => {
    const rows = sortItemsOf(buckets.get(status) ?? [], sort)
    let done = 0
    let total = 0
    for (const row of rows) {
      for (const step of row.steps) {
        total += 1
        if (step.done) done += 1
      }
    }
    return { status, items: rows, progress: total === 0 ? undefined : { done, total } }
  })
}

/** Whether a row belongs on a working page at all. Finished work is history. */
export function isLiveItem(item: ItemRecord): boolean {
  return item.status !== 'done'
}

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
export function isAgendaItem(item: ItemRecord): boolean {
  return isLiveItem(item) && !isInboxItem(item)
}

// ── the schedule page ──────────────────────────────────────────────────────

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
export const SCHEDULE_BUCKETS = ['hardOverdue', 'behind', 'today', 'tomorrow', 'week', 'later', 'undated', 'gated'] as const
export type ScheduleBucketId = typeof SCHEDULE_BUCKETS[number]

/** One bucket of the agenda. */
export interface ScheduleBucket {
  readonly id: ScheduleBucketId
  readonly items: readonly ItemRecord[]
  /**
   * The day this bucket is about, when it is about one: a date the reader can
   * point at, not a label to re-derive. `undefined` for the buckets that are
   * not about a day.
   */
  readonly day: number | undefined
}

/** Start of the local calendar day containing `at`. Dates in this model are
 *  typed as days, so every bucket boundary is a local midnight — comparing them
 *  as UTC instants puts a reader in a negative-offset zone a day early, which is
 *  the exact bug a bare `toISOString()` slice introduces. */
function startOfDay(at: number): number {
  const date = new Date(at)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/**
 * The day a row is ACTUALLY about: the hard deadline when there is one.
 *
 * A row carrying both dates is scheduled against the hard one, because that is
 * the date the reader cannot move on their own. Bucketing it by the soft date
 * instead would park work in a later bucket than the day it has to be done by,
 * which is the one error an agenda cannot make.
 */
function scheduledDayOf(item: ItemRecord): number | undefined {
  const at = item.hardDueAt ?? item.dueAt
  return at === undefined ? undefined : startOfDay(at)
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
export function scheduleBucketOf(item: ItemRecord, now: number): ScheduleBucketId {
  // A contradictory row is NOT filtered out of the agenda. Dropping it would
  // hide the one row whose dates need fixing; it falls through to the day its
  // hardest date names, and its own meta line says the three disagree. A row
  // that is wrong is still the reader's row, and a schedule that silently
  // swallowed it is exactly the kind of quiet the project refuses everywhere.
  const posture = datePostureOf(item, now)
  if (posture.kind === 'gated') return 'gated'
  if (posture.kind === 'hardOverdue') return 'hardOverdue'
  if (posture.kind === 'behind') return 'behind'
  const day = scheduledDayOf(item)
  if (day === undefined) return 'undated'
  // Rounded, not floored: a day boundary is 23 or 25 hours long across a
  // daylight-saving change, so truncating puts one bucket's rows a day early
  // twice a year and a test on that day fails for a reason nobody can see.
  const offset = Math.round((day - startOfDay(now)) / DAY_MS)
  if (offset <= 0) return 'today'
  if (offset === 1) return 'tomorrow'
  if (offset <= 7) return 'week'
  return 'later'
}

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
export function scheduleBucketsOf(
  items: readonly ItemRecord[],
  query: ItemQuery,
  ctx: ItemMatchContext & { readonly running: ReadonlyMap<string, boolean> },
  sort: ItemSort,
): ScheduleBucket[] {
  const filled = new Map<ScheduleBucketId, ItemRecord[]>(SCHEDULE_BUCKETS.map(id => [id, []]))
  for (const item of items) {
    // Membership is {@link isAgendaItem} and nothing else: finished work is
    // history, and an unfiled capture is the inbox's, not a date-shaped hole in
    // the agenda. The buckets below are then a pure function of the row.
    if (!isAgendaItem(item)) continue
    if (!itemMatches(item, query, ctx)) continue
    filled.get(scheduleBucketOf(item, ctx.now))?.push(item)
  }
  const today = startOfDay(ctx.now)
  return SCHEDULE_BUCKETS.map(id => {
    const rows = sortItemsOf(filled.get(id) ?? [], sort)
    // The day a bucket stands for is derived from its id rather than from the
    // rows in it, so an EMPTY bucket still knows which day it is — an empty
    // "tomorrow" is a fact about the calendar, and a bucket that only learned
    // its day from its contents would have no label at all on a quiet week.
    const day = id === 'today' ? today
      : id === 'tomorrow' ? today + DAY_MS
        : id === 'week' ? today + 7 * DAY_MS
          : undefined
    return { id, items: rows, day }
  })
}

// ── the triage strip ───────────────────────────────────────────────────────

/** How loudly a triage line is allowed to speak. */
export type TriageSeverity = 'warn' | 'muted'

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
  readonly id: ItemFlag
  readonly count: number
  readonly severity: TriageSeverity
  /** The rows the line is about, so the jump shows exactly what the count counted. */
  readonly items: readonly ItemRecord[]
  /** The oldest untouched days among them, when the line is about neglect. */
  readonly worstDays: number | undefined
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
export function triageLinesOf(items: readonly ItemRecord[], now: number, staleDays: number = DEFAULT_STALE_DAYS): TriageLine[] {
  // Only unfinished work can be waiting on the reader. A finished row that once
  // sat behind a date is a fact about the past, and listing it under "behind"
  // would nag about something the reader already did.
  const live = items.filter(isLiveItem)
  const behind = live.filter(item => datePostureOf(item, now).kind === 'behind')
  const blocked = live.filter(item => item.status === 'blocked')
  const stale = staleItemsOf(live, now, staleDays)
  // "No date" exempts a row that is still a bare capture, for the same reason
  // neglect does: a thought the reader wrote a minute ago has not failed to be
  // scheduled, it has not been READ twice yet. Telling someone their own new
  // note is undated is nagging about a decision they have not had the chance to
  // make — and a line that fires on everything the reader just wrote is a line
  // they switch off, which loses the genuinely undated work with it. A capture
  // that goes on to sit untouched is caught by the `stale` line instead, where
  // it belongs: the two lines answer two different questions and together they
  // cover the case.
  const undated = live.filter(item => datePostureOf(item, now).kind === 'none' && !isInboxItem(item))
  const lines: TriageLine[] = [
    { id: 'behind', count: behind.length, severity: 'warn', items: behind, worstDays: worstOf(behind, now) },
    { id: 'stale', count: stale.length, severity: 'warn', items: stale, worstDays: worstOf(stale, now) },
    { id: 'blocked', count: blocked.length, severity: 'warn', items: blocked, worstDays: worstOf(blocked, now) },
    { id: 'undated', count: undated.length, severity: 'muted', items: undated, worstDays: undefined },
  ]
  return lines.filter(line => line.count > 0)
}

/** The oldest untouched run among a set, which is the number worth saying. */
function worstOf(rows: readonly ItemRecord[], now: number): number | undefined {
  let worst: number | undefined
  for (const row of rows) {
    const days = staleDaysOf(row, now)
    if (days !== undefined && (worst === undefined || days > worst)) worst = days
  }
  return worst
}

// ── the numbers the workbench chrome reads ─────────────────────────────────

/**
 * The three numbers on the page rail, in page order.
 *
 * A `Record` keyed by {@link ItemPageId} rather than an array, so a page cannot
 * be added to the rail without a count and a page cannot be counted twice — the
 * same closed-Record idiom the sort menu and the group heads use, and for the
 * same reason: a key that does not exist is a compile error, and a key nobody
 * reads is a question that will be answered differently by the next surface.
 */
export type ItemPageCounts = Readonly<Record<ItemPageId, number>>

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
export function itemPageCountsOf(items: readonly ItemRecord[]): ItemPageCounts {
  let inbox = 0
  let schedule = 0
  for (const item of items) {
    if (isInboxItem(item)) inbox += 1
    if (isAgendaItem(item)) schedule += 1
  }
  return { inbox, list: items.length, schedule }
}

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
export function itemGroupCountsOf(
  items: readonly ItemRecord[],
  running: ReadonlyMap<string, boolean>,
): Readonly<Record<ItemStatusView, number>> {
  const counts: Record<ItemStatusView, number> = { inProgress: 0, open: 0, blocked: 0, done: 0 }
  for (const item of items) {
    counts[derivedStatusOf(item, running)] += 1
  }
  return counts
}

/** The four tiles of the overview, in reading order. */
export const ITEM_INSIGHT_IDS = ['open', 'overdue', 'today', 'week'] as const
export type ItemInsightId = typeof ITEM_INSIGHT_IDS[number]

/** One overview tile: how many, and how much of the list that is. */
export interface ItemInsightTile {
  /** Stable id, so a surface maps it to a word rather than to a position. */
  readonly id: ItemInsightId
  readonly count: number
  /**
   * This tile's share of {@link ItemInsight.total}, 0..1 — the fill of a 2px
   * hairline meter.
   *
   * It is a SHARE OF THE LIST and not a gauge: a meter that filled to the brim
   * for "3 of 3 late" would draw full confidence over the reader's worst day.
   * With one denominator for all four tiles the numbers are also comparable with
   * each other, which is the only thing a row of four meters is for.
   */
  readonly ratio: number
}

/** The whole overview: four tiles and the one number they are shares of. */
export interface ItemInsight {
  /**
   * What the tiles are shares OF: the rows that are still live, finished work
   * included in nothing. A reader's overdue count is a share of what is left to
   * do, and a list with nothing left has no share to give — which is why `total`
   * is stated rather than inferred from a ratio.
   */
  readonly total: number
  readonly tiles: readonly ItemInsightTile[]
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
export function itemInsightOf(items: readonly ItemRecord[], now: number): ItemInsight {
  const live = items.filter(isLiveItem)
  const counts: Record<ItemInsightId, number> = { open: 0, overdue: 0, today: 0, week: 0 }
  for (const item of live) {
    // The stored status, deliberately: 进行中 is the same row as 待办 seen from
    // a running card, and a tile that moved work out of 待办 while the card ran
    // would make the number rise and fall with the engine rather than with the
    // reader's work. `isLiveItem` already excluded the finished rows.
    if (item.status === 'open') counts.open += 1
    const bucket = scheduleBucketOf(item, now)
    if (bucket === 'hardOverdue' || bucket === 'behind') counts.overdue += 1
    if (bucket === 'today') counts.today += 1
    if (bucket === 'today' || bucket === 'tomorrow' || bucket === 'week') counts.week += 1
  }
  const total = live.length
  return {
    total,
    tiles: ITEM_INSIGHT_IDS.map(id => ({ id, count: counts[id], ratio: total === 0 ? 0 : counts[id] / total })),
  }
}
