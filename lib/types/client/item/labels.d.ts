/**
 * 清单自己要写的词，一处定义——**这里放的是清单自己的闭合表**。
 *
 * WHY ONE FILE. 抄一份的代价不是那几行，是**改一处不报错**：读者要求「颜色全站同步」
 * 时，其中一处不会跟着变，而屏上不会有人说一句话。所以**页面里的词表若与它同族，就搬
 * 进来**——页面文件里不留第二份，一个概念一套词。
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
 * **一处例外：{@link WHY_WORDS} 不是闭合表**，因为它的键是**宿主给的错误码**，而宿主
 * 随时可能多发一个。它住在这一处，是因为它仍然是**清单自己写的词**——不是因为它是
 * 闭合的。
 *
 * WHAT IS DELIBERATELY NOT HERE: any judgment. A table maps a value the model
 * already decided to a word for it. Which rows match a filter, which page a row
 * is on and what a date means are all `core/item-view.ts`, read by this surface
 * and by `taskboard_query` alike.
 */
import type { ItemPriority, ItemRecord, ItemStatus } from '../../core/item.ts';
import type { ItemFlag, ItemPageId, ItemRailGroupWord, ItemRailKey, ItemSort, ItemStatusView, ScheduleBucketId } from '../../core/item-view.ts';
import type { TaskBoardKey } from '../locales.ts';
import type { ItemDayBucket } from './day-groups.ts';
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
export declare const STATUS_LABEL: Readonly<Record<ItemStatus, TaskBoardKey>>;
/**
 * 三个日期各自的**字段名键**，一处定义两处读（行尾的读法与快记那一句「已经写过了」）：
 * 一个概念一套词，而抄一份的代价是改一处不报错。
 */
export declare const DATE_FIELD_KEY: {
    readonly startsAfter: "item.field.startsAfter";
    readonly dueAt: "item.field.dueAt";
    readonly hardDueAt: "item.field.hardDueAt";
};
/**
 * 每个日期框里那行**占位**的键：它教的是**拼写**（这个框认哪几种写法，包括 `@` 那一种）。
 *
 * 三份键住在这里而不是某一张纸里：它说的是字段自己认什么，而**两个表面都在写同一个字段**
 * ——详情那一栏点开是它，新建那张纸的三个框也是它。抄到其中一处，另一处就会先过期。
 */
export declare const DATE_HINT_KEY: {
    readonly startsAfter: "item.field.startsHint";
    readonly dueAt: "item.field.dueHint";
    readonly hardDueAt: "item.field.hardDueHint";
};
/**
 * The five columns a row can READ as, and the word for each — **the board's own words**.
 *
 * 它**不是**一张自己的词表：`STATUS_KEY`（`board/status.ts`）是看板那一份、按 `TaskStatus`
 * 闭合的表，这里直接引用它。于是「进行中」在清单与看板上是同一个词、同一份定义——
 * 加一栏或改一个词只动看板那一处，而清单这边因为类型是同一个联合，**编译期**就会跟着
 * 变。
 */
export declare const GROUP_LABEL: Readonly<Record<ItemStatusView, TaskBoardKey>>;
/** The agenda's buckets and the word for each. */
export declare const BUCKET_LABEL: Readonly<Record<ScheduleBucketId, TaskBoardKey>>;
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
export declare const BUCKET_EXPLAIN: Readonly<Record<ScheduleBucketId, TaskBoardKey | undefined>>;
/**
 * **每一枚 flag 自己的词**，闭合成 `ItemFlag`——`has:` 芯片与左栏那一组都读这一份。
 *
 * 一枚筛子要的是**这一枚筛子叫什么**，所以这张表不许折：每一枚自己那一格写自己的词，
 * 加一枚新 flag 就编译不过。左栏的行也读它（同一个筛子在两处必须同一个词——硬性规范 17）。
 */
