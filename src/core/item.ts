/**
 * The item domain model — one row of the 任务清单, the SECOND document this
 * plugin owns. It is a sibling of the task ledger, not a view over it: its own
 * document, its own truth, its own merge (the kernel in board-merge-core.ts is
 * what makes that possible, and this model is the shape that will feed it).
 *
 * What it borrows from the board is exactly one optional link — `taskId` — and
 * even that is READ, never re-judged: an item never decides for itself whether
 * its card is running. It asks {@link itemStatusOf}, which reads the card's own
 * live state, so the two surfaces cannot disagree about the same card.
 *
 * THREE DECISIONS THIS MODEL IS BUILT ON (all settled; the code is their
 * consequence, not their summary):
 *
 *  - Steps are ONE level. {@link ItemStep} has no children field, so nesting is
 *    not representable rather than merely discouraged. Progress is derived from
 *    the steps ({@link itemProgressOf}); there is no percentage to hand-fill,
 *    and a row with no steps has NO progress at all (an empty 0% bar is a lie
 *    about work that was never defined).
 *  - `ref` is the stable short number a person and a model both say out loud
 *    (`#12`). It is minted by a monotonic counter ON THE DOCUMENT and is never
 *    writable, so a replica cannot renumber the list under the user's feet — and
 *    no UUID ever has to leave the host to be named in a sentence.
 *  - The three times are three fields, never one. 最早开始 / 截止 / 硬期限 are
 *    different promises; collapsing them is how a soft deadline turns into a
 *    missed one.
 *
 * NEW-FIELD ADMISSION (the rule, so the next field asks for permission first):
 * a field enters this model only if it participates in FILTERING, SORTING or
 * DISPLAY. Everything else is written into `body` as prose, where it costs
 * nothing to keep and everything to model. That is why there is no `order`
 * (the list sorts itself), no `statusHistory` (nothing reads it) and no
 * `viewedAt` (the checklist is scanned, not watched — the board's unread
 * reminder has no business here).
 *
 * ── STATUS IS READ FROM THE BOARD, NOT RE-DECIDED HERE ──────────────────────
 *
 * 这一版把状态的**来源**搬了：清单自己只存两个值（还没做 / 做完了），而「一条工作现在
 * 在哪一栏」读看板的卡（{@link itemStatusOf}）。所以这一份文件从看板那里导入两个东西
 * ——`TaskStatus` 与 `ALL_STATUSES`——而不是把它们抄一遍。抄一遍的代价不是重复十二行，
 * 是**加一栏时清单不会跟着加**，而屏上不会有人说一句话。
 */
import { ALL_STATUSES, type TaskStatus } from './tasks.ts'

/**
 * THE STORED STATUS: the two the checklist itself owns.
 *
 * 一份清单自己能说的话只有两句——「还没做」与「做完了」。其余三栏（待规划 / 进行中 /
 * 待审核）**不是清单的状态，是它挂着的那张卡在哪一栏**：那是看板的字段，清单只读它
 * （见 {@link itemStatusOf}）。把两件事合成一个枚举，就是同一件东西有两个主人。
 *
 * 这一版删掉了 `blocked`（受阻）。读者的话是「受阻肯定不能有了」——而它本来就只在
 * 清单这里存在：看板的五栏里没有它，于是它是这套词汇里唯一一个**两个面板对不上**的
 * 词。老文档里的 `open` / `blocked` 由解析器读成 `todo`，一个字都不丢。
 */
export type ItemStatus = 'todo' | 'done'

/**
 * 一个面可以**显示**的状态：看板的五栏，逐字同一张表。
 *
 * 它不再是「存的加上一个派生的」那种并集，而是**导入**看板自己的类型——于是清单与
 * 看板对「一条工作现在在哪儿」只有一份定义，加一栏、改一个词、换一个颜色都只动一处。
 * 这一条也是读者那句「那些点就等于变成 5 个状态吧」的答案：是五个，而它们就是看板
 * 的五个。
 */
export type ItemStatusView = TaskStatus

