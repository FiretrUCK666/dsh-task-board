/**
 * 卡片与清单之间的一致性：一处挂上另一处之后，两边必须说同一句话。
 *
 * 这个文件回答的是**唯一一类静态检查看不见的问题**：一条清单行与一张看板卡之间有
 * 四条「谁是谁的真相」的约定（状态是谁的、词取哪张表、出生栏跟着谁、链接算不算数），
 * 而它们全部只写在代码与注释里，靠人来记。它们的共同点是：**两个面板之间的一致性，
 * 而任何一边单独看都是对的**。一个面板里读错的字段会被它自己那一处的断言抓住；
 * 跨面板读错的字段不会——清单那一行显示「待办」是自洽的，看板那张卡在「待办」也是
 * 自洽的，而它们说的是两件事。
 *
 * 所以下面每一条都**读推导的结果**（调用纯函数、比较两个表面的输出），不读屏幕上的
 * 字符串；唯一比词的那一条本来就在问词表。四份契约直接对应 `AGENTS.md` 的「关键
 * 不变量」：**卡片是 view-model 的投影**、**唯一推导**、**归档是可恢复的隐藏**，
 * 以及硬性规范 17 的**一个概念一套词汇**。
 *
 * ── 已经被别处钉住的，这里不再钉第二遍 ──────────────────────────────────────
 *
 *  - 「卡没了就不再是一张卡」的四种答案与派生状态的三态：`item-view.spec.ts` 的
 *    「a card that is gone stops being a card」（`linkedCardIdOf` / `derivedStatusOf`）。
 *  - 「卡被拖到另一栏，清单这一行当场跟着换」与「读者自己按下的已完成不被写穿冲掉」：
 *    `item-workbench.spec.ts` 的「一张卡没了，它就不再是一张卡」「挂上卡之后，状态两边
 *    一起变（先复现，再修）」。
 *  - 提升计划的三个字段与两种拒绝（`alreadyLinked` / `noTitle`）、`another` 的含义：
 *    `item-transitions.spec.ts` 的「the promotion plan says what the card would say, once」。
 *  - 「按下去建卡并挂上这一行」「空的卡名写不下任何东西」：`item-workbench.spec.ts` 的
 *    「「新建卡片」 names the card in place, where the picker stands」。
 *  - 归档是一次 host 操作而不是客户端提交、恢复没回来就说没回来、认不出回答不说空：
 *    `items-archive.spec.ts` 的「reading the archive」与「putting one back」两节。
 *  - 「问 AI」送出去的是这一条自己的五个字段、空字段删掉而不是留一个空标题：
 *    `item-ask.spec.ts` 的「一句话里写什么」。
 *  - 模型读一条行时印的三个日期用界面那套词、存的状态与显示的状态不同时两个都说：
 *    `agent-tools.spec.ts` 的「模型读到的词与界面是同一套」。
 *
 * ── 这一轮没核的（硬性规范 15：没查过的要说出来）────────────────────────────
 *
 *  - **拖到日程某一天的那条拖拽接线**没有走一遍真实拖放；下面钉的是它读的那一条推导
 *    （`scheduleBucketOf` 与整个日程桶），落点如何算出那一天没有重跑。
 *  - **归档行的读与恢复**没有重跑（`items-archive.spec.ts` 覆盖着），本文件也不再断言
 *    它一遍——「归档结论不缓存、不落台账」是一条关于组件与文档写路径的性质，
 *    在这里造一条假断言只会让那一页看起来被守着。
 *  - 第 7 条里看板跳过来那枚芯片的**组件实现**没有重跑；本文件只钉纯推导那一份，
 *    并在那条用例里写明它的生产代码读的是哪一处。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { GROUP_LABEL, STATUS_LABEL } from '../src/client/item/labels.ts'
import { applyCommit, emptyBoardDoc } from '../src/core/board-doc.ts'
import { applyItemsCommit, deletedItemsOf, emptyItemsDoc, purgeItemTombstone, type ItemsDoc } from '../src/core/items-doc.ts'
import { ALL_STATUSES, MANUAL_STATUSES, createTask, type TaskRecord, type TaskStatus } from '../src/core/tasks.ts'
import { ITEM_STATUSES, itemStatusOf, type ItemRecord, type ItemStatus } from '../src/core/item.ts'
import { applyItemStatus, mountItemRecord, planItemPromotion } from '../src/core/item-transitions.ts'
import {
  DAY_MS,
  EMPTY_ITEM_QUERY,
  ITEM_STATUS_VIEWS,
  derivedStatusOf,
  itemMatchContextOf,
  linkedCardIdOf,
  linkedCardOf,
  parseItemQuery,
  scheduleBucketOf,
  scheduleBucketsOf,
  startOfDay,
} from '../src/core/item-view.ts'
import { ITEM_FLAG_TESTS, flagProbeOf, itemQualifierVocabulary } from '../src/core/item-query.ts'
import { createTaskboardTools, runBatch, type ToolCommitFace, type ToolDeps } from '../src/host/agent/tools.ts'
import { BoardController } from '../src/core/controller.ts'
import { InMemoryTaskStore } from '../src/core/store.ts'
import { itemContextText } from '../src/core/item-ask.ts'

const NOW = new Date(2026, 9, 12, 9, 0, 0).getTime()

/** 一条行；只有被测的那几个字段在用例里显式写出来。 */
function row(patch: Partial<ItemRecord> = {}): ItemRecord {
  return {
    id: 'i-1',
    ref: 12,
    title: '画廊随访',
    body: '把东墙的灯换掉',
    attachments: [],
    notes: '灯座是旧款',
    steps: [],
    status: 'todo',
    priority: 'normal',
    tags: [],
    startsAfter: undefined,
    dueAt: undefined,
    hardDueAt: undefined,
    taskId: undefined,
    origin: { source: 'human', at: NOW - 3 * DAY_MS },
    createdAt: NOW - 3 * DAY_MS,
    updatedAt: NOW - DAY_MS,
    ...patch,
  }
}

