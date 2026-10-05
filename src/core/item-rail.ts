/**
 * The rail: what the reader may look at, and how many of each there is.
 *
 * ── WHY THIS FILE EXISTS, AND WHY IT IS NOT A LIST OF WORDS ──────────────────
 *
 * The first draft of the rail was a hand-written table — `[{ word: '落后的',
 * n: 2 }, { word: '受阻的', n: 1 }] — with the numbers in the fixture. It looked
 * right and it was wrong in a way nothing on screen could report: the number was
 * a literal and the row it sat next to was a filter, so 「落后的 2」 and 「点进去
 * 看到几行」 were two facts that agreed only while nobody changed the data.
 * That is the defect PRODUCT's invariant 1 exists to forbid, reproduced by the
 * very component that is supposed to satisfy it.
 *
 * So **every entry here carries the rows it holds, and its count is their
 * length.** There is no number in this file to be stale, because there is no
 * number in this file at all — `n` is `rows.length`, computed by the same
 * `filter` a reader's click will run.
 *
 * ── WHY AN ENTRY CARRIES A PREDICATE AND NOT ONLY A TOKEN ───────────────────
 *
 * Three of the entries here — 刚记的, 全部, 已删除 — are SETS, not filters, and a
 * set has no token in the query grammar. Forcing them into one would mean either
 * inventing a `has:inbox` flag the model then learns to type, or giving them a
 * token that means something else to the reader. So an entry carries both, and
 * the token is `''` for the ones that are not filters — which is a fact about
 * the entry rather than a special case at three call sites.
 *
 * The five flags the rail does NOT give a row (`overdue`, `blocked`, `linked`,
 * `done`, and `hardOverdue` in the group) stay reachable through the search box
 * and the palette. That is a choice, so it is written down: 受阻 and 已完成 are
 * STATUSES and they have a row under 「按状态」; a row in two groups is two
 * identities for one set of rows, which is the exact duplication invariant 1
 * forbids. `overdue` is the union of two rows that are each already here.
 */
import type { ItemPriority, ItemRecord, ItemStatusView } from './item.ts'
import { ITEM_PRIORITIES, ITEM_STATUS_VIEWS, itemPriorityRankOf } from './item.ts'
import { derivedStatusOf, isInboxItem } from './item-membership.ts'
import { flagProbeOf, ITEM_FLAG_TESTS, type ItemMatchContext } from './item-query.ts'
import { PRIORITY_BY_TOKEN } from './item-query.ts'

/** What KIND of question an entry asks. Drives its shape and its affordance,
 *  and it is the only thing a surface may branch on — never `n`, never `token`. */
export type ItemRailKind = 'collection' | 'flag' | 'priority' | 'status' | 'place'

/** One row in the rail. */
export interface ItemRailEntry {
  /** Stable, keyed off nothing a reader sees. Two entries never share one. */
  readonly id: string
  readonly kind: ItemRailKind
  /** The value this entry asks about: a flag name, a priority, a status view, or
   *  a set id. Stable keys, never display words — a filter written against a
   *  display name matches nothing the moment that name is reworded. */
  readonly key: ItemRailKey
  /** The query token that writes THIS SAME question into the search box, or `''`
   *  for the entries that name a set rather than a filter. */
  readonly token: string
  /** The rows. The count is their length — never a second number. */
  readonly rows: readonly ItemRecord[]
  readonly n: number
}

/** The caption a group carries, or `undefined` for the two groups that are
 *  entrances and exits rather than categories. **A closed union, not `string`:** a
 *  group name is a word, and a word that reaches the dictionary through a `string`
 *  is a word the dictionary cannot check — the rail's first version printed
 *  「全部」 twice for exactly that reason. */
export type ItemRailGroupWord = 'when' | 'rank' | 'state'

/** A labelled run of entries. `word` is `undefined` for the two groups that are
 *  entrances and exits rather than categories, so the surface can draw them
 *  without a caption without asking whether the caption would say anything. */
export interface ItemRailGroup {
  readonly id: string
  readonly word: ItemRailGroupWord | undefined
  readonly entries: readonly ItemRailEntry[]
}