export declare const FLAG_LABEL: Readonly<Record<ItemFlag, TaskBoardKey>>;
/**
 * 两个页面的名字，闭合成 `ItemPageId`。
 *
 * 加一个页面就编译不过——而这一张表以前住在面板文件里，于是**页面的名字与页面的实现**
 * 住在同一个文件，读者问「这一页叫什么」时要翻两处。
 */
export declare const PAGE_LABEL: Readonly<Record<ItemPageId, 'item.page.list' | 'item.page.schedule'>>;
/**
 * 左栏那些行的词，闭合成 `ItemRailKey`。
 *
 * **四档优先级与五栏状态是别处那一份**，不是这里的第二张表：`PRIORITY_LABEL` 是四档的词，
 * `STATUS_KEY` 是看板那五栏的词。同一枚筛子在两个面板上必须是同一个词，而一张抄过来的
 * 表会在下一次改词时留下一个角落。
 *
 * **那两组的键也是从那两张表里摊开的，不是逐个写下来的**（`...PRIORITY_LABEL` /
 * `...STATUS_KEY`）：键集跟着它们走——看板加一栏状态，`STATUS_KEY` 认得它，这张表也就带着它，
 * 不必在这里再抄一遍五个键；而这里少一个键仍然是**编译错误**，不是屏上少一个词。
 */
export declare const WORD: Readonly<Record<ItemRailKey, TaskBoardKey>>;
/**
 * 左栏那几组的小标题，闭合成 `ItemRailGroupWord`。
 *
 * **没有 `??` 兜底，而且这正是重点**：用 `?? 'item.rail.all'` 读，这张表会给一个它不认识的
 * 键印出「全部」——就在那一行自己的真数旁边，而那是这一面上读者唯一核对不了的一个数。
 * 所以键集闭合成核心能真正产出的那些，新加一枚筛子是一次 `tsc` 错误。
 */
export declare const CAPTION: Readonly<Record<ItemRailGroupWord, TaskBoardKey>>;
/**
 * 日分段那四节的词，闭合成 `ItemDayBucket`。
 *
 * 「今天 / 昨天 / 前天 / 更早」是相对的说法，而绝对日期在左栏的日历里，也在每一行自己的
 * 日期读数上——同一批日子，两种读法，各有各的位置。
 */
export declare const DAY_WORD: Readonly<Record<ItemDayBucket, TaskBoardKey>>;
/**
 * 这一条**从哪里来**：人写的、模型写的、还是导入的。
 *
 * 闭合成 `ItemRecord['origin']['source']`——模型多一个来源，这张表就编译不过。
 */
export declare const ORIGIN_LABEL: Readonly<Record<ItemRecord['origin']['source'], 'item.origin.human' | 'item.origin.ai' | 'item.origin.import'>>;
/**
 * 「问 AI」被拒的四种理由，以及每一句该说的话。
 *
 * 闭合成这四个码——多一种拒法就编译不过，于是**读者听到的永远是这一句**，而不是一个
 * 从码里拼出来的句子。
 */
export declare const ASK_WHY_LABEL: Readonly<Record<'unknownTask' | 'empty' | 'busy' | 'unavailable', TaskBoardKey>>;
/**
 * 宿主可能发来的每一个拒绝码，以及读者被告知的那句话。
 *
 * **它不是闭合表**，而这一处的其余每一张都是：键是**宿主的码**，宿主随时可能多发一个，
 * 而这张表要回答的是「读者被告知什么」，不是「宿主一共能发几种」。多一个码不会让编译器
 * 说一句话——读到的是那句「我不知道为什么」（见 `why-label.ts`）。
 *
 * 它住在这一处，是因为它仍然是**清单自己写的词**：别处的表是「某个值叫什么」，这一张是
 * 「一个码对应哪一句话」，而两处都要保证同一个码在两个面板上说的是同一句话。
 */
export declare const WHY_WORDS: Readonly<Record<string, TaskBoardKey>>;
