/**
 * The detail: the row's own expanded body, rendered in the row on BOTH bands.
 *
 * There is no separate side pane any more and no third level — the two levels
 * this panel has are the row and the row opened. The panel renders this
 * component inside the expanded row (wide and narrow alike; only the columns'
 * layout differs, and the field grid answers to its own container
 * `dsh-tb-item-detail` rather than to the panel, so one answer serves both).
 *
 * It is never a dialog. `boardBox()` resolves to the FIRST board box, so a
 * layer opened from this panel would anchor itself to the board — a different
 * surface — and a layer that floats over another surface is not this surface's
 * layer.
 */
import { useEffect, useRef, useState } from 'react'
import type { ItemPriority, ItemRecord, ItemStep } from '../../core/item.ts'
import { ITEM_PRIORITIES, ITEM_STATUSES, itemPriorityRankOf, itemTitleOf } from '../../core/item.ts'
import type { ItemRowView } from '../../core/item-view.ts'
import { MANUAL_STATUSES, type TaskStatus } from '../../core/tasks.ts'
import { isEnglish, t, type TaskBoardKey } from '../locales.ts'
import { Button } from '../board/ui.tsx'
import { Chip } from '../board/Chip.tsx'
import { formatItemDate, parseItemDate, toItemDateField } from './model.ts'
import { GROUP_LABEL, PRIORITY_LABEL } from './labels.ts'
import { PriorityMark } from './marks.tsx'
import { ItemSteps } from './step-editor.tsx'
import { addStep, moveStep, removeStep } from './steps.ts'
import type { ItemPatch } from '../../core/item-transitions.ts'
import css from './item.module.css'

const ORIGIN_LABEL: Readonly<Record<ItemRecord['origin']['source'], 'item.origin.human' | 'item.origin.ai' | 'item.origin.import'>> = {
  human: 'item.origin.human',
  ai: 'item.origin.ai',
  import: 'item.origin.import',
}

/** The four tiers, most important first — the order a row of chips is scanned in. */
const PRIORITIES_BY_WEIGHT: readonly ItemPriority[] = [...ITEM_PRIORITIES]
  .sort((a, b) => itemPriorityRankOf(a) - itemPriorityRankOf(b))