/** 看板的栏，按卡片 id 索引——与面板拿到的那一份形状相同。 */
const cards = (...entries: ReadonlyArray<readonly [string, TaskStatus]>): ReadonlyMap<string, TaskStatus> =>
  new Map(entries.map(([id, status]) => [id, status]))

describe('一条挂了卡的行，它的状态是那张卡在哪一栏', () => {
  it('行自己存的那一档与卡所在的栏不同时，读出来的是卡那一栏；卡换了栏，读数跟着换', () => {
    // 一条行存 `todo`、卡在 `review`：谁赢不是口味问题——清单自己不拥有那五栏里的三栏，
    // 而「一件工作现在在哪儿」是看板的事实。两边的值**故意不同**，因为拿两个相等的值
    // 去证「读的是卡」是证不出来的。
    const hung = row({ status: 'todo', taskId: 'card-1' })
    expect(derivedStatusOf(hung, cards(['card-1', 'review'])), '读的还是这一行自己存的那一档').toBe('review')
    // 同一行、同一个字段，卡一动读数就动：这一步里没有任何东西写过这一行。
    expect(derivedStatusOf(hung, cards(['card-1', 'backlog']))).toBe('backlog')
    // 而这不只是一条规则的第二种说法：没挂卡时读的就是它自己，五档都读得到。
    for (const status of ITEM_STATUSES) {
      expect(derivedStatusOf(row({ status }), cards()), `${status} 没挂卡时读不出来`).toBe(status)
    }
  })

  it('唯一能让这一行压过卡片的是读者自己按下的「已完成」，而且只在这一档上', () => {
    // `itemStatusOf` 那两行的顺序就是这条规则的全文：先看这一行自己的 done，再读卡。
    // 它不是「清单优先」——卡在 `running` 时这一行照样读 `running`，只有 done 是例外。
    expect(derivedStatusOf(row({ status: 'done', taskId: 'card-1' }), cards(['card-1', 'running']))).toBe('done')
    expect(derivedStatusOf(row({ status: 'todo', taskId: 'card-1' }), cards(['card-1', 'running']))).toBe('running')
    // 而「看得见的那张卡」与「这一行站在哪一栏」是同一个答案的两种读法：状态派生的输入
    // 就是字段读法的输出，所以一处说没有卡，另一处就不可能还在按卡读。
    for (const item of [row({ taskId: 'card-1' }), row({ taskId: 'card-gone' }), row()]) {
      const linked = linkedCardIdOf(item, cards(['card-1', 'review']))
      expect(itemStatusOf(item, linked === undefined ? undefined : 'review'), '状态与字段读法分了岔')
        .toBe(derivedStatusOf(item, cards(['card-1', 'review'])))
    }
  })
})