/**
 * THE THREE THINGS THE CALENDAR SAYS, and only three.
 *
 * It used to be five — `hardOverdue` and `behind` separately, plus `stale`,
 * `undated` and `gated` — and the two lateness entries were the defect: two rows,
 * two numbers, two words that both said 「晚了」, and a reader who could not tell
 * from the rail which date each one was about. **The grammar already has the
 * answer as one predicate**: `has:overdue` is `hardOverdue ∨ behind`, it is
 * already in {@link ITEM_FLAG_TESTS}, already taught to the model, already
 * covered. The rail was showing the two halves of a thing the query language
 * offers whole.
 *
 * So it shows the whole. Which date is late is still said, in the two places that
 * can say it without ambiguity: the row's own tail names the date
 * （「硬期限超期 15 天」/「截止落后 18 天」, never both as 「超期」), and the detail's
 * date axis prints all three dates with their own readings.
 *
 * `gated` is gone for a different reason: it means 「还没到能动的日子」, which is
 * **good news**, and a rail is read when something is wrong. It has a page of its
 * own (日程) and a token (`has:gated`) — a state nobody can reach from here is a
 * state the rail should not be carrying.
 *
 * `blocked` is deliberately NOT here either. It is a status, it has a row under
 * 「按状态」, and a set with two identities in one rail is the duplication
 * invariant 1 forbids.
 */
const RAIL_FLAGS = ['overdue', 'stale', 'undated'] as const
export type ItemRailKey =
  | (typeof RAIL_FLAGS)[number]
  | ItemPriority
  | ItemStatusView
  | 'inbox'
  | 'all'
  | 'deleted'

/** `urgent` first. Derived from the model's own rank, because the enum order in
 *  `ITEM_PRIORITIES` is an ENUM order and sorting on it put 紧急 LAST — the
 *  defect `item-sort.ts` records having already paid for once. */
const RAIL_PRIORITIES: readonly ItemPriority[] = [...ITEM_PRIORITIES]
  .sort((a, b) => itemPriorityRankOf(a) - itemPriorityRankOf(b))

/** `p1` for urgent, and so on. The inverse of the model's own table rather than
 *  a second one written out, so a re-tiered priority cannot leave the token
 *  pointing at the old tier. */
const TOKEN_BY_PRIORITY: ReadonlyMap<ItemPriority, string> = new Map(
  Object.entries(PRIORITY_BY_TOKEN).map(([token, priority]) => [priority, token]),
)

function entry(
  id: string,
  kind: ItemRailKind,
  key: ItemRailKey,
  token: string,
  rows: readonly ItemRecord[],
): ItemRailEntry {
  return { id, kind, key, token, rows, n: rows.length }
}

/**
 * The rail, as it stands for this document at this moment.
 *
 * @param items - every row in the document, tombstones already settled.
 * @param ctx - the clock, the staleness threshold and the board's running map.
 * @param deleted - the archive rows, which live in tombstones and are therefore
 *   NOT in `items`. Passed in rather than read, because this module is pure and
 *   the archive is a document question, not a predicate question.
 */
export function itemRailGroupsOf(
  items: readonly ItemRecord[],
  ctx: ItemMatchContext,
  deleted: readonly ItemRecord[] = [],
): readonly ItemRailGroup[] {
  const probeOf = (item: ItemRecord) => flagProbeOf(item, ctx)
  const heldBy = (test: (item: ItemRecord) => boolean) => items.filter(test)

  const flags = RAIL_FLAGS.map(flag =>
    entry(`flag:${flag}`, 'flag', flag, `has:${flag}`, heldBy(item => ITEM_FLAG_TESTS[flag](probeOf(item)))))
  const priorities = RAIL_PRIORITIES.map(priority =>
    entry(`priority:${priority}`, 'priority', priority, TOKEN_BY_PRIORITY.get(priority) ?? '', heldBy(item => item.priority === priority)))
  const statuses = ITEM_STATUS_VIEWS.map(view =>
    entry(`status:${view}`, 'status', view, `status:${view.toLowerCase()}`, heldBy(item => derivedStatusOf(item, ctx.running) === view)))

  return [
    {
      id: 'inbox',
      word: undefined,
      entries: [entry('inbox', 'collection', 'inbox', '', heldBy(item => isInboxItem(item)))],
    },
    { id: 'when', word: 'when', entries: flags },
    { id: 'rank', word: 'rank', entries: priorities },
    { id: 'state', word: 'state', entries: statuses },
    {
      id: 'out',
      word: undefined,
      entries: [
        entry('all', 'place', 'all', '', items),
        entry('deleted', 'place', 'deleted', '', deleted),
      ],
    },
  ]
}