/** The four priority tiers, lowest first (the list sorts on this). */
export type ItemPriority = 'low' | 'normal' | 'high' | 'urgent'

/** Who wrote this row, and when. Kept so a bad row can be traced to its author. */
export type ItemOriginSource = 'human' | 'ai' | 'import'

/**
 * The provenance stamp. Storage text is DATA, never instruction: this field is
 * what lets a reader tell the two apart at a glance, so it is never rewritten
 * after birth (see {@link ITEM_FIELDS}).
 */
export interface ItemOrigin {
  source: ItemOriginSource
  at: number
  /** The session that wrote it, when a model did — the audit trail's handle. */
  sessionId?: string
}

/** One checklist entry: a line of text and whether it is done. No children. */
export interface ItemStep {
  id: string
  text: string
  done: boolean
}

/** One checklist row. */
export interface ItemRecord {
  /** Stable identity (uuid). Never shown, never writable, never spoken. */
  id: string
  /** The short number this row is called by (`#12`). Document-minted. */
  ref: number
  /** One-line title; may be empty, in which case the body's first line is it. */
  title: string
  /** The body, as Markdown. */
  body: string
  /** Context notes for whoever (model included) picks this up later. */
  notes: string
  /** The checklist. One level; progress is derived from it. */
  steps: ItemStep[]
  status: ItemStatus
  priority: ItemPriority
  tags: string[]
  /** 最早开始 — the earliest moment this may be started. */
  startsAfter: number | undefined
  /** 截止 — when it is wanted. */
  dueAt: number | undefined
  /** 硬期限 — the one that does not move. */
  hardDueAt: number | undefined
  /** The board card this item belongs to, if any (zero or one, never many). */
  taskId: string | undefined
  origin: ItemOrigin
  createdAt: number
  updatedAt: number
}

/** 清单自己能写的两个值，按读者读到的顺序：还没做 · 做完了。 */
export const ITEM_STATUSES: readonly ItemStatus[] = ['todo', 'done']

/**
 * Every status a surface may SHOW: the board's columns, in the board's own order.
 *
 * **它是导入的，不是抄的**——`ALL_STATUSES` 是看板那五个 ids 的唯一定义处，
 * 所以「清单加了一栏而看板没有」这句话在类型上就不成立。两个列表仍不是同一个问题：
 * 上面那个回答「人能写什么」，这一个回答「能显示成什么」，而它们的关系正是看板自己的
 * `MANUAL_STATUSES ⊆ ALL_STATUSES`：**清单能写的两个，是看板允许人手拖的那三栏里的
 * 两个**（待规划那一档由清单的「刚记下的」那件事表达，见 `isInboxItem`）。
 *
 * 顺序也是看板的顺序：待规划 · 待办 · 进行中 · 待审核 · 已完成。左栏那一组、查询
 * 语法里 `status:` 的词表、以及模型学到的词表全部从这一份派生。
 */
export const ITEM_STATUS_VIEWS: readonly ItemStatusView[] = ALL_STATUSES

/**
 * The four priority tiers, listed LOW to HIGH — an ENUM order, not a ranking.
 *
 * Read it wherever tiers are LISTED (a dropdown, a filter menu, a `oneOf` the
 * catalog renders). Never sort on it: {@link itemPriorityRankOf} is the scale
 * that orders, and it runs the other way.
 */
export const ITEM_PRIORITIES: readonly ItemPriority[] = ['low', 'normal', 'high', 'urgent']

/**
 * The tiers on the scale every ORDERING reads: the loud one is SMALL, so an
 * ascending compare puts 紧急 first.
 *
 * IT LIVES HERE, IN THE MODEL, AND NOT BESIDE THE TIER LIST, because the two are
 * opposites and that is the trap. {@link ITEM_PRIORITIES} is declared lowest-first
 * because that is how the tiers are named in a table, and sorting on its index
 * puts the reader's most urgent row at the bottom of the page — which is exactly
 * what happened: the document's own order and the surface's 「优先级」 were two
 * rulers pointing opposite ways, and the panel's comment claimed they were one.
 * So there is ONE rank table, in the one module that owns what a priority IS, and
 * both orderings read it.
 *
 * `ITEM_PRIORITIES` keeps its own order for the places that genuinely want the
 * tiers listed low to high (a settings list, a completion menu). Those are
 * allowed to read the enum; nothing that ORDERS is.
 *
 * @param priority - the tier.
 * @returns 0 for the loudest, rising as the row matters less. Ties never happen:
 *   every tier has a rank, which is what lets an ordering stay a total one.
 */