describe('改状态的入口只有一个，而它挂着卡时给的是看板的动词', () => {
  it('挂卡时只有人手能给的档写得进去，另两档拒绝、不留半次写', () => {
    // 「进行中 / 待审核」是执行器的事实，这一条与看板自己那一排是同一个判据
    // （`MANUAL_STATUSES`）——两边各写一份的话，界面按得动的那一档模型不认。
    const rows = [row({ taskId: 'card-1' })]
    const card = { id: 'card-1', status: 'todo' as const }
    for (const executorOnly of ['running', 'review'] as const) {
      const refused = applyItemStatus(rows, 'i-1', executorOnly, card, NOW + 1_000)
      expect(refused.refused, `${executorOnly} 被当成人手写得进去的那一档`).toBe('executorOnly')
      expect(refused.move, '一次被拒的写还是移了卡').toBeUndefined()
      expect(refused.rows[0]?.updatedAt, '一次拒绝盖了一个新的写入戳').toBe(rows[0]?.updatedAt)
    }
    // 人手能给的档：这一行自己写一次，外加移那张卡一次；两处一起写，不是各写各的。
    for (const status of MANUAL_STATUSES) {
      const written = applyItemStatus(rows, 'i-1', status, card, NOW + 1_000)
      expect(written.refused, `${status} 是看板允许人手拖的那一档，却被拒了`).toBeUndefined()
      expect(written.rows[0]?.status).toBe(status)
      expect(written.move).toEqual({ cardId: 'card-1', status })
    }
    // 没挂卡时五档全部写得进去，而一次移卡都没有——「挂没挂卡」是那个唯一的开关。
    for (const status of ITEM_STATUSES) {
      const bare = applyItemStatus([row()], 'i-1', status, undefined, NOW + 1_000)
      expect(bare.rows[0]?.status, `没挂卡时写不进 ${status}`).toBe(status)
      expect(bare.move, '没挂卡却移了一次卡').toBeUndefined()
    }
  })

  it('两张词表都长在看板那五栏上，而选哪一张只由「挂没挂卡」决定', () => {
    // 两个面板说的五个状态必须是同一套（硬性规范 17）：两处都是**导入**，不是抄的。
    expect([...ITEM_STATUSES], '清单自己存的那五档不是看板那五档').toEqual([...ALL_STATUSES])
    expect([...ITEM_STATUS_VIEWS], '能显示的那五个不是看板那五个').toEqual([...ALL_STATUSES])
    // 而词汇确实有**两张**，且两张在同一个人手给的档上说的是两句不同的话：挂着卡时给的是
    // 看板的动词（移那张卡），没挂卡时给的是这一行现在是什么。
    for (const status of MANUAL_STATUSES) {
      expect(GROUP_LABEL[status], `${status} 缺一个看板自己的词`).toBeTruthy()
      expect(STATUS_LABEL[status], `${status} 缺一个清单自己的词`).toBeTruthy()
      expect(GROUP_LABEL[status], `${status} 两处用了同一个词，那就分不出改的是哪一边`).not.toBe(STATUS_LABEL[status])
    }
    // 两张表各有各的唯一出处，而且都是导入：看板那是 `MANUAL_STATUSES`（人手能拖的栏，
    // `task.move` 的目标栏），清单那是 `ITEM_STATUSES`（清单自己的五档）。抄一份的代价
    // 不是那几行，是**改一处不报错**。
    const actions = readFileSync(fileURLToPath(new URL('../src/core/board-actions.ts', import.meta.url)), 'utf8')
    // The catalog reads the board's own module as a namespace (it needs the whole
    // export list for the shared-implementation registry), so the name may be
    // qualified — the invariant is the SOURCE, not the spelling of the import.
    expect(actions, '`task.move` 的目标栏不再取自 `MANUAL_STATUSES`').toMatch(/const MOVABLE[^=]*=\s*(?:taskModel\.)?MANUAL_STATUSES/)
    expect(actions, '清单的五档不再取自 `ITEM_STATUSES`').toMatch(/const ITEM_STATUS_VALUES[^=]*=\s*ITEM_STATUSES/)
  })
})

describe('提升成卡：一个计划，两处调用', () => {
  it('卡的出生栏是这一条自己的状态，不是写死的「待办」', () => {
    // 「先标已完成、再挂卡」曾经产出一对互相矛盾的数据：卡开在待办，而这一行因为自己
    // 那张牌（`itemStatusOf` 的 done 压过卡片）显示「已完成」，屏上没有一句话解释。
    // 出生栏因此由这一条自己决定，而执行器才能给的那两档落到「待办」。
    const planned = (status: ItemStatus): TaskStatus => {
      const plan = planItemPromotion(row({ status }))
      if (plan.kind !== 'ready') throw new Error(`${status} 的一条本该产出一张卡`)
      return plan.task.status
    }
    expect(planned('done'), '一条已完成的行提升出来的卡开在待办').toBe('done')
    expect(planned('backlog')).toBe('backlog')
    expect(planned('running'), '两档执行器的事实被原样带进了出生栏').toBe('todo')
    expect(planned('review')).toBe('todo')
    // 而计划说的那一档真的落得到卡上：`createTask` 认它。两次构造只差这一个字段，
    // 所以「工具那一处写死待办」这条红断言不会是别的原因造成的。
    const said = planItemPromotion(row({ status: 'backlog' }))
    if (said.kind !== 'ready') throw new Error('a backlog row plans a card')
    expect(createTask(said.task, NOW, 't-1').status, '计划里那一档 `createTask` 落不下去').toBe('backlog')
    expect(createTask({ ...said.task, status: 'todo' }, NOW, 't-2').status).toBe('todo')
  })
})