export interface ItemDetailProps {
  /**
   * The row on show AS ITS PROJECTION.
   *
   * The projection and not the record, because the pane asks derived questions —
   * has this row's hard deadline passed — and a derived question answered from
   * the record is a SECOND derivation. It read `Date.now()` for the clock, which
   * is not the panel's clock: the panel owns a `now` that ticks while it is on
   * screen and is what every other date on this surface is drawn against, so the
   * one line in the pane that answered for itself could disagree with the row
   * above it, and it disagreed exactly at midnight — and could never disagree in
   * a test, because the bench's clock is fixed and a fresh `Date.now()` is not.
   *
   * The model already publishes the answer, on the same projection the row line
   * reads, so the pane and the row cannot answer differently. `item` is still
   * reachable as `view.item` for the fields the pane edits.
   *
   * **REQUIRED, NOT OPTIONAL.** This pane used to carry a 「nothing picked yet」
   * branch behind `view === undefined` — thirty lines, four dictionary keys, a
   * `recent` prop and the whole 「最近碰过的」 list, none of which any call site could
   * reach, because the panel only builds this for the row it is already showing.
   * Making the prop required turns that dead branch into a compile error, which is
   * the only way a branch nobody exercises ever stops costing anything.
   */
  readonly view: ItemRowView
  /**
   * THE PANEL'S CLOCK, so a date prints the year only when it is not this year —
   * against the same now that decided whether this row is late. Two clocks on one
   * row is a row that says 「还早」 and shows last year's date.
   */
  readonly now: number
  /**
   * ASK THE CARD THIS ROW HANGS OFF.
   *
   * It used to be a button on the row beside the ⋮, so a row carried two controls
   * for 「do something to this」 at two different distances from each other. It is one
   * of the three things in this row's footer now, and it is LISTED even when there
   * is no card — an entry that comes and goes with a fact the interface never
   * states is worse than one that is always there and says 「not yet」.
   */
  readonly onAsk: () => void
  readonly asking: boolean
  /**
   * MAKE IT A BOARD CARD, NAMED HERE, and hang this row on it.
   *
   * The picker hands the NAME over and no more: whether the row was already on a
   * card and what the new card carries (title, description, prompt) is
   * `planItemPromotion`'s to answer, and the pane knowing it would be a second
   * verdict table. One string in, the panel does the two writes.
   *
   * It lives in the same row as 「挂到哪张卡」 because a row that hangs off nothing is
   * exactly the row that needs a card to be made — and sending the reader to the
   * board to create one and back is the most expensive way to answer 「它挂在哪」.
   */
  readonly onPromote: () => void
  /** Run the card this row hangs off — the same `runTask` the catalog's `task.run`
   *  binds, handed in rather than reached for, so this component never learns how a
   *  run is started and there is no second spelling of the decision here. */
  readonly onStart: () => void
  /**
   * 这张卡现在跑不跑得起来（`taskExecutable`：执行 Prompt 非空）。
   *
   * `undefined` = 这一行没有卡（那是另一句话，由「不挂」那一格说）；`false` = 有卡而它跑不
   * 起来——那时按钮禁用，**理由写在旁边**。
   */
  readonly runnable?: boolean
  readonly onNewCard: (title: string) => void
  /** The board cards a row may hang off, already titled. */
  readonly cards: readonly { readonly id: string; readonly title: string }[]
  /**
   * One field write. The patch's shape is the shared writer's, so a field the
   * model ruled derived or forbidden cannot be written from here even by
   * accident: the type is derived from the same verdict table the writer uses.
   */
  readonly onEdit: (edit: ItemPatch) => void
  /**
   * Move the card this row hangs off to another column.
   *
   * 挂着卡的行，状态**不属于它自己**：它在哪一栏是那张卡的事实，所以这一格的写入口是
   * 看板的动作（`task.move`），不是清单的补丁。`undefined` 表示这一屏没有看板可写——
   * 那时按钮不画（一个按下去什么都不会发生的控件，比一个不在的控件糟）。
   */
  readonly onMoveCard?: (status: TaskStatus) => void
  /**
   * Write the WHOLE checklist back, through the panel's one writer.
   *
   * A list rather than four verbs, and the reason is that the step list is
   * REPLACED by design — the model reads it the same way. So 「加一步」 and
   * 「挪上去」 are two answers this pane computes with the shared pure functions
   * and hands over whole; the panel writes once. Four verbs here would be four
   * writes, and four writes are four chances for two devices to interleave into a
   * list neither of them meant.
   */
  readonly onEditSteps: (steps: ItemStep[]) => void
  /**
   * Bumped by the row menu's 「编辑步骤」, so the add field takes the caret.
   *
   * A COUNTER AND NOT A REF, for the reason the capture box's `focusRequest` is
   * one: the same press has to work twice, and a ref cannot tell the second press
   * from the first.
   */
  readonly stepsFocus?: number
  readonly onToggleStep: (stepId: string) => void
  readonly onRemove: () => void
}

/**
 * The detail, or the pane's designed "nothing picked yet" state.
 * @param props - the row, the board's cards and the hand-offs.
 * @returns the five sections, or the empty state.
 */
