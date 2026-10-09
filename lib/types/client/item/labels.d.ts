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
import type { ItemPriority, ItemStatus } from '../../core/item.ts';
import type { ItemFlag, ItemSort, ItemStatusView, ScheduleBucketId } from '../../core/item-view.ts';
import type { TaskBoardKey } from '../locales.ts';
/**
 * The seven — now six — orders, and the word for each.
 *
 * This table is the reason the filter bar has never had to be told what an
 * order is called. It was written out longhand once, in the bar itself, and the
 * first time the model dropped a tier `tsc` named this line and nothing else —
 * which is the entire reason a closed `Record` is worth more than a `switch`.
 */
export declare const SORT_LABEL: Readonly<Record<ItemSort, TaskBoardKey>>;
/**
 * Each priority's word.
 *
 * The row draws it on the pill, and the batch bar's (and the palette's) tier
 * actions read it — every consumer, one table, and a tier the model adds
 * makes this file red and no other.
 */
export declare const PRIORITY_LABEL: Readonly<Record<ItemPriority, TaskBoardKey>>;
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
export declare const STATUS_LABEL: Readonly<Record<ItemStatus, TaskBoardKey>>;
/**
 * The triage lines' SHORT words, for the one-line form.
 *
 * A separate table rather than a truncation of the long sentences, because the
 * long ones are sentences with a consequence — 「1 项过了想要的日子」 tells a reader
 * what HAPPENED, and 「落后」 alone is a label with no claim. On the one line there
 * is no room for the sentence, so the short form is deliberately a LABEL: it
 * names the line and its count, and it writes the same filter the long sentence
 * wrote, through the same writer.
 */
export declare const TRIAGE_SHORT: Readonly<Record<ItemFlag, TaskBoardKey>>;
/**
 * The five columns a row can READ as, and the word for each — **the board's own words**.
 *
 * 它不再是一张自己的词表：`STATUS_KEY`（`board/status.ts`）是看板那一份、按 `TaskStatus`
 * 闭合的表，这里直接引用它。于是「进行中」在清单与看板上是同一个词、同一份定义——
 * 加一栏或改一个词只动看板那一处，而清单这边因为类型是同一个联合，**编译期**就会跟着
 * 变。
 */
export declare const GROUP_LABEL: Readonly<Record<ItemStatusView, TaskBoardKey>>;
/** The agenda's buckets and the word for each. */
export declare const BUCKET_LABEL: Readonly<Record<ScheduleBucketId, TaskBoardKey>>;
/**
 * The triage sentences, and the word for each line.
 *
 * Three flags share a word with a line that has no entry of its own, and that
 * is a deliberate collapse rather than a missing key: `triageLinesOf` emits four
 * ids, and a table keyed over the whole flag set still has to say something
 * about the rest. The right something is the nearest honest line, not a blank —
 * and now that the table is closed, saying it is a choice the compiler asks for
 * instead of a `?? 'item.triage.undated'` that used to be reached by no code
 * path at all and would have rendered a date sentence for a flag that is not
 * about dates.
 */
export declare const TRIAGE_LABEL: Readonly<Record<ItemFlag, TaskBoardKey>>;
/**
 * **每一枚 flag 自己的词**，闭合成 `ItemFlag`——`has:` 芯片与左栏那一组都读这一份。
 *
 * 它是 `TRIAGE_SHORT`/`TRIAGE_LABEL` 的第三代：那两张表是**三要处理那一条线**用的（一行一句
 * 话），所以它们把 `linked`/`done` 这类「不是日期问题的 flag」都折到最近的日期句子上——那对
 * 一条句子是对的，对**一枚芯片**就是错的（「挂了卡」被印成「没日期」）。
 *
 * 芯片要的是**这一枚筛子叫什么**，所以这张表不许折：每一枚自己那一格写自己的词，加一枚新 flag
 * 就编译不过。左栏的行也读它（同一个筛子在两处必须同一个词——硬性规范 17）。
 */
export declare const FLAG_LABEL: Readonly<Record<ItemFlag, TaskBoardKey>>;