describe('三个日期各有各的字段，日程按截止那一天摆', () => {
  it('同一条行上两个日期落在不同的日子时，日程把它摆在截止的那一天', () => {
    // 计划在明天、截止在四天后。读成计划的那一天，这条行会被摆在它还能改的那一天，
    // 而不是它必须交差的那一天——一本日程最不能犯的错就是这一个。
    const planned = startOfDay(NOW) + DAY_MS
    const deadline = startOfDay(NOW) + 4 * DAY_MS
    const both = row({ dueAt: planned, hardDueAt: deadline })
    expect(scheduleBucketOf(both, NOW), '日程按计划的那一天摆了，而不是截止的那一天').toBe('week')
    // 没有截止时读的才是计划的那一天。两半都要成立，否则这个断言可以靠「永远读截止」
    // 或「永远读计划」蒙过去。
    expect(scheduleBucketOf(row({ dueAt: planned }), NOW)).toBe('tomorrow')
    // 整个日程桶也只按这一条推导摆：换掉日期，它换的就是那一个桶。
    const ctx = { ...itemMatchContextOf(NOW), cards: new Map<string, TaskStatus>() }
    const bucketsOf = (item: ItemRecord): readonly string[] =>
      scheduleBucketsOf([item], EMPTY_ITEM_QUERY, ctx, 'due').filter(bucket => bucket.items.length > 0).map(bucket => bucket.id)
    expect(bucketsOf(both)).toEqual(['week'])
    expect(bucketsOf(row({ dueAt: planned }))).toEqual(['tomorrow'])
  })
})

describe('「挂了卡」只有一处判断', () => {
  it('字段读法与查询的 `has:linked` 在同一批行上给出同一个答案', () => {
    // 三行：挂着一张在场卡的、挂着已删卡的、从没挂过的。行的字段读法
    // （`linkedCardIdOf`）、状态派生背后的那一份、查询的 `has:linked` 都得是同一个答案。
    const board = cards(['card-live', 'review'])
    const probe = (item: ItemRecord): boolean =>
      ITEM_FLAG_TESTS.linked(flagProbeOf(item, itemMatchContextOf(NOW, undefined, board)))
    const live = row({ id: 'live', taskId: 'card-live' })
    const gone = row({ id: 'gone', taskId: 'card-gone' })
    const bare = row({ id: 'bare' })
    expect(linkedCardIdOf(live, board)).toBe('card-live')
    expect(derivedStatusOf(live, board)).toBe('review')
    expect(linkedCardIdOf(gone, board), '卡没了，这里还说它挂着').toBeUndefined()
    expect(derivedStatusOf(gone, board), '卡没了，状态却还在按一张不存在的卡读').toBe(gone.status)
    expect(linkedCardIdOf(bare, board)).toBeUndefined()
    // `has:linked` 问的是**文档里写着没有**（`item.taskId !== undefined`），所以在卡还在场
    // 的那些行上，它与字段读法必须是同一个答案——这正是「筛出来的那几条」与「看得见的
    // 那几条」是同一批的那一半。
    expect(probe(live), '一条挂着在场卡的行没有被 `has:linked` 筛出来').toBe(true)
    expect(probe(bare)).toBe(false)
    for (const item of [live, bare]) {
      expect(probe(item), '`has:linked` 与字段读法在同一批行上分了两个答案').toBe(linkedCardIdOf(item, board) !== undefined)
    }
    // 卡被删之后两者**故意**分开，而那不是两个说法：一个是「文档里有这条链接」，
    // 一个是「这一屏看得见这张卡」。分开的那一行由上一次收口（`item-workbench.spec.ts` 的
    // 「并且文档里那条死链接被清掉」），这里只钉住分岔点落在哪一行上。
    expect(probe(gone), '`has:linked` 不再回答「文档里有没有这条链接」').toBe(true)
    expect(parseItemQuery('has:linked').flags.has('linked')).toBe(true)
  })
})

describe('模型那一侧的写走的是清单自己的语义层', () => {
  it('提升一条待规划的行：计划说的出生栏与工具真的产出的那一栏是同一个', async () => {
    // 界面那一半有它自己的用例（「挂一条「已完成」的行：卡要开在已完成」），而模型这一半
    // 走的是**同一个计划**：`planItemPromotion` 的 `status` 就是「这张卡开在哪一栏」的
    // 唯一答案，工具那一处照它建卡就够，不需要自己判一次。
    const board = face()
    const base: Record<string, unknown> = {
      id: 'i-1', ref: 1, title: '一条', body: '正文', notes: '', steps: [],
      status: 'backlog', priority: 'normal', tags: [], startsAfter: undefined,
      dueAt: undefined, hardDueAt: undefined, taskId: undefined,
      origin: { source: 'human', at: NOW }, createdAt: NOW, updatedAt: NOW,
    }
    board.items = applyItemsCommit(emptyItemsDoc(NOW), { clientId: 'c', items: [base as never], deleted: [] }, NOW)
    const planned = planItemPromotion(board.items.items[0] as ItemRecord)
    if (planned.kind !== 'ready') throw new Error('a titled row plans a card')

    const result = await runBatch(deps(board), { ops: [{ op: 'item.promote', payload: { of: '#1' } }] })
    expect(result.ok).toBe(true)
    const minted = board.getDoc().tasks[0]
    expect(minted?.title).toBe(planned.task.title)
    expect(minted?.status, '模型提升出来的卡没有落在这一条自己的那一栏上').toBe(planned.task.status)
    expect(board.getItemsDoc().items[0]?.taskId, '两个文档没有一起写').toBe(minted?.id)
  })

  it('能力与查询那两个工具是注册出来的，而教出去的状态词就是能显示的那五个', () => {
    // 工具名与词表都按构造取自目录与注册表，所以这一条读的是**工具真的注册了什么**。
    const tools = createTaskboardTools(deps(face()))
    expect(tools.map(tool => tool.name).sort()).toEqual(['taskboard_capabilities', 'taskboard_execute', 'taskboard_query'])
    const vocabulary = itemQualifierVocabulary()
    for (const status of ITEM_STATUS_VIEWS) {
      expect(vocabulary, `教给模型的状态词表里没有 status:${status}`).toContain(`status:${status}`)
    }
  })
})