export function ItemDetail(props: ItemDetailProps) {
  const { view } = props
  const item = view.item
  const english = isEnglish()
  /* 挂着的卡正在跑，读的是派生状态自己（进行中 = 卡在那一栏），不另要一份 running：
   * 一个事实在投影里只算一次。 */
  const running = view.status === 'running'
  const write = (next: readonly ItemStep[]): void => props.onEditSteps([...next])

  /**
   * 状态那一格的三个可能，写在这里而不是写在 JSX 里嵌套三层三元。
   *
   * **两个值，不是三个**（受阻跟着那一套词汇一起删了），而它们的词是看板那五栏里的两个
   * （`GROUP_LABEL` = 看板自己的 `STATUS_KEY`）：同一个「待办」在两个面板上只能是同一个
   * 词。没有卡的行写的是**它自己**的字段；挂着卡的行写不了——它在哪一栏是那张卡的事实，
   * 所以那一列给的是看板自己的动词（`status.move.*`），按下去移的是那张卡。**这就是读者
   * 那句「清单和看板要完全互通，但也可以独立不挂载」在这一格上的形状**：独立时它有自己的
   * 两个状态，挂上时它是卡片的镜子。
   */
  const statusChooser = item.taskId === undefined
    ? ITEM_STATUSES.map(status => (
      <button
        key={status}
        type="button"
        className={css.itemOpt}
        data-on={item.status === status ? '' : undefined}
        aria-pressed={item.status === status}
        onClick={() => props.onEdit({ status })}
      >
        {/* 「待办」，不是「标为待办」。这一列的组名已经写着「状态」，所以每枚按钮只回答
            「它现在是什么」；而「标为」是**菜单**的动词——菜单项在动作发生之前，属性表在
            动作之后。同一张表两处用，于是属性表上一枚按钮在回答一个读者没有问的问题，
            而三个「标为…」在 268px 那一列里排成了 2 + 1。 */}
        {t(GROUP_LABEL[status])}
      </button>
    ))
    : props.onMoveCard === undefined
      /* 没有看板可写时**不给按钮**：这一行在哪一栏照旧读得到（那颗珠子、左栏那一行、
         这一行的状态里），只是改不了——而一个按下去什么都不会发生的控件，正是这一页
         要消掉的那类东西。 */
      ? <p className={css.itemOptsFoot}>{t('item.status.card')}</p>
      : MANUAL_STATUSES.map(status => (
        <button
          key={status}
          type="button"
          className={css.itemOpt}
          data-on={view.status === status ? '' : undefined}
          aria-pressed={view.status === status}
          /* 已经在那一栏的、以及还在跑的时候，都与看板自己那一排同一个判据：轮次开着
             时不许换栏，而唯一的判定是那一轮本身（这个投影里的 `running`）。 */
          disabled={view.status === status || running}
          onClick={() => props.onMoveCard?.(status)}
        >
          {t(`status.move.${status}` as TaskBoardKey)}
        </button>
      ))
  /** 「这一条还没到能动的日子」——三个日期读法里唯一一种不是「有一个日子」的。 */
  const gated = view.posture.kind === 'gated'
/**
   * THE TWO VERDICTS, one per date, read from the model's own projection.
   *
   * The row's tail speaks only for the HARD date, because that is the one that
   * turns a row red. So 截止's own verdict — 「落后 N 天」 — had never been printed
   * anywhere on this panel, and the date axis showed a bare date where a verdict
   * belongs. Two readings now, each attached to the date it judges; neither is
   * borrowed from the other, which is what makes 「超期」 one word meaning one thing.
   *
   * **SHORT INSIDE THE AXIS, because the axis already names the date.** The row's
   * tail has to spell it out — it is the only thing on that line — while the axis
   * prints 「硬期限」 in the column beside it, so the long form said the same word
   * twice in one row: 「硬期限 · 硬期限超期 9 天」. Same verdict, two surfaces, two
   * lengths — and the length is decided by what is already on the line, not by
   * preference.
   */
  const behind = view.soft.overdue && view.soft.days !== undefined
    ? t('item.dates.behind', { days: String(view.soft.days) })
    : undefined
  const over = view.posture.kind === 'hardOverdue' && view.posture.days !== undefined
    ? t('item.dates.overdue', { days: String(view.posture.days) })
    : undefined
  /** 正文很长时那一行「还有 N 行」按下去才展开全部——它自己只收起，不是把内容丢掉。 */
  const [showAll, setShowAll] = useState(false)
  /**
   * **空的正文与空的备注都不画框。**
   *
   * 这一条原先是一个五行高的输入框，而这一面板上最常见的一行就是「没有正文」——
   * 所以最常见的展开区是一块空白，读者读到的第一件事是「这里空了一块」。
   *
   * 空的时候只留**一行安静的话**，按下去框才出现，光标已经在里面：读者要的
   * 「我要写点什么」这一步没有变，少掉的是一个从来没人填过的盒子。
   *
   * 两个字段各有一份这个状态，因为它们是两件事——一个空着而另一个开着，是读者
   * 自己造成的，不是坏了。
   */
  const [bodyOpen, setBodyOpen] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const bodyField = useRef<HTMLTextAreaElement | null>(null)
  const notesField = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => {
    if (bodyOpen) bodyField.current?.focus()
  }, [bodyOpen])
  useEffect(() => {
    if (notesOpen) notesField.current?.focus()
  }, [notesOpen])
  /** 新标签在右列就地加：回车就上，而上完就把框清空，因为读者多半还要写下一个。 */
  const [draftTag, setDraftTag] = useState('')
  /**
   * 「新建卡片」就变成一根起名的输入框，不再是通往别处的门。
   *
   * 预填**这一条自己的名字**（借用的规则与提升计划同一处），因为挂不上的那条
   * 就是名字该长出来的那一条；Esc 与点开别处都收回，不留一个半字。确认只把
   * 名字交给面板——卡怎么建、文案跟不跟过去，都是 `planItemPromotion` 的
   * 判定，这一栏不写第二份。
   */
  const [cardNaming, setCardNaming] = useState(false)
  const [cardName, setCardName] = useState('')
  const [cardNameHint, setCardNameHint] = useState(false)
  const cardNameField = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (cardNaming) cardNameField.current?.focus()
  }, [cardNaming])
  // 行一换，正在写的名字就 belonging到另一条去了——起名是针对某一条的手势。
  useEffect(() => {
    setCardNaming(false)
    setCardNameHint(false)
    setDateEdit(undefined)
    setDateDraft('')
    setDateBad(false)
  }, [item.id])
  const openCardNaming = (): void => {
    setCardName(itemTitleOf(item))
    setCardNameHint(false)
    setCardNaming(true)
  }
  const shutCardNaming = (): void => {
    setCardNaming(false)
    setCardNameHint(false)
  }
  const confirmCardNaming = (): void => {
    const name = cardName.trim()
    if (name === '') { setCardNameHint(true); return }
    props.onNewCard(name)
    shutCardNaming()
  }

  /**
   * 三个日期的就地编辑。一次一行；点开时预填**字段此刻的值**（同一个写法的读法：
   * `@明天` 进去读到什么写什么），Enter 记下，Esc 收回，空值撤掉那一个日子。
   * 没读懂的读法不记下也不消失——那一行停在现场，下面说一句为什么。
   */
  const [dateEdit, setDateEdit] = useState<ItemDateKey | undefined>(undefined)
  const [dateDraft, setDateDraft] = useState('')
  const [dateBad, setDateBad] = useState(false)
  const [dateAttempt, setDateAttempt] = useState(0)
  const dateField = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (dateEdit === undefined) return
    if (!dateBad) dateField.current?.focus()
  }, [dateEdit, dateAttempt, dateBad])
  /** The focus hinge. Whichever line is open is the only one drawing the input,
   *  so one shared ref is the whole registry. */
  const registerDateField = (node: HTMLInputElement | null): void => {
    dateField.current = node
  }
  const openDateEdit = (field: ItemDateKey): void => {
    setDateEdit(field)
    // 预填是**记忆里的值**，不是猜的：格式走字段自己的写法（`@明天` 是这么进去的，
    // 读者改它就像改自己的句子，不是重新猜格式）。
    setDateDraft(toItemDateField(item[field]))
    setDateBad(false)
  }
  const shutDateEdit = (): void => {
    setDateEdit(undefined)
    setDateDraft('')
    setDateBad(false)
  }
  const confirmDateEdit = (): void => {
    const field = dateEdit
    if (field === undefined) return
    const wrote = dateDraft.trim()
    // 空值 = 撤掉这个日子。撤掉之后的读法就回到「没定」，一句实的说法。
    if (wrote === '') {
      props.onEdit({ [field]: undefined } as ItemPatch)
      shutDateEdit()
      return
    }
    // 没读懂的读法不写：一行没写就丢的词是「写了又丢」。读不懂就留在现场，加一次
    // 重试计数（同一行的重开也要重新拿过光标）。字面日子以**面板的钟**解，不是
    // 机器的今天——测试要的是给定的今天。
    const at = parseItemDate(wrote, props.now)
    if (at === undefined) {
      setDateBad(true)
      setDateAttempt(count => count + 1)
      return
    }
    props.onEdit({ [field]: at } as ItemPatch)
    // Enter = 记下，然后就该关场——记下这个手势的答案就是关场；值没变的记下会
    // 被共享写法当成一次不动，回执也不响，场还是要关。
    shutDateEdit()
  }
  return (
    <div className={css.itemOpen}>
      <div className={css.itemOpenMain}>
        {/* 左边那一列：**正文、步骤、上下文备注**。三块之间是 `--s3` 那一档间距，
            所以步骤板与备注块不会贴在一起——它们是三段话，不是一个东西的三行。 */}
        <div className={css.itemOpenText}>
          {item.body === '' && !bodyOpen
            ? (
              <button type="button" className={css.itemWritePrompt} onClick={() => setBodyOpen(true)}>
                {t('item.field.bodyAdd')}
              </button>
            )
            : (
              <div
                className={css.itemProseWrap}
                onBlur={event => {
                  /* 点开别处就收回，与卡片起名框同一律：焦点走出这一块
                   * （relatedTarget 不在块里）= 读者去了别处，框收回；焦点在
                   * 块内互相走动（正文与它下面那枚「还有 N 行」）不算点外。
                   * 文字本身早已随每一次键入写进文档，收回只是收场，不丢字。 */
                  if (event.currentTarget.contains(event.relatedTarget)) return
                  setBodyOpen(false)
                }}
              >
                <textarea
                  ref={bodyField}
                  className={css.itemProse}
                  rows={showAll ? Math.max(5, item.body.split('\n').length) : 5}
                  value={item.body}
                  placeholder={t('item.create.body')}
                  aria-label={t('item.field.body')}
                  onChange={event => props.onEdit({ body: event.target.value })}
                />
                {/* 正文可以很长，而它上面只有那一个输入框——所以超出的部分收在这里，
                    而不是把整个展开区撑到屏幕之外。40em 是中文一行读得下去的上限，
                    不是 62ch：`ch` 是「数字 0 的宽度」，而一个中文字比它宽一倍。 */}
                {item.body.split('\n').length > 5 && (
                  <button type="button" className={css.itemMore} onClick={() => setShowAll(value => !value)}
                    aria-expanded={showAll}>
                    {showAll ? t('item.body.less') : t('item.body.more', { n: String(item.body.split('\n').length - 5) })}
                  </button>
                )}
              </div>
            )}

          <p className={css.itemOpenCaption}>{t('item.section.steps')}</p>
          <ItemSteps
            item={item}
            focusRequest={props.stepsFocus}
            onToggle={props.onToggleStep}
            onAdd={text => write(addStep(item.steps, item.id, text))}
            onRemove={stepId => write(removeStep(item.steps, stepId))}
            onMove={(stepId, by) => write(moveStep(item.steps, stepId, by))}
          />

          {item.notes === '' && !notesOpen
            ? (
              <button type="button" className={css.itemWritePrompt} onClick={() => setNotesOpen(true)}>
                {t('item.field.notesAdd')}
              </button>
            )
            : (
              /* 与正文同一个盒：边、底、字号、字色、贴边都在 `.itemProse` 一处——
               * 备注 once「一条引文」的样式曾经只给这一格，两格之间的差别要靠读者自己
               * 猜是为什么。它们是同一列里的两个输入，输入就该长得一样。 */
              <div
                className={css.itemProseWrap}
                onBlur={event => {
                  /* 与正文块同一律：点开别处收回；块内互走不算点外。 */
                  if (event.currentTarget.contains(event.relatedTarget)) return
                  setNotesOpen(false)
                }}
              >
                <textarea
                  ref={notesField}
                  className={css.itemProse}
                  rows={3}
                  value={item.notes}
                  placeholder={t('item.field.notesHint')}
                  aria-label={t('item.field.notes')}
                  onChange={event => props.onEdit({ notes: event.target.value })}
                />
              </div>
            )}
        </div>

        {/* 右列：**一组一行，行与行之间一条发丝线**。不用标题宣布「下面这些是属性」
            ——组名在左、值在右、中间一条线，这一列读起来就是一张清单。
            三个日期在那张清单的下面，因为它们不是字段，是**读法**：每一行写着
            「是什么」和「现在怎么样」，所以它们自己带一句判据。 */}
        <div className={css.itemOpenSide}>
          <div className={css.itemOptRow}>
            <p className={css.itemOptName}>{t('item.field.priority')}</p>
            <div className={css.itemOpts}>
              {/* **这一排就是行上那四枚记号本身，不是另一套长得像的按钮。**
               *
               * 读者点过这里：「展开任务清单里的优先级按钮没有颜色对应。」——它原来印的
               * 是四个字 `!1 !2 !3 !4`，颜色在行上有、在左栏有，到了展开区就没有了；而
               * 同一个读者要的「全部复用同一个组件」，说的就是这件事。
               *
               * 它一度从记号改成 `.itemOpt`（词族），理由是「四枚记号各带各的重量，选中
               * 没地方落脚」。那条顾虑现在由记号自己解决：`PriorityMark` 的 `data-on` 画的是
               * **一圈墨环**（不是颜色——颜色的预算留给「这一档有多重」），所以四枚颜色不同
               * 而选中照样一眼看得见。
               *
               * 顺序仍然是**最重要的在最左**：`ITEM_PRIORITIES` 是按「最不重要」声明的
               * （那张表的注释里写着不要照它的顺序渲染）。 */}
              {PRIORITIES_BY_WEIGHT.map(priority => (
                <button
                  key={priority}
                  type="button"
                  className={css.itemPrioButton}
                  aria-pressed={item.priority === priority}
                  title={t(PRIORITY_LABEL[priority])}
                  onClick={() => props.onEdit({ priority })}
                >
                  <PriorityMark priority={priority} on={item.priority === priority} />
                </button>
              ))}
            </div>
          </div>

          <div className={css.itemOptRow}>
            <p className={css.itemOptName}>{t('item.field.status')}</p>
            <div className={css.itemOpts}>{statusChooser}</div>
          </div>

          <div className={css.itemOptRow}>
            <p className={css.itemOptName}>{t('item.field.tags')}</p>
            <div className={css.itemOpts}>
              {item.tags.map(tag => (
                <button
                  key={tag}
                  type="button"
                  className={css.itemTag}
                  onClick={() => props.onEdit({ tags: item.tags.filter(one => one !== tag) })}
                >
                  #{tag}
                </button>
              ))}
              <input
                className={css.itemTagAdd}
                value={draftTag}
                placeholder={t('item.field.tagsAdd')}
                aria-label={t('item.field.tagsAdd')}
                onChange={event => setDraftTag(event.target.value)}
                onKeyDown={event => {
                  if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                  event.preventDefault()
                  const tag = draftTag.trim().replace(/^#/, '')
                  if (tag === '') return
                  props.onEdit({ tags: [...item.tags, tag] })
                  setDraftTag('')
                }}
              />
            </div>
          </div>

{/* 三个日期的读法**各写一句**，不混成一句「逾期了」：最早的只是现在还不能
              动它；截止是你想要它什么时候好；硬期限是不会顺延的那一个，也是唯一会让
              这一行变红的那一个。软期限逾期**不是红**——那是关于一个计划的实话。
              *
              * **读法跟在它judge的那个日期后面**，不是另起一行、也不是省掉。行上
              * 那一段读法只说硬期限（唯一会让这一行变红的那一个），所以计划的落后
              * 在这里才第一次被说出来——而它属于**截止**那一行，不是属于硬期限。 */}
          <ol className={css.itemDateAxis}>
            <DateLine
              keyName='startsAfter'
              label={t('item.field.startsAfter')}
              reading={gated
                ? t('item.dates.now')
                : item.startsAfter === undefined ? t('item.dates.none') : formatItemDate(item.startsAfter, english, props.now)}
              tone={gated ? 'gate' : item.startsAfter === undefined ? 'none' : 'set'}
              field={dateEdit === 'startsAfter'}
              draft={dateDraft}
              bad={dateBad}
              onDraft={setDateDraft}
              hint={t('item.create.startsHint')}
              onOpen={() => openDateEdit('startsAfter')}
              onConfirm={confirmDateEdit}
              onCancel={shutDateEdit}
              draftRef={registerDateField}
            />
            <DateLine
              keyName='dueAt'
              label={t('item.field.dueAt')}
              reading={item.dueAt === undefined
                ? t('item.dates.none')
                : `${formatItemDate(item.dueAt, english, props.now)}${behind === undefined ? '' : ` · ${behind}`}`}
              tone={view.posture.kind === 'behind' ? 'late' : 'set'}
              field={dateEdit === 'dueAt'}
              draft={dateDraft}
              bad={dateBad}
              onDraft={setDateDraft}
              hint={t('item.create.dueHint')}
              onOpen={() => openDateEdit('dueAt')}
              onConfirm={confirmDateEdit}
              onCancel={shutDateEdit}
              draftRef={registerDateField}
            />
            <DateLine
              keyName='hardDueAt'
              label={t('item.field.hardDueAt')}
              reading={item.hardDueAt === undefined
                ? t('item.dates.none')
                : `${formatItemDate(item.hardDueAt, english, props.now)}${over === undefined ? '' : ` · ${over}`}`}
              tone={item.hardDueAt === undefined
                ? 'none'
                : view.posture.kind === 'hardOverdue' ? 'over' : view.posture.kind === 'hardSoon' ? 'soon' : 'set'}
              field={dateEdit === 'hardDueAt'}
              draft={dateDraft}
              bad={dateBad}
              onDraft={setDateDraft}
              hint={t('item.create.hardHint')}
              onOpen={() => openDateEdit('hardDueAt')}
              onConfirm={confirmDateEdit}
              onCancel={shutDateEdit}
              draftRef={registerDateField}
            />
          </ol>

          {/* 挂到哪张卡。**「不挂」是一种正当状态**，所以它是一枚按钮而不是一个空框；
              而「新开一张」也在同一排——挂不上的那一条正是最需要新卡的那一条。按下它
              只是**就地起一个名字**：回车把卡建成并挂上，Esc 与点开别处都收回。 */}
          <div className={css.itemOptRow}>
            <p className={css.itemOptName}>{t('item.field.taskId')}</p>
            <div className={css.itemOpts}>
              <button
                type="button"
                className={css.itemOpt}
                data-on={item.taskId === undefined ? '' : undefined}
                aria-pressed={item.taskId === undefined}
                onClick={() => props.onEdit({ taskId: undefined })}
              >
                {t('item.field.noCard')}
              </button>
              {props.cards.map(card => (
                <button
                  key={card.id}
                  type="button"
                  className={css.itemOpt}
                  data-on={item.taskId === card.id ? '' : undefined}
                  aria-pressed={item.taskId === card.id}
                  onClick={() => props.onEdit({ taskId: card.id })}
                >
                  {card.title}
                </button>
              ))}
              {cardNaming ? (
                <input
                  ref={cardNameField}
                  className={css.itemOptNaming}
                  size={13}
                  value={cardName}
                  placeholder={t('item.cardName.label')}
                  aria-label={t('item.cardName.label')}
                  data-dsh-tb-keys="Enter Escape"
                  onChange={event => { setCardName(event.target.value); setCardNameHint(false) }}
                  onKeyDown={event => {
                    if (event.nativeEvent.isComposing) return
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      confirmCardNaming()
                    } else if (event.key === 'Escape') {
                      /* Stopping the escape keeps it a verdict about the FIELD
                         alone: the key map's own Esc collapses the whole row —
                         the one answer this field must not borrow. */
                      event.preventDefault()
                      event.stopPropagation()
                      shutCardNaming()
                    }
                  }}
                  onBlur={shutCardNaming}
                />
              ) : (
                <button type="button" className={css.itemOpt} data-add="" onClick={openCardNaming}>
                  {t('item.field.newCard')}
                </button>
              )}
              {cardNameHint && <p className={css.itemOptHint}>{t('item.cardName.empty')}</p>}
              {/* 挂卡这件事的一句话真相。读者的担心写在字面上——「卡自己的标题
                  与 Prompt 会不会被这条覆盖掉」——答案是「不会」，而答案就该在
                  按得到它的地方：这一行说的是同一件事现在的事实，不是一份解释。 */}
              <p className={css.itemOptsFoot}>{t('item.cardLink.note')}</p>
            </div>
          </div>
        </div>
      </div>

      {/* 一句话说清「它的状态是谁说了算」——只在**两个来源真的不同**时才说：
          挂着卡、而这一行自己存的不是它现在显示的那一栏。 */}
      {item.taskId !== undefined && item.status !== view.status && (
        <p className={css.itemHint}>{t('item.status.derived', { where: t(GROUP_LABEL[view.status]), own: t(GROUP_LABEL[item.status]) })}</p>
      )}

      {/* 这一条的动作。**一条横贯两列的发丝线，下面三个动作**。
       *
       * 它们原来散在三处（⋯ 菜单里、展开区最后一节里、行上），于是读者要先知道某个
       * 动作住在哪，才能去按它。合并到这一行之后，两列的读者都落在同一排动作上；而它
       * 在两列**下面**而不是某一列里——动作作用于这一条，不作用于左半边或右半边。 */}
      <div className={css.itemOpenAct}>
        <span className={css.itemOriginRow}>
          <Chip kind={item.origin.source === 'ai' ? 'warn' : 'muted'}>{t(ORIGIN_LABEL[item.origin.source])}</Chip>
        </span>
        <div className={css.itemOpenActions}>
          {/* THE ACTIONS ANSWER THIS ROW'S STATE, and the ⋯ menu speaks the same
              * law, so a reader who learned one has learned the other. Without a
              * card the row can only become one (the primary that works on every
              * row) or go away; start and ask live where there is something to
              * run and something to ask — no disabled judges saying 「先变成看板
              * 卡片」, because the 「不挂」 chip and the primary already state
              * that fact. While the linked card runs, the slot says who is on it. */}
          {item.taskId === undefined ? (
            <>
              <Button variant="primary" size="sm" onClick={props.onPromote}>{t('item.menu.promote')}</Button>
              <Button variant="dangerGhost" size="sm" onClick={props.onRemove}>{t('item.menu.delete')}</Button>
            </>
          ) : (
            <>
              {/* **跑不起来就说为什么。** 一张执行 Prompt 为空的卡会在看板那一侧被门禁拦下来
                  （`taskExecutable`，唯一的判据），而按下这一枚按钮的人是在清单上按的——所以
                  理由必须在这里、就在按钮旁边（硬性规范 11③：理由不许只挂在 `title` 上）。
                  两个禁用理由各说各的：跑着是这一条现在的状态，跑不起来是这个按钮本身。 */}
              <Button variant="primary" size="sm" onClick={props.onStart} disabled={running || props.runnable === false}>
                {t(running ? 'item.menu.running' : 'item.menu.start')}
              </Button>
              {props.runnable === false && <p className={css.itemOptsFoot}>{t('detail.promptEmpty')}</p>}
              <Button variant="ghost" size="sm" onClick={props.onAsk} disabled={props.asking}>
                {t('item.ask')}
              </Button>
              <Button variant="dangerGhost" size="sm" onClick={props.onRemove}>{t('item.menu.delete')}</Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * ONE DATE, AND WHAT IT MEANS: a label, the value, and the verdict.
 *
 * Three dates, three SEPARATE verdicts, because a missed WANTED-BY date is a fact
 * about a plan rather than an alarm — so it reads in neutral ink and says 「落后」,
 * and only the hard one is red. Collapsing them into one 「逾期了」 is exactly how a
 * soft deadline quietly becomes a hard one without anybody deciding that.
 *
 * AND THE READING OPENED AS A FIELD: the same in-place edit every other block of
 * this column offers — the reader pressed it anywhere; the date pretending to be
 * read-only while 标题、正文、备注 all answer a press was the last 「按下不动」
 * on this surface. While editing, the single-line input takes the caret and the
 * verdicts stay off: a verdict about a date being typed is a verdict about a
 * value that does not exist yet.
 */
function DateLine(props: {
  /** Which of the three dates this line is, said on the li — the hard one's ring
   *  wears its own ink off that key (see the stylesheet's bead rules). */
  readonly keyName: 'startsAfter' | 'dueAt' | 'hardDueAt'
  readonly label: string
  readonly reading: string
  readonly tone: 'gate' | 'none' | 'set' | 'late' | 'soon' | 'over'
  /** `true` while this line's field is open; the input replaces the reading. */
  readonly field?: boolean
  readonly draft?: string
  readonly hint?: string
  readonly onDraft?: (value: string) => void
  readonly onOpen?: () => void
  readonly onConfirm?: () => void
  readonly onCancel?: () => void
  /** The focus hinge: whichever line is open holds the caret. */
  readonly draftRef?: (node: HTMLInputElement | null) => void
  /** The failed-parse flag, spoken under the axis. */
  readonly bad?: boolean
}) {
  return (
    <li data-key={props.keyName} data-tone={props.tone}>
      <i aria-hidden="true" />
      <b>{props.label}</b>
      {props.field
        ? (
            <input
              ref={props.draftRef}
              className={css.itemDateField}
              size={11}
              value={props.draft}
              placeholder={props.hint}
              aria-label={props.label}
              data-dsh-tb-keys="Enter Escape"
              onBlur={() => {
                /* 与起名框同一律：点开别处收回，不留半句没写下的读法。
                 * Enter 记下、Esc 收回的键由字段自报，blur 只是第三条出路。 */
                props.onCancel?.()
              }}
              onChange={event => props.onDraft?.(event.target.value)}
              onKeyDown={event => {
                if (event.nativeEvent.isComposing) return
                if (event.key === 'Enter') {
                  event.preventDefault()
                  props.onConfirm?.()
                } else if (event.key === 'Escape') {
                  /* Stopping the escape keeps it a verdict about the FIELD alone:
                     the key map's own Esc collapses the whole row — the one answer
                     this field must not borrow. */
                  event.preventDefault()
                  event.stopPropagation()
                  props.onCancel?.()
                }
              }}
            />
          )
        : (
            <button type="button" className={css.itemDateOpen} onClick={props.onOpen}>
              <span>{props.reading}</span>
            </button>
          )}
      {props.field && props.bad === true && <p className={css.itemDateBad}>{t('item.dates.bad')}</p>}
    </li>
  )
}

/** The three writeable dates, as one closed name for the pane's editor state. */
type ItemDateKey = 'startsAfter' | 'dueAt' | 'hardDueAt'