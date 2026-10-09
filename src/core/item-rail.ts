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
import { derivedStatusOf, isAgendaItem } from './item-membership.ts'
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
export type ItemRailGroupWord = 'when' | 'idle' | 'rank' | 'state'

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
 *
 * ── WHY THE ORDER PUTS THE TWO DATE ROWS FIRST, AND WHAT THE GROUP IS CALLED ──
 *
 * 读者问过一句「它这个日期的逻辑是什么呢？我有点看不懂」——**因为他把它们当成三个日期
 * 在读，而其中一个是疏于照看**：`stale` 说的是「多久没人碰」，与另外两行不是同一类问题。
 * 而剩下两行也没把日期说完：一份**未来到期**的行落在这一组之外，于是「按日子」这四个字
 * 在屏上并不成立。
 *
 * 所以这一组现在是**真的按日子分**：`overdue`（已经过期）· `ahead`（还没到）·
 * `undated`（没定日期）——一条分过流的行，它的日子在过去、在未来、或者根本没有，落进且只
 * 落进一格，三个数加得起来（两处例外写在那枚 flag 自己的注释里：刚记下的一句还没到谈日子的
 * 阶段，三个日期互相矛盾的那一条两边都有日子、另有自己的说法）。`stale` 搬去它自己那一组，
 * 标题写清它问的是另一件事（见 `idle`）。
 */
const RAIL_FLAGS = ['overdue', 'ahead', 'undated'] as const
/** 「多久没人碰」是**另一个问题**，所以是另一组；这一组只有一行，而一行也可以是一组。 */
const RAIL_IDLE_FLAGS = ['stale'] as const

/**
 * **「左栏能按下哪几个筛子」的唯一出处，导出是因为它还有第二个读者。**
 *
 * 搜索框下面那些芯片（`facets.ts` 的日期那一栏）必须画得出左栏按下的**每一个**筛子。它们原来
 * 是**两份手写的表**：左栏写 `has:overdue / ahead / undated / stale`，芯片那一栏写的是
 * `has:hardOverdue / behind / undated / gated`。两套词汇只有「没定日期」重合——于是读者按
 * 「已超期」「还没到」「迟迟没动」，**列表筛了，芯片一个都不出现**：筛子开着，而屏上没有任何
 * 东西说得出它开着，也点不掉它。这正是硬性规范 17 说的那笔债：同一件事有两处写法，而错的
 * 那一处永远不会报错。
 */
export const ITEM_RAIL_DATE_FLAGS = RAIL_FLAGS
export const ITEM_RAIL_IDLE_FLAGS = RAIL_IDLE_FLAGS
export type ItemRailKey =
  | (typeof RAIL_FLAGS)[number]
  | (typeof RAIL_IDLE_FLAGS)[number]
  | ItemPriority
  | ItemStatusView
  | 'schedule'
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
  const idle = RAIL_IDLE_FLAGS.map(flag =>
    entry(`flag:${flag}`, 'flag', flag, `has:${flag}`, heldBy(item => ITEM_FLAG_TESTS[flag](probeOf(item)))))
  const priorities = RAIL_PRIORITIES.map(priority =>
    entry(`priority:${priority}`, 'priority', priority, TOKEN_BY_PRIORITY.get(priority) ?? '', heldBy(item => item.priority === priority)))
  const statuses = ITEM_STATUS_VIEWS.map(view =>
    entry(`status:${view}`, 'status', view, `status:${view.toLowerCase()}`, heldBy(item => derivedStatusOf(item, ctx.cards) === view)))

  return [
    /* 「全部」 STANDING AT THE TOP, ALONE IN ITS GROUP.
     *
     * It is the document itself — the one row with no narrowing in it — so it is
     * the rail's floor rather than one of its answers, and it sits where the eye
     * starts. It used to be the third row from the bottom, below three filter
     * groups, while the top held 「刚记下的」: a row that was a PLACE pretending to be
     * a predicate. Its membership rule (`isInboxItem`) is read by the query grammar
     * and the triage strip on their own, so removing the row removed a page and
     * nothing else. */
    {
      id: 'all',
      word: undefined,
      entries: [entry('all', 'place', 'all', '', items)],
    },
    { id: 'when', word: 'when', entries: flags },
    { id: 'idle', word: 'idle', entries: idle },
    { id: 'rank', word: 'rank', entries: priorities },
    { id: 'state', word: 'state', entries: statuses },
    /* THE BOTTOM GROUP IS THE TWO ROWS THAT CHANGE THE *FORM* RATHER THAN THE
     * FILTER — 「日程」 reads the same document day by day, 「已删除」 reads the rows
     * that are no longer in it. Both are a different KIND of thing from the three
     * groups above, which is what the rule above this group says.
     *
     * 「日程」 IS HERE BECAUSE IT HAD NO DOOR AT ALL. It has been a page since the
     * page set existed and the only way to reach it was the command palette —
     * 「a control reachable only from a keyboard does not exist for a thumb」, and a
     * whole PAGE that only the palette can open is that defect one level up. */
    {
      id: 'out',
      word: undefined,
      entries: [
        entry('schedule', 'place', 'schedule', '', heldBy(item => isAgendaItem(item))),
        entry('deleted', 'place', 'deleted', '', deleted),
      ],
    },
  ]
}

/**
 * The other tokens in this entry's group — the ones a press has to REPLACE.
 *
 * A rail group is a set of ALTERNATIVES, and that is a property of the rail's own
 * shape rather than a rule the caller should remember: 「按日子看」 offers three
 * verdicts about one row's dates, 「按重要程度」 offers the four priorities a row
 * can have exactly one of, 「按状态」 the four states. So the members of a group
 * are mutually exclusive by construction, and asking the group for them is the
 * only way to state that which cannot fall out of date: a token added to the rail
 * joins its group's exclusion list the day it is added, without anyone
 * remembering to update a second table.
 *
 * Reads the tokens from the entries themselves, so the rail's writer and its
 * replacement list are the same string rather than two spellings of it.
 * @param entry - the row that was pressed.
 * @param groups - the rail, as {@link itemRailGroupsOf} built it.
 * @returns the sibling tokens, excluding the entry's own and any empty token.
 */
export function railSiblingsOf(entry: ItemRailEntry, groups: readonly ItemRailGroup[]): readonly string[] {
  const group = groups.find(one => one.entries.some(row => row.id === entry.id))
  if (group === undefined) return []
  return group.entries
    .filter(one => one.id !== entry.id && one.token !== '')
    .map(one => one.token)
}