describe('一条链接、两扇门、两份文档', () => {
  /* 这一组钉的是**模型本身**（`PRODUCT.md` 那八条里能被机器读到的三条），不是某一个面板的
     行为——其余五条已经被别处钉着（见文件头那份「已经被别处钉住的」清单），这里不钉第二遍。 */
  const source = (path: string): string => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8')

  it('两份文档、两个真相：两个文档名，一个单元，一段服务', () => {
    const service = source('src/host/board-service.ts')
    expect(service, '看板那份文档的名字改了').toContain("BOARD_DOCUMENT = 'board'")
    expect(service, '清单那份文档的名字改了').toContain("ITEMS_DOCUMENT = 'items'")
    // 两个名字来自同一个单元声明（加一种数据 = 在表里加一个名字），不是两套服务、两份真相。
    expect(service, '两份文档不再由同一处声明').toContain('BOARD_UNIT_TABLE')
  })

  it('一条链接只有一个方向：行存卡 id，卡不存它的条目', () => {
    // 行那一侧：`taskId` 是模型里唯一指向卡的那一项。
    expect(source('src/core/item.ts'), '那一行不再存它挂着的卡').toContain('taskId: string | undefined')
    /* 卡那一侧：`TaskRecord` 里没有任何一个「条目」字段——反向的「这张卡挂着几条」是**过滤**
       出来的读数。卡上真长出第二份名单的那一天，这一条会红。 */
    const task = createTask({ title: '一张卡', description: '', prompt: '' }, NOW, 'task-1')
    const named = (value: object): string[] => Object.keys(value).filter(key => /item|row|checklist/i.test(key))
    expect(named(task),
      '卡上出现了第二份名单——反向读数必须由装配层拿屏上那批行过滤出来').toEqual([])
    // 咬得动：给同一张卡安上一个「条目名单」，这段读法必须报出来。
    expect(named({ ...task, rows: ['i-1'] }), '卡上多出来的名单被放过了').toEqual(['rows'])
    // 而过滤那一处读的就是行上那个链接：同一批行，一个答案。
    const rows = [row({ id: 'a', taskId: 'task-1' }), row({ id: 'b', taskId: 'task-2' }), row({ id: 'c' })]
    const board = cards(['task-1', 'todo'], ['task-2', 'todo'])
    expect(rows.filter(one => linkedCardIdOf(one, board) === 'task-1').map(one => one.id),
      '「这张卡挂着哪几条」不是从行上那个链接过滤出来的').toEqual(['a'])
  })

  it('一边删掉，另一边不跟着消失：卡没了，那一行还在，只是不再挂着卡', () => {
    const hanging = row({ taskId: 'task-1' })
    expect(linkedCardIdOf(hanging, cards(['task-1', 'review'])), '卡在，链接却不算数').toBe('task-1')
    expect(linkedCardIdOf(hanging, cards()), '卡没了，这一行却还挂着一张不存在的卡').toBeUndefined()
    /* 行自己带着它的内容：删卡不动它一个字——行是**这件事**（内容、日期、标签都在它身上），
       卡是**做它的一次安排**（在哪一栏、谁在做、跑到哪一步）。 */
    expect(hanging.title).toBe('画廊随访')
    expect(hanging.body).toBe('把东墙的灯换掉')
  })
})

/**
 * 一个不执行任何东西的执行面——它只需要**存在**。
 *
 * 这一组要读的是控制器**记下**的那句话与**落下**的那张卡，不是它跑出来的效果；所以这个面
 * 把两个执行入口都答成「什么都没做」，而控制器仍然照常把它该记的记下来（硬性规范 18：
 * 假面比现实窄，和比现实宽容同样危险——窄到没有那个方法，实现就会在测试里抛错）。
 */
const idleExec = {
  run: async () => {},
  commentRun: async () => {},
  reconcile: () => undefined,
} as never