const PRIORITY_RANKS: Readonly<Record<ItemPriority, number>> = { urgent: 0, high: 1, normal: 2, low: 3 }

/**
 * How loud a tier is, as a number small enough to sort on.
 * @param priority - the tier.
 * @returns 0 for 紧急, 3 for 低; never a tie between two different tiers.
 */
export function itemPriorityRankOf(priority: ItemPriority): number {
  return PRIORITY_RANKS[priority]
}

/**
 * The four tiers in the order a READER meets them: 紧急 first.
 *
 * Derived from {@link itemPriorityRankOf} rather than written out, because a list
 * of four names typed in a second place is a list that keeps the old order the day
 * the scale changes — and the surfaces that list tiers (the rail, the batch bar,
 * the create sheet, the detail's four chips) would then disagree about which end is
 * which. Anywhere tiers are OFFERED, this is the order; anywhere they are merely
 * enumerated, {@link ITEM_PRIORITIES} is.
 */
export const ITEM_PRIORITIES_BY_WEIGHT: readonly ItemPriority[] = [...ITEM_PRIORITIES]
  .sort((a, b) => itemPriorityRankOf(a) - itemPriorityRankOf(b))

/**
 * A verdict on one field: may an action write it, and if not, why not. The
 * three answers mean three different things, and the difference is the whole
 * point of the table:
 *
 * - `writable` — an action may write it, so it belongs in that action's params.
 * - `derived` — the system computes or assigns it from other state (a counter,
 *   a clock, another field). Writing it would overwrite a derivation, so it is
 *   refused; the derivation is the only writer.
 * - `forbidden` — no writer exists in this system at all, and that is the
 *   promise: the identity nobody may restate, and the provenance nobody may
 *   rewrite.
 *
 * The key set IS the type ({@link ItemRecord}), so adding a field to the model
 * without ruling on it here fails the build. That is the point: a field nobody
 * ruled on is a field nobody thought about.
 */
export interface FieldSpec {
  readonly access: 'writable' | 'derived' | 'forbidden'
  readonly why: string
}

/** Every field of {@link ItemRecord}, ruled on.
 *
 *  `as const satisfies` rather than a bare annotation, and the reason is that
 *  the verdict has to be READABLE, not only writable: `item-transitions.ts`
 *  derives the patch type from the `access` column, so a field ruled
 *  `derived` or `forbidden` cannot be patched.
 *
 *  AND THE FAILURE IS SILENT, WHICH IS THE WHOLE POINT OF WRITING IT DOWN. An
 *  annotation widens `access` to the union of all three verdicts, so every key
 *  stops being `writable` and `WritableItemKey` collapses to `never` — which
 *  makes `ItemPatch` the EMPTY object type, and `{}` accepts any object literal
 *  there is. The gate does not fail the build; it OPENS, and a patch may then
 *  carry `ref`, `origin` or `id` straight into a row. Measured, not guessed: with
 *  this annotation in place `pnpm typecheck` is silent on a patch smuggling
 *  `ref`; with it reverted the same line also compiles, and only the
 *  `@ts-expect-error` ratchet in `item-transitions.ts` notices. So do not
 *  "simplify" this back into an annotation — the exhaustiveness check survives
 *  either way, and that is exactly what makes the change look harmless. */
