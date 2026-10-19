/**
 * Every vocabulary the list names, in one place, as CLOSED tables.
 *
 * WHY ONE FILE. Spread across four files, the same handful of words becomes
 * eight answers to four questions: the row and the detail pane each with a
 * `PRIORITY_LABEL`, the row's menu and the property column each with its own
 * status wording (动词形与名词形，见下), the batch bar and the page props each with
 * a priority table, and the overview strip with its own `TILE_ORDER` — a second
 * copy of the model's own status order. The failure mode is not a
 * compile error — it is a word that quietly drifts, or renders `undefined`,
 * while the panel goes on looking finished.
 *
 * The rule that makes it safe is CLOSEDNESS, and it is the whole point of the
 * type: `Readonly<Record<ItemPriority, TaskBoardKey>>` cannot be satisfied by a
 * table that is missing a tier, so the day the model grows one, `tsc` names
 * this file and nothing else. A `Record<string, …>` satisfies nothing — it
 * accepts every key and guarantees none — which is why a table that needs a
 * `?? 'fallback'` is not merely untidy: the fallback is there
 * precisely because the table cannot be trusted to be complete, and it
 * renders a word that is true of no flag at all.
 *
 * WHAT IS DELIBERATELY NOT HERE: any judgment. A table maps a value the model
 * already decided to a word for it. Which rows match a filter, which page a row
 * is on and what a date means are all `core/item-view.ts`, read by this surface
 * and by `taskboard_query` alike.
 */
import type { ItemDateKey, ItemPriority, ItemStatus } from '../../core/item.ts'
import type { ItemFlag, ItemSort, ItemStatusView, ScheduleBucketId } from '../../core/item-view.ts'
import { STATUS_KEY } from '../board/status.ts'
import type { TaskBoardKey } from '../locales.ts'

/**
 * The seven — now six — orders, and the word for each.
 *
 * This table is the reason the filter bar has never had to be told what an
 * order is called. It was written out longhand once, in the bar itself, and the
 * first time the model dropped a tier `tsc` named this line and nothing else —
 * which is the entire reason a closed `Record` is worth more than a `switch`.
 */
export const SORT_LABEL: Readonly<Record<ItemSort, TaskBoardKey>> = {
  sequence: 'item.sort.sequence',
  /* 三个日期档读**字段自己那一份词**：排序菜单另写一套、而字段的名字是另一套，
   *  就是同一件事有两个说法——而两套里总有一套会先过期。 */
  starts: 'item.field.startsAfter',
  due: 'item.field.dueAt',
  hard: 'item.field.hardDueAt',
  priority: 'item.sort.priority',
  title: 'item.sort.title',
}

/**
 * Each priority's word.
 *
 * The row draws it on the pill, and the batch bar's (and the palette's) tier
 * actions read it — every consumer, one table, and a tier the model adds
 * makes this file red and no other.
 */
export const PRIORITY_LABEL: Readonly<Record<ItemPriority, TaskBoardKey>> = {
  low: 'item.priority.low',
  normal: 'item.priority.normal',
  high: 'item.priority.high',
  urgent: 'item.priority.urgent',
}

/**
 * 这一行的⋮菜单里那几枚**动作**的词——「标为待办」而不是「待办」。
 *
 * **五档，与看板那五栏同一套词。** 档数不由清单自己定：只说得清「还没做 / 做完了」两句，
 * 读者就要问**没挂卡的时候为什么只有两档能选**——而一张卡能落在哪几栏，就是这一行能选的
 * 那几档。「受阻」不在这里：它是唯一一个两个面板对不上的词（看板没有这一档）——少掉的是
 * 那个词，不是那一档。
 *
 * **与 `GROUP_LABEL` 分工是词形，不是场合**：菜单项站在动作**之前**，所以说「标为…」；属性
 * 表站在动作**之后**，所以只说「这一行现在是什么」（`GROUP_LABEL`）。挂着一张卡的行也按
 * 这条菜单写——`applyItemStatus` 一处把这一行与那张卡一起写（人能给的只有三档，另两档由
 * 执行器给）。
 */
export const STATUS_LABEL: Readonly<Record<ItemStatus, TaskBoardKey>> = {
  backlog: 'item.status.backlog',
  todo: 'item.status.todo',
  running: 'item.status.running',
  review: 'item.status.review',
  done: 'item.status.done',
}