/**
 * ── 模型与界面：同一件事，同一个答案 ────────────────────────────────────────
 *
 * 这一组钉的是**两侧真的给出同一个答案**，而两侧各自都绿。四条断言各钉一处：
 *
 *  1. **改状态**：同一个状态、同一张卡，界面与模型给同一个判决。
 *  2. **移栏**：模型挪出来的顺序，与人拖出来的顺序逐项相同。
 *  3. **挂卡**：模型挂出来的那一行，与界面挂出来的那一行，屏上读到的字段逐项相同。
 *  4. **问 AI**：同一行，界面送出去的话与模型送出去的话逐字相同。
 *
 * ── 这四条怎么保证「真的是同一个判定」 ──────────────────────────────────────
 *
 * **不是两份各自断言。** 每一处的界面那一侧都是**真的那一段代码**：
 *
 *  - 改状态：界面那一侧是共享的那道门本身（`applyItemStatus`），而**面板真的调它**由
 *    下面那条源码断言钉住（先剥注释再匹配，只认调用不认字样）。所以「界面的判决」不是
 *    测试里重写一遍的副本，而是界面正在用的那一个函数——两边调用的是同一个函数，
 *    同一个输入只能有同一个输出。
 *  - 移栏：界面那一侧是**真的控制器**（`BoardController.moveTask`）——拖动与键盘移动
 *    走的就是它，而它走的是 `applyCardOrder`（位置）与 `moveTaskToStatus`（内容）。
 *  - 挂卡：界面那一侧是**真的面板**（`mountPanel` 挂起来、真的按那一枚「挂到哪张卡」）。
 *  - 问 AI：界面那一侧是**真的控制器**（`askCard` 把这句话送进那张卡的对话里），而那句话
 *    由共享的那一个写手（`itemContextText`）写出。
 *
 * 断言比的是**两侧的结果**，不是各自的期望值——所以哪一侧改了实现而另一侧没改，这一组
 * 立刻红。
 */
