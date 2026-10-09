/**
 * Every vocabulary the list names, in one place, as CLOSED tables.
 *
 * WHY ONE FILE. Four files used to declare the same handful of words: the row
 * and the detail pane each had a `PRIORITY_LABEL`, the row's `MARK_LABEL` and
 * the detail's `STATUS_LABEL` were the same three keys under two names, the
 * batch bar and the page props each had a priority table, and the overview
 * strip had a `TILE_ORDER` that was a second copy of the model's own status
 * order. That is eight answers to four questions, and the failure mode is not a
 * compile error — it is a word that quietly drifts, or renders `undefined`,
 * while the panel goes on looking finished.
 *
 * The rule that makes it safe is CLOSEDNESS, and it is the whole point of the
 * type: `Readonly<Record<ItemPriority, TaskBoardKey>>` cannot be satisfied by a
 * table that is missing a tier, so the day the model grows one, `tsc` names
 * this file and nothing else. A `Record<string, …>` satisfies nothing — it
 * accepts every key and guarantees none — which is why the old tables that
 * needed a `?? 'fallback'` were not merely untidy: the fallback was there
 * precisely because the table could not be trusted to be complete, and it
 * rendered a word that was true of no flag at all.
 *
 * WHAT IS DELIBERATELY NOT HERE: any judgment. A table maps a value the model
 * already decided to a word for it. Which rows match a filter, which page a row
 * is on and what a date means are all `core/item-view.ts`, read by this surface
 * and by `taskboard_query` alike.
 */
import type { ItemPriority, ItemStatus } from '../../core/item.ts'
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
  /* 三个日期档读**字段自己那一份词**：排序菜单里写「不晚于」而字段叫别的名字，
   *  就是同一件事有两个说法——而两个说法里总有一个会先过期。 */
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
 * The three marks a reader can PUT a row into, and each one's word.
 *
 * **两个值了，不是三个**：清单自己能写的只有「还没做 / 做完了」，第三档（受阻）跟着
 * 那一整套词汇一起删掉了（读者的话：「受阻肯定不能有了」——而它本来就是这套词里唯一
 * 一个看板没有的词）。
 *
 * 挂着一张卡的行**不从这里写**：那时读者改的是那张卡在哪一栏（`task.move`），界面
 * 给的是看板自己的动词（`status.move.*`）。所以这张表是「这一行没有卡的时候」的词表。
 */
export const STATUS_LABEL: Readonly<Record<ItemStatus, TaskBoardKey>> = {
  todo: 'item.status.todo',
  done: 'item.status.done',
}

/**
 * The five columns a row can READ as, and the word for each — **the board's own words**.
 *
 * 它不再是一张自己的词表：`STATUS_KEY`（`board/status.ts`）是看板那一份、按 `TaskStatus`
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