export const ITEM_FIELDS = {
  id: { access: 'forbidden', why: '身份由文档分配；副本重述它就是换了一行' },
  ref: { access: 'derived', why: '短编号来自文档上的单调计数器，写它等于在别人脚下重排整张清单' },
  title: { access: 'writable', why: '一行标题，可以留空（空了就从正文首行补）' },
  body: { access: 'writable', why: '正文，Markdown；没进模型的新字段一律写这里' },
  notes: { access: 'writable', why: '给接手的人或模型看的上下文备注，参与展示' },
  steps: { access: 'writable', why: '勾选清单，参与展示；进度由它派生，不另存' },
  status: { access: 'writable', why: '开放/受阻/完成三选一；「进行中」是派生，不存' },
  priority: { access: 'writable', why: '四档，参与筛选与排序' },
  tags: { access: 'writable', why: '自由标签，参与筛选' },
  startsAfter: { access: 'writable', why: '最早开始，与截止、硬期限是三件不同的事' },
  dueAt: { access: 'writable', why: '截止时间，与硬期限语义不同，不挤成一列' },
  hardDueAt: { access: 'writable', why: '硬期限，唯一不会顺延的那个' },
  taskId: { access: 'writable', why: '关联看板卡片，零张或一张；只存链接，不存第二份判断' },
  origin: { access: 'forbidden', why: '来源标记是出事时的追溯凭据，出生后不可改写' },
  createdAt: { access: 'derived', why: '出生时刻，只有文档写' },
  updatedAt: { access: 'derived', why: '同步合并的 LWW 键，只能由写入漏斗盖章' },
} as const satisfies Record<keyof ItemRecord, FieldSpec>

/** Progress from the steps, or undefined when the row has no checklist at all. */
export interface ItemProgress {
  done: number
  total: number
  /** 0..1; the display layer decides how to draw it. */
  ratio: number
}

/** The derived progress. NO steps means no progress — never a 0% bar. */
export function itemProgressOf(item: ItemRecord): ItemProgress | undefined {
  if (item.steps.length === 0) return undefined
  const done = item.steps.filter(step => step.done).length
  return { done, total: item.steps.length, ratio: done / item.steps.length }
}

/**
 * The one status derivation: **a row that hangs off a card is wherever that card is.**
 *
 * `itemStatusOf` 的旧版只把「在跑」这一件事读给卡片（其余时间信自己存的那个
 * `open`）。现在读的是**整栏**——因为清单自己不拥有那五栏里的三栏，而一件工作在哪
 * 一栏是看板的事实。这不是新增一条判断，是原来那条判断的推广：注释早就写着
 * 「an item never decides for itself whether its card is running」，而「在跑」只是
 * 「在哪一栏」的一个取值。
 *
 * **读者自己按下的「完成了」压过卡片。** 这一条是旧版的行为（有测试钉着：一张卡重跑
 * 起来的时候，刚被读者勾掉的那一行仍然是完成），而它现在仍然成立：一次显式的勾选是
 * 读者对**这一行**说的话，不该被卡片的另一次运行悄悄改掉。
 *
 * @param item - the row.
 * @param cardStatus - 它挂着的那张卡此刻在哪一栏；没有卡、或这台机器看不见看板时是
 *   `undefined`，那时这一行说的是它自己的字段（不猜，也不假装看得到）。
 * @returns the column this row stands in.
 */
export function itemStatusOf(item: ItemRecord, cardStatus?: TaskStatus): ItemStatusView {
  if (item.status === 'done') return 'done'
  return cardStatus ?? item.status
}