describe('模型与界面：同一件事，同一个答案', () => {
  /* ── ① 改状态 ────────────────────────────────────────────────────────────── */

  /** 一张卡，带着它此刻的样子（哪一栏、上面有没有在飞的一轮 / 排队的一条评论）。 */
  const boardCard = (patch: Partial<TaskRecord> = {}): TaskRecord => ({
    ...createTask({ title: '挂着的那张卡', description: '', prompt: 'p' }, NOW, 'card-1'),
    ...patch,
  })

  const liveRound = { id: 'e-1', sessionId: 's-1', startedAt: NOW, endedAt: undefined, result: undefined, error: undefined }
  const queuedComment = {
    id: 'e-2', sessionId: 's-1', startedAt: NOW,
    comment: { content: [{ type: 'text', text: '还有一句没注入' }] },
    injectedAt: undefined, endedAt: undefined, result: undefined, error: undefined,
  }

  /**
   * 三种卡，外加两个把两种门分开的那两种。
   *
   * 前三种是题面点名的（**有正在跑的会话 / 有评论要处理 / 两样都没有**）；后两种是**把两
   * 道门分开**的：卡停在「进行中」而没有轮次在飞（只有列在管它），以及卡在「待办」而有一轮
   * 在飞（只有轮次在管它）。没有后两种，两种门给出同一个答案的场合就钉不住。
   */
  const kinds: ReadonlyArray<readonly [string, TaskRecord]> = [
    ['有正在跑的会话', boardCard({ status: 'running', executions: [liveRound] as never })],
    ['有评论要处理', boardCard({ status: 'running', executions: [queuedComment] as never })],
    ['两样都没有', boardCard({ status: 'todo', executions: [] })],
    ['卡停在进行中，而这一轮已经不在飞', boardCard({ status: 'running', executions: [] })],
    ['卡在待办，而这一轮还在飞', boardCard({ status: 'todo', executions: [liveRound] as never })],
  ]

  /** 界面那一侧的回答：共享的那道门（面板与模型调的是同一个函数）。 */
  const interfaceVerdict = (card: TaskRecord, status: TaskStatus): boolean => {
    const write = applyItemStatus([row({ taskId: card.id })], 'i-1', status, linkedCardOf(row({ taskId: card.id }), cards([card.id, card.status])), NOW)
    return write.refused === undefined
  }

  /** 模型那一侧的回答：真的工具跑一遍。 */
  const modelVerdict = async (card: TaskRecord, status: TaskStatus): Promise<boolean> => {
    const board = face()
    board.doc = { ...emptyBoardDoc(NOW), tasks: [card] }
    board.items = applyItemsCommit(emptyItemsDoc(NOW), { clientId: 'c', items: [row({ taskId: card.id })] as never, deleted: [] }, NOW)
    const result = await runBatch(deps(board), { ops: [{ op: 'item.update', payload: { of: '#12', status } }] })
    return result.ok
  }

  it('改状态：同一个状态、同一张卡，界面与模型给同一个判决——五种卡逐一比', async () => {
    for (const [label, card] of kinds) {
      expect(await modelVerdict(card, 'done'),
        `模型与界面在「${label}」这张卡上给了不同的判决`).toBe(interfaceVerdict(card, 'done'))
    }
    // 而这不是「两边都放行」那种空洞的一致：至少两种卡上两边都拒，而那正是两种门分开的地方。
    expect(interfaceVerdict(kinds[0]![1], 'done'), '一张在跑的卡被人手工改了栏').toBe(false)
    expect(interfaceVerdict(kinds[3]![1], 'done'), '一张停在进行中的卡没有被挡住').toBe(false)
    expect(interfaceVerdict(kinds[2]![1], 'done'), '一张普通的卡不该被挡').toBe(true)
  })

  it('面板真的走的是共享的那道门——所以「界面的判决」不是测试里重写的一份', () => {
    // 上面那条比较里的「界面那一侧」是共享的 `applyItemStatus`；这一条钉住**面板真的调
    // 它**（且是带着「挂着的卡与它在哪一栏」调它）。剥掉注释再匹配，只认调用不认字样。
    const source = readFileSync(fileURLToPath(new URL('../src/client/item/panel.tsx', import.meta.url)), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    const body = source.slice(source.indexOf('const writeStatus'), source.indexOf('const writeStatus') + 2_000)
    expect(body, '面板改状态不再走共享的那道门').toContain('applyItemStatus(')
    expect(body, '面板不再按「挂着的卡与它在哪一栏」读那张卡').toContain('linkedCardOf(')
  })

  /* ── ② 移栏 ──────────────────────────────────────────────────────────────── */

  it('模型移栏之后，顺序与界面拖动之后逐项相同', async () => {
    // 界面的拖动走**真的控制器**：`controller.moveTask` 是拖放与键盘移动共同的那扇门，
    // 它落位走 `applyCardOrder`（位置）与 `moveTaskToStatus`（内容）。模型那一侧走的是
    // 同一对共享函数，所以两边的名次逐项相同——名次就是屏上的顺序。
    const start: TaskRecord[] = [
      { ...boardCard({ id: 't-a', title: 'A', status: 'todo', order: 0 }) },
      { ...boardCard({ id: 't-b', title: 'B', status: 'todo', order: 1 }) },
      { ...boardCard({ id: 't-c', title: 'C', status: 'done', order: 0 }) },
    ]
    const ui = new BoardController({
      store: (() => { const store = new InMemoryTaskStore(); store.save(start); return store })(),
      exec: idleExec,
      sessions: { list: { getSnapshot: () => ({ byId: {} }), subscribe: () => () => {} }, exists: () => false },
      now: () => NOW,
      uuid: () => 'id-ui',
    })
    ui.start()
    ui.moveTask('t-a', 'done')
    const uiOrder = ui.getSnapshot().tasks.map(task => `${task.id}:${task.status}:${task.order}`)

    const board = face()
    board.doc = { ...emptyBoardDoc(NOW), tasks: start }
    await runBatch(deps(board), { ops: [{ op: 'task.move', payload: { of: 't-a', status: 'done' } }] })
    const modelOrder = board.getDoc().tasks.map(task => `${task.id}:${task.status}:${task.order}`)

    expect(modelOrder, '模型挪出来的顺序与界面拖出来的不一样').toEqual(uiOrder)
  })

  /* ── ③ 挂卡 ──────────────────────────────────────────────────────────────── */

  it('模型挂出来的卡与界面挂出来的卡，屏上读到的字段逐项相同', async () => {
    // 界面那一侧：**挂载那一个落点**（`mountItemRecord`）——而下面那条源码断言钉住面板真的
    // 调它（面板的「挂到哪张卡」那一枚）。模型那一侧调的是同一个函数，所以两边得到的是
    // **同一行**，而不是两份各写各的账。
    const card = boardCard({ id: 'task-1', status: 'review' })
    const before = row({ status: 'backlog' })
    const interfaceRow = mountItemRecord([before], 'i-1', 'task-1', 'review', NOW)[0]

    const board = face()
    board.doc = { ...emptyBoardDoc(NOW), tasks: [card] }
    board.items = applyItemsCommit(emptyItemsDoc(NOW), { clientId: 'c', items: [before] as never, deleted: [] }, NOW)
    await runBatch(deps(board), { ops: [{ op: 'item.update', payload: { of: '#12', taskId: 'task-1' } }] })
    const modelRow = board.getItemsDoc().items[0]

    expect(modelRow?.taskId, '模型挂上去的那张卡与界面挂上去的不是同一张').toBe(interfaceRow?.taskId)
    expect(modelRow?.status, '模型挂上去之后这一行自己那一档没有跟着那张卡').toBe(interfaceRow?.status)
    // 屏上读到的字段逐项相同（写入戳是两份文档各自的时间，不在屏上）。
    for (const key of ['title', 'body', 'notes', 'priority', 'taskId'] as const) {
      expect(modelRow?.[key], `挂好之后「${key}」两边不一样`).toBe(interfaceRow?.[key])
    }
    expect(modelRow?.tags, '挂好之后标签两边不一样').toEqual(interfaceRow?.tags)
    expect(modelRow?.steps, '挂好之后步骤两边不一样').toEqual(interfaceRow?.steps)
    // 而「屏上读到的那一档」由推导回答（挂卡读卡）——两边同一行，屏上自然同一档。
    const boardColumns = cards(['task-1', 'review'])
    expect(derivedStatusOf(modelRow as ItemRecord, boardColumns), '屏上读到的那一档两边不一样')
      .toBe(derivedStatusOf(interfaceRow as ItemRecord, boardColumns))
  })

  it('面板挂卡走的是挂载那一个落点——所以「界面的挂卡」不是测试里重写的一份', () => {
    const source = readFileSync(fileURLToPath(new URL('../src/client/item/panel.tsx', import.meta.url)), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    const body = source.slice(source.indexOf('onEdit={(patch'), source.indexOf('onEdit={(patch') + 2_000)
    expect(body, '面板挂卡不再走挂载那一个落点').toContain('mountItemRecord(')
  })

  /* ── ④ 问 AI ─────────────────────────────────────────────────────────────── */

  it('同一行，界面看到的上下文与模型看到的上下文逐字相同', async () => {
    const one = row({ taskId: 'card-1', title: '量一遍地板', body: '在真机上量', notes: '备注', tags: ['画廊'] })
    // 界面那一侧：**真的控制器**把这句话送进那张卡的对话里，而那句话由共享的那一个写手
    // （`itemContextText`）写出——所以读到的是「送出去的那句话」，不是「我们以为送出去的」。
    const store = new InMemoryTaskStore()
    store.save([{ ...boardCard({ id: 'card-1', binds: [{ kind: 'session', sessionId: 's-1' }] }) }])
    const ui = new BoardController({
      store,
      exec: idleExec,
      sessions: {
        list: { getSnapshot: () => ({ byId: { 's-1': { running: false } } }), subscribe: () => () => {} },
        exists: () => true,
      },
      now: () => NOW,
      uuid: () => 'id-ui',
    })
    ui.start()
    await ui.askCard('card-1', itemContextText(one))
    const said = ui.getSnapshot().tasks[0]?.executions[0]

    // 模型那一侧：真的工具跑一遍，它送出去的那句话就是回执里那一句。
    const board = face()
    const relayed: string[] = []
    board.submitCommand = (command) => {
      relayed.push(command.type === 'comment' ? command.text : command.type === 'run' ? String(command.kickoff ?? '') : '')
      return { queued: false }
    }
    board.doc = { ...emptyBoardDoc(NOW), tasks: [boardCard({ id: 'card-1', binds: [{ kind: 'session', sessionId: 's-1' }] })] }
    board.items = applyItemsCommit(emptyItemsDoc(NOW), { clientId: 'c', items: [one] as never, deleted: [] }, NOW)
    await runBatch(deps(board), { ops: [{ op: 'item.ask', payload: { of: '#12' } }] })

    expect(relayed[0], '模型没有送出去任何一句话').toBeDefined()
    expect(relayed[0], '模型送出去的话与界面送出去的不是同一句').toBe(said?.comment)
  })
})

/** 一份按真实合并文法读写的文档面，形状与 `agent-tools.spec.ts` 的假面相同。
 *
 *  `purgeItem` 也走**真的** `purgeItemTombstone`：这一档是那条纪律（假面必须和宿主
 *  一样严）在这里的落地——一个交回空结果的假面会让整份 suite 在真实删除全线坏掉时
 *  依然全绿。本文件用不到它，但一个缺件的面不是假面，是一个会撒谎的面。 */
interface Face extends ToolCommitFace {
  doc: ReturnType<typeof emptyBoardDoc>
  items: ItemsDoc
  writes: string[]
}

function face(): Face {
  const box: Face = {
    doc: emptyBoardDoc(NOW),
    items: emptyItemsDoc(NOW),
    writes: [],
    available: true,
    getDoc: () => box.doc,
    getItemsDoc: () => box.items,
    async commit(commit) {
      box.writes.push('board')
      box.doc = applyCommit(box.doc, commit, NOW + 1)
      return box.doc
    },
    async commitItems(commit) {
      box.writes.push('items')
      box.items = applyItemsCommit(box.items, commit, NOW + 1)
      return box.items
    },
    async purgeItem(of) {
      const id = of.kind === 'id' ? of.id : deletedItemsOf(box.items).find(item => item.ref === of.ref)?.id
      if (id === undefined) return { kind: 'alreadyGone', doc: box.items }
      const outcome = purgeItemTombstone(box.items, id)
      if (outcome.doc !== box.items) box.items = outcome.doc
      return outcome
    },
    submitCommand: () => ({ queued: false }),
  }
  return box
}

function deps(board: ToolCommitFace): ToolDeps {
  return {
    board: () => board,
    posture: async () => ({
      sessionId: 's', running: { value: false }, archived: { value: false },
      awaitingApproval: { value: false }, awaitingAnswer: { value: false },
    }),
    sources: { agents: () => ({ get: () => undefined }) },
    now: () => NOW,
    uuid: () => 'id-minted',
  }
}