/**
 * 三个日期各自的**字段名键**，一处定义两处读（行尾的读法与快记那一句「已经写过了」）：
 * 一个概念一套词，而抄一份的代价是改一处不报错。
 */
export const DATE_FIELD_KEY = {
  startsAfter: 'item.field.startsAfter',
  dueAt: 'item.field.dueAt',
  hardDueAt: 'item.field.hardDueAt',
} as const satisfies Readonly<Record<ItemDateKey, TaskBoardKey>>

/**
 * 每个日期框里那行**占位**的键：它教的是**拼写**（这个框认哪几种写法，包括 `@` 那一种）。
 *
 * 三份键住在这里而不是某一张纸里：它说的是字段自己认什么，而**两个表面都在写同一个字段**
 * ——详情那一栏点开是它，新建那张纸的三个框也是它。抄到其中一处，另一处就会先过期。
 */
export const DATE_HINT_KEY = {
  startsAfter: 'item.field.startsHint',
  dueAt: 'item.field.dueHint',
  hardDueAt: 'item.field.hardDueHint',
} as const satisfies Readonly<Record<ItemDateKey, TaskBoardKey>>

/**
 * The five columns a row can READ as, and the word for each — **the board's own words**.
 *
 * 它**不是**一张自己的词表：`STATUS_KEY`（`board/status.ts`）是看板那一份、按 `TaskStatus`
 * 闭合的表，这里直接引用它。于是「进行中」在清单与看板上是同一个词、同一份定义——
 * 加一栏或改一个词只动看板那一处，而清单这边因为类型是同一个联合，**编译期**就会跟着
 * 变。
 */
export const GROUP_LABEL: Readonly<Record<ItemStatusView, TaskBoardKey>> = STATUS_KEY

/** The agenda's buckets and the word for each. */
export const BUCKET_LABEL: Readonly<Record<ScheduleBucketId, TaskBoardKey>> = {
  hardOverdue: 'item.bucket.hardOverdue',
  behind: 'item.bucket.behind',
  today: 'item.bucket.today',
  tomorrow: 'item.bucket.tomorrow',
  week: 'item.bucket.week',
  later: 'item.bucket.later',
  undated: 'item.bucket.undated',
  gated: 'item.bucket.gated',
}

/**
 * 每一节的**那句解释**（没有就不给），闭合成 `ScheduleBucketId`。
 *
 * **它是一张穷尽的表，不是一个问句。** 排期页原来在渲染处写了一个三元
 * （`gated ? … : undated ? … : undefined`），于是**加一个桶不会有人想起要写解释**，而少一句解释
 * 在屏幕上表现为「这一节没有 ⓘ」——一处不存在的东西不会有人报缺陷。表穷尽之后，加一个桶而
 * 不写解释是**编译错误**，就像 `BUCKET_LABEL` 与 `MARK_OF_BUCKET` 一样。
 *
 * **按天的那四节显式写 `undefined`**：它们的名字就是那一天，问「这一节为什么在这里」的人
 * 要的答案是日期本身。`undefined` 写出来而不是省掉，是因为这张表要回答的正是
 * 「这一节有没有话说」——省掉的那一行与「想过之后决定不说」在源码里长得一模一样。
 */
export const BUCKET_EXPLAIN: Readonly<Record<ScheduleBucketId, TaskBoardKey | undefined>> = {
  hardOverdue: 'item.bucket.hardOverdueWhy',
  behind: 'item.bucket.behindWhy',
  today: undefined,
  tomorrow: undefined,
  week: undefined,
  later: undefined,
  undated: 'item.noDate.hint',
  gated: 'item.gated.hint',
}

/**
 * **每一枚 flag 自己的词**，闭合成 `ItemFlag`——`has:` 芯片与左栏那一组都读这一份。
 *
 * 一枚筛子要的是**这一枚筛子叫什么**，所以这张表不许折：每一枚自己那一格写自己的词，
 * 加一枚新 flag 就编译不过。左栏的行也读它（同一个筛子在两处必须同一个词——硬性规范 17）。
 */
export const FLAG_LABEL: Readonly<Record<ItemFlag, TaskBoardKey>> = {
  overdue: 'item.rail.overdue',
  ahead: 'item.rail.ahead',
  undated: 'item.rail.undated',
  stale: 'item.rail.stale',
  hardOverdue: 'item.due.overdueShort',
  behind: 'item.triage.behindShort',
  gated: 'item.bucket.gated',
  linked: 'item.flag.linked',
  done: STATUS_KEY.done,
}