/** The title a surface shows: the row's own, else the body's first line. */
export function itemTitleOf(item: ItemRecord): string {
  if (item.title !== '') return item.title
  for (const line of item.body.split('\n')) {
    const trimmed = line.trim()
    if (trimmed !== '') return trimmed.replace(/^#+\s*/, '')
  }
  return ''
}

/** Which pair of the three dates is out of order, and by how much. */
export interface ItemDateConflict {
  /** The field that must not be later than its neighbour. */
  readonly field: 'startsAfter' | 'dueAt' | 'hardDueAt'
  readonly value: number
  /** The date it may not exceed. */
  readonly limit: number
  /**
   * WHICH FIELD the limit is. A conflict is a PAIR, and a sentence that names one
   * of the two fields cannot be assembled from half of it: the surface used to
   * hard-code 「最早开始 … 截止」 for all three possible pairs, so a row whose
   * 截止 sat past its 硬期限 read 「最早开始晚于它该守的截止」 — naming a field
   * that was never in conflict and pointing at the one that was as if it were the
   * bound. `DESIGN.md` requires the sentence to name the two fields that actually
   * disagree, and that is only possible if both are carried.
   */
  readonly limitField: 'startsAfter' | 'dueAt' | 'hardDueAt'
}

/**
 * The three dates, checked against each other.
 *
 * The order is not a convention: `startsAfter` is when the work may begin, so a
 * start date after the wanted-by date is a promise the row cannot keep, and
 * `hardDueAt` is the one date that does not move, so a softer date past it is a
 * promise the reader has already broken. A row holding an impossible pair
 * renders as a schedule that cannot be believed, and nothing about it looks
 * wrong on screen.
 *
 * The conflict is REPORTED, never repaired. Silently swapping or clamping the
 * two would leave the reader's words changed with no note that they were, and a
 * quietly edited date is worse than an obviously broken one — so the write path
 * refuses and the surface says why.
 * @param item - the row.
 * @returns the first violated pair, or `undefined` when the three agree.
 */
export function itemDateConflict(item: ItemRecord): ItemDateConflict | undefined {
  if (item.startsAfter !== undefined && item.dueAt !== undefined && item.startsAfter > item.dueAt) {
    return { field: 'startsAfter', value: item.startsAfter, limit: item.dueAt, limitField: 'dueAt' }
  }
  if (item.dueAt !== undefined && item.hardDueAt !== undefined && item.dueAt > item.hardDueAt) {
    return { field: 'dueAt', value: item.dueAt, limit: item.hardDueAt, limitField: 'hardDueAt' }
  }
  if (item.startsAfter !== undefined && item.hardDueAt !== undefined && item.startsAfter > item.hardDueAt) {
    return { field: 'startsAfter', value: item.startsAfter, limit: item.hardDueAt, limitField: 'hardDueAt' }
  }
  return undefined
}

/** What a caller supplies to mint a row: everything the caller decided. */
export interface NewItemInput {
  readonly title: string
  readonly body: string
  readonly notes: string
  readonly status: ItemStatus
  readonly priority: ItemPriority
  readonly steps?: readonly ItemStep[]
  readonly tags?: readonly string[]
  readonly startsAfter?: number
  readonly dueAt?: number
  readonly hardDueAt?: number
  readonly taskId?: string
}

/**
 * Mint a row, ready for the document to accept.
 *
 * ONE CONSTRUCTOR FOR BOTH WRITERS. A row used to be built twice — once by the
 * interface, once by the model — and that is how two halves of one document
 * drift into disagreeing about what a freshly written row looks like. Both go
 * through this, so the fields that must always agree always do.
 *
 * The id and the ORIGIN are parameters, and neither is defaulted. The number is
 * the document's to hand out, and the origin is the audit trail's handle which
 * {@link ITEM_FIELDS} forbids anyone from rewriting — so both are facts the
 * writer supplies rather than guesses this function would make on its behalf.
 * @param input - what the writer decided.
 * @param origin - who wrote it, and when.
 * @param id - the identity the document will key on.
 * @param now - the writing clock, stamped on both ends of the row.
 * @returns a row carrying `ref: 0`, which means "not numbered yet".
 */
export function newItem(input: NewItemInput, origin: ItemOrigin, id: string, now: number): ItemRecord {
  return {
    id,
    ref: 0,
    title: input.title.trim(),
    body: input.body.trim(),
    notes: input.notes.trim(),
    steps: input.steps === undefined ? [] : input.steps.map(step => ({ ...step })),
    status: input.status,
    priority: input.priority,
    tags: input.tags === undefined ? [] : [...input.tags],
    startsAfter: input.startsAfter,
    dueAt: input.dueAt,
    hardDueAt: input.hardDueAt,
    taskId: input.taskId,
    origin: { ...origin },
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * The validated-but-unrepaired shape: the medium's words, checked for the
 * fields that must be right for the row to exist at all, and left `unknown` for
 * the ones the normalizers below repair. A guard that promised more than it
 * checked would make every cast downstream a lie.
 */
interface RawItem {
  id: string
  title: string
  body: string
  notes: string
  createdAt: number
  updatedAt: number
  steps: unknown
  origin: { source: ItemOriginSource; at: number; sessionId?: string }
  ref?: unknown
  status?: unknown
  priority?: unknown
  tags?: unknown
  startsAfter?: unknown
  dueAt?: unknown
  hardDueAt?: unknown
  taskId?: unknown
}

/**
 * Structural check for a persisted row: what makes a row a ROW. Status and
 * priority stay free (the normalizers below repair them), and so do the steps'
 * own entries — those are repaired one by one in {@link normalizeSteps}.
 *
 * ONE DELIBERATE DIVERGENCE FROM THE LEDGER GRAMMAR. `parseLedger` drops a
 * whole task when one of its execution rounds is malformed, and that is right
 * there: a round is a fact about a run, and silently keeping the card without it
 * would misreport its history. A checklist step is a line the person typed, and
 * the blast radius is the other way round — dropping the whole item (body,
 * notes, three dates) to fix one checkbox is the bug, not the repair. So the
 * row is checked and the entries are repaired.
 */
/**
 * The shape guard, exported because it is a CONTRACT and not a private helper.
 *
 * Everything downstream — the merge, the sort, the row projection — assumes a row
 * that passed here has FINITE numbers, because a `NaN` comparator does not throw:
 * `Array.prototype.sort` treats it as "equal", so the order quietly becomes
 * arrival order and two devices holding one document render two different lists.
 * A guard whose failure mode is invisible has to be reachable from a test, and it
 * was not.
 */
export function isItemRecordShape(value: unknown): value is RawItem {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  if (typeof row.id !== 'string' || row.id === '') return false
  if (typeof row.title !== 'string') return false
  if (typeof row.body !== 'string') return false
  if (typeof row.notes !== 'string') return false
  /* FINITE, not merely a number — and the two stamps are the last place in this
     shape guard that was not already asking.
     The three DATES go through `itemInstantOf`, which requires `Number.isFinite`;
     these two only asked `typeof === 'number'`, and `JSON.parse('1e999')` is
     `Infinity`, not an error. So a persisted row could carry an infinite stamp,
     and every ordering's tie-break tail subtracts `updatedAt` — `Infinity -
     Infinity` is `NaN`. A `NaN` comparator makes `Array.prototype.sort` treat the
     pair as EQUAL, so those rows are never ordered against each other and the
     list falls back to arrival order: **two devices holding one document render
     two different lists, and nothing anywhere goes red.**

     That is the same partial-order defect the date sort keys carry a long
     comment about having already paid for once, reached through the back door of
     a guard that checked the type and not the value. */
  if (typeof row.createdAt !== 'number' || !Number.isFinite(row.createdAt)) return false
  if (typeof row.updatedAt !== 'number' || !Number.isFinite(row.updatedAt)) return false
  if (row.taskId !== undefined && typeof row.taskId !== 'string') return false
  if (!Array.isArray(row.steps)) return false
  if (typeof row.origin !== 'object' || row.origin === null) return false
  const origin = row.origin as Record<string, unknown>
  if (origin.source !== 'human' && origin.source !== 'ai' && origin.source !== 'import') return false
  if (typeof origin.at !== 'number') return false
  if (origin.sessionId !== undefined && typeof origin.sessionId !== 'string') return false
  return true
}

/**
 * A finite timestamp, or undefined for every other shape (including NaN).
 *
 * EXPORTED, because "can this value be a moment" is one question with three
 * callers — the persisted row, the model writing a date, and a fresh capture —
 * and it lives next to the field ruling that says what a date MEANS. A value
 * that is not a finite number is not a promise; it is a sentence somebody typed
 * where a calendar was expected, and storing it would produce a row whose date
 * sorts and renders as though it were a day.
 */
export function itemInstantOf(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined
}

/**
 * Tags: strings only, blanks dropped, order kept, duplicates folded.
 *
 * One grammar for the persisted row and for a writer's list alike, so the same
 * words cannot be filed twice on one surface and once on the other. Order is
 * kept because a tag list is read as a phrase, and the first tag is the one a
 * reader is most likely to have meant first.
 */
export function itemTagsOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const tags: string[] = []
  for (const entry of raw) {
    if (typeof entry !== 'string') continue
    const tag = entry.trim()
    if (tag === '' || tags.includes(tag)) continue
    tags.push(tag)
  }
  return tags
}

/** Steps: an entry is kept when its id and text are readable, malformed ones
 *  dropped, ids made unique. A `done` that is not a boolean reads as NOT done:
 *  a wrongly-ticked box hides work that still exists, while a wrongly-unticked
 *  one only shows work that is there. The text is the person's, so a corrupt
 *  checkbox must never cost them the line. */
function normalizeSteps(raw: unknown): ItemStep[] {
  if (!Array.isArray(raw)) return []
  const steps: ItemStep[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const step = entry as Record<string, unknown>
    if (typeof step.id !== 'string' || step.id === '') continue
    if (typeof step.text !== 'string') continue
    if (steps.some(existing => existing.id === step.id)) continue
    steps.push({ id: step.id, text: step.text, done: step.done === true })
  }
  return steps
}

/** Mint a fresh short number for a row the medium never carried one. */
export type RefMinter = () => number

/**
 * Parse + repair a persisted checklist document; unusable rows are dropped.
 * Mirrors the ledger's grammar deliberately (same failure behaviour, same
 * console discipline, same "repair the field, never fail the row" law) so the
 * two documents cannot drift into different standards for the same mistake.
 *
 * @param raw - the persisted JSON text.
 * @param mintRef - the document's short-number counter. Required, not
 *  defaulted: a row's number is the document's to hand out, and a silent
 *  fallback that mints the same number twice would make two rows answer to
 *  one name.
 */
export function parseItems(raw: string | null, mintRef: RefMinter): ItemRecord[] {
  if (raw === null) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    console.error('[dsh-task-board] persisted checklist is not valid JSON; starting empty', error)
    return []
  }
  if (!Array.isArray(parsed)) {
    console.error('[dsh-task-board] persisted checklist is not an array; starting empty')
    return []
  }
  const items: ItemRecord[] = []
  for (const row of parsed) {
    if (!isItemRecordShape(row)) {
      console.warn('[dsh-task-board] dropping invalid checklist row', row)
      continue
    }
    const rawRef = row.ref
    const ref = typeof rawRef === 'number' && Number.isInteger(rawRef) && rawRef > 0 ? rawRef : mintRef()
    items.push({
      id: row.id,
      ref,
      title: row.title,
      body: row.body,
      notes: row.notes,
      steps: normalizeSteps(row.steps),
      /* **两个老值都读成「还没做」。** `open` 是这一版之前的名字（同一个意思的新名），
       * `blocked` 是这一版删掉的那一档（受阻的行还在清单里，只是它现在说「还没做」）。
       * 未知值也落在这里：一行是**人写下的东西**，枚举是我们的事——下一版再改词，
       * 读者的一条也不该因此消失。 */
      status: ITEM_STATUSES.includes(row.status as ItemStatus) ? row.status as ItemStatus : 'todo',
      priority: ITEM_PRIORITIES.includes(row.priority as ItemPriority) ? row.priority as ItemPriority : 'normal',
      tags: itemTagsOf(row.tags),
      startsAfter: itemInstantOf(row.startsAfter),
      dueAt: itemInstantOf(row.dueAt),
      hardDueAt: itemInstantOf(row.hardDueAt),
      taskId: typeof row.taskId === 'string' && row.taskId !== '' ? row.taskId : undefined,
      origin: {
        source: row.origin.source,
        at: row.origin.at,
        ...row.origin.sessionId !== undefined && row.origin.sessionId !== '' ? { sessionId: row.origin.sessionId } : {},
      },
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })
  }
  return items
}
