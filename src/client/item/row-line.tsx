/**
 * The row line: four tracks, and a sentence with a reading at the end of it.
 *
 * ══ WHY IT IS NOT A TABLE ROW ═══════════════════════════════════════════════
 *
 * It was one — a pickbox column, a status pill, then one column each for the title,
 * the priority, the date and the tags, with ⋮ last. Two things were wrong with that
 * shape and neither was about the columns:
 *
 *   THE ⋮ DID NOT STAY PUT. Two `auto` tracks sized themselves to their contents, so
 *   ⋮ stopped wherever the tags happened to end: a row with one tag sat flush
 *   right, a row with three pulled inwards by two hundred pixels. **A grid says 「I am
 *   the last column」 once and means it at every width**; a flex row has to be told,
 *   and being told means being told wrong the next time a tag gets longer.
 *
 *   THE ROW SAID EACH FACT TWICE. The status had a column AND a word; the date had a
 *   column AND a reading on the meta line. Now: the bead says the state as a shape,
 *   the sentence says the row, and the reading says what the calendar says — one
 *   fact in one place.
 *
 * ══ WHY MULTI-SELECT IS A MODE AND NOT A COLUMN ════════════════════════
 *
 * Forty-four pixels of empty box down every row, on every page, to serve a mode a
 * reader has to discover first — that is why there is no standing column. What a
 * mode owes the reader instead is a FACE once they are in it: while the batch is
 * armed the lead slot becomes the tickbox (the same 16px box the archive's armed
 * drawer wears), and ⌘-click, `X` and the ⋮ entry work whether or not the mode is
 * visibly on. A column that only exists while it has work to do costs the other
 * twenty rows nothing.
 *
 * ══ WHY THE MARK IS A SHAPE AND NOT A WORD ═════════════════════════════════
 *
 * Four states, and the word is not on the row any more, so the shape has to carry it.
 * 那一颗珠子与左栏那一列是**同一个函数画出来的**（`marks.tsx`）——读者学会了这一颗
 * 就已经学会了那一栏，而这句话从注释变成了结构。
 */
import { useEffect, useRef, useState } from 'react'
import type { ItemRowView } from '../../core/item-view.ts'
import { DEFAULT_STALE_DAYS } from '../../core/item-view.ts'
import { t, type TaskBoardKey } from '../locales.ts'
import { MANUAL_STATUSES, type TaskStatus } from '../../core/tasks.ts'
import { ITEM_STATUSES, type ItemStatus } from '../../core/item.ts'
import { PRIORITY_LABEL, STATUS_LABEL } from './labels.ts'
import { DATE_FIELD_KEY, GROUP_LABEL } from './labels.ts'
import { CardMark, ClockMark, PriorityMark, StatusMark, StepsMark } from './marks.tsx'
import { formatItemDate } from './model.ts'
import { ItemRowMenu } from './row-menu.tsx'
import { Tickbox } from './tickbox.tsx'
import css from './item.module.css'

type DueTone = 'set' | 'soon' | 'soft-late' | 'over'

/**
 * THE ONE DATE READING THE ROW CARRIES — AND IT IS ONE SHAPE.
 *
 * One reading, not two: it used to print the hard deadline's reading at the end of
 * the sentence AND the plan's reading on the line below, so a reader had to work
 * out which number was about which date. The plan's reading is not lost — it is on
 * the date axis in the expanded row, in the column that already says 「希望在」.
 * **一个事实在一行里说一次，在它自己的那一栏里说一次。**
 *
 * **THE SHAPE IS `<日期名> · <读法>`, IN EVERY BRANCH.** It was not: three
 * branches named their date (「不晚于超期 9 天」), two named nothing (「就是今天」,
 * 「10月16日」), one was a whole sentence about itself, and one printed nothing at
 * all. A reader looking at a list of them cannot tell whether 「10月16日」 is the
 * deadline, the wanted-by date or the day the row may start — the one thing the
 * reading exists to say is the thing it left out. **一个位置的形状只该有一种**；
 * 一种形状的六个成员看起来才像同一件事的六种情形。
 *
 * The name comes from the posture itself rather than from a second guess: each
 * branch already knows which field it is reading (`datePostureOf`'s own
 * precedence), so the name is read off that, and a branch that names the wrong
 * date cannot be written without moving the branch.
 *
 * The tone rides the READING, never the name — the name is the row's own field
 * label and stays in the meta ink. A red field name would make 「不晚于」 itself
 * alarming on every row that has one.
 * @param view - the row's projection.
 * @param english - whether the reader's language is English.
 * @returns the tone and the words, or nothing when no date says anything yet.
 */
function dueLine(view: ItemRowView, english: boolean, now: number): { tone: DueTone; text: string } | undefined {
  const { posture } = view
  /* A DATE CARRIES ITS FIELD'S NAME; A VERDICT DOES NOT.
   *
   * A bare date says nothing about whose it is — 「10月15日」 could be the deadline,
   * the wanted-by date or the day the row may start, and that is the one thing the
   * reading exists to say. So the three date branches name their field.
   *
   * A verdict already names itself by its VERB: 「超期」 is the hard deadline (the
   * only one a reader cannot re-negotiate alone) and 「落后」 is the plan's own date.
   * Prefixing the field onto a word that already says which date it is gives
   * 「不晚于 · 超期 9 天」 — one sentence saying one thing twice, which is what the
   * shape rule in this panel exists to prevent.
   *
   * The separator is a SPACE, not a dot: 「不早于 10月5日」 reads as a phrase, and
   * the row's meta line already spends the dot on 「#1 · 1/3」. Two separators in one
   * 13px line is one separator too many. */
  const about = (field: 'startsAfter' | 'dueAt' | 'hardDueAt', reading: string): string =>
    `${t(DATE_FIELD_KEY[field])} ${reading}`
  switch (posture.kind) {
    case 'behind':
      return { tone: 'soft-late', text: t('item.dates.behind', { days: String(posture.days) }) }
    case 'hardOverdue':
      return { tone: 'over', text: t('item.dates.overdue', { days: String(posture.days) }) }
    case 'hardSoon':
      return { tone: 'soon', text: t('item.due.soon', { days: String(posture.days) }) }
    case 'dueToday':
      return { tone: 'set', text: about('dueAt', t('item.due.today')) }
    case 'hardAhead':
      return { tone: 'set', text: about('hardDueAt', t('item.due.set', { when: formatItemDate(posture.at, english, now) })) }
    case 'upcoming':
      return { tone: 'set', text: about('dueAt', t('item.due.set', { when: formatItemDate(posture.at, english, now) })) }
    /* A GATE IS A DATE YOU CANNOT CROSS YET, and it used to print NOTHING — so the
     * one row whose dates explain why it has not started said neither the date nor
     * that there was one. It is a date like any other: name it, read it. */
    case 'gated':
      return { tone: 'set', text: about('startsAfter', t('item.due.set', { when: formatItemDate(posture.startsAfter, english, now) })) }
    case 'contradiction':
      // Said, never repaired and never hidden: a row whose three dates disagree is
      // the one row the reader most needs to see, and a list that swallowed it would
      // be the quietest possible way to lose their words. And the two names are the
      // ones that disagree — read off the conflict, so each of the three possible
      // pairs names the two fields actually in it.
      return {
        tone: 'over',
        text: t('item.dates.contradict', {
          a: t(DATE_FIELD_KEY[posture.conflict.field]),
          b: t(DATE_FIELD_KEY[posture.conflict.limitField]),
        }),
      }
    case 'none':
      return undefined
  }
}

/** What the meta line says, in the order that reads. */
function metaLine(view: ItemRowView): string {
  const parts: string[] = []
  /* THE NUMBER, OR THE FACT THAT THERE ISN'T ONE YET. `itemRefOf` rather than a
   * template, because the ledger's own `#0` sentinel is a fact about storage and must
   * never reach the screen; and the row is still worth a word when the document has
   * not numbered it, because 「编号待定」 says 「this will have a number」 where a
   * blank cell says 「there is nothing here」. */
  parts.push(view.ref.text ?? t('item.ref.pending'))
  /* 步数在这一行里**不再出现**：它搬进了右边那簇记号（自己的图标、自己的名字），而一个事实
   * 在一行里出现两遍正是这一行上半年删掉「状态」的那个理由。 */
  // Only once it has actually been neglected. A row touched a minute ago answers
  // zero, and printing 「放着 0 天」 on every fresh row turns the one signal that is
  // supposed to be rare into furniture. The threshold is the one the rail's own
  // 「没人动的」 reads, so the row and the rail never disagree.
  if (view.staleDays !== undefined && view.staleDays >= DEFAULT_STALE_DAYS) parts.push(t('item.stale', { days: String(view.staleDays) }))
  return parts.join(' · ')
}

export interface ItemRowLineProps {
  readonly view: ItemRowView
  /** THE PANEL'S CLOCK, passed in rather than read. Two clocks on one row is a row
   *  that says 「还早」 and shows last year's date. */
  readonly now: number
  readonly panelId: string
  readonly expanded: boolean
  readonly selected: boolean
  /** Whether the keyboard cursor sits on this row. Unlike `selected` (which
   *  marks the row whose detail is being read), the cursor is where the next
   *  keystroke will act — and it must be VISIBLE, because every write on this
   *  panel goes through it. */
  readonly cursor: boolean
  readonly onSelect: () => void
  readonly onToggle: () => void
  /** Whether this PAGE batches. The inbox and the agenda answer false, so a row there
   *  carries no way to be held. */
  readonly picking: boolean
  /** Whether the batch is ARMED — the mode whose face is a tickbox in the lead
   *  slot. `picking` without `armed` still answers ⌘-click, `X` and the ⋮ entry;
   *  the box appears the moment there is a mode to show. */
  readonly armed: boolean
  readonly picked: boolean
  /** The inline-rename lease: `E` SOCKET. Presence = 「enter the title editor
   *  now」, the number itself never repeats an already-served request. */
  readonly renameNonce?: number
  /** Hold one row, optionally as a range over what is on screen. */
  readonly onPick: (extend: boolean) => void
  readonly onPatch: (patch: { readonly title: string }) => void
  readonly menuOpen: boolean
  readonly onMenuToggle: () => void
  readonly onMenuClose: () => void
  readonly onAsk: () => void
  readonly asking: boolean
  readonly receipt?: string
  /** Write this row's OWN status field — only offered while it has no card. */
  readonly onMark: (status: ItemStatus) => void
  /**
   * Move the card this row hangs off. `undefined` when there is no board to write,
   * in which case the menu's status entries are absent rather than dead.
   */
  readonly onMoveCard?: (status: TaskStatus) => void
  /** Open the checklist and put the caret in its field. Three things at once: close
   *  the menu, select the row, expand it — picking without expanding leaves the
   *  reader looking at a selected row with no checklist on screen. */
  readonly onSteps: () => void
  readonly onPromote: () => void
  /** 开工 — run the card this row hangs off, through the SAME `runTask` the
   *  catalog's `task.run` binds. Not `rerunTask`: a row that runs a card one way
   *  while the model runs it another is two definitions of 「开工」 on one
   *  installation. */
  readonly onStart: () => void
  /**
   * **把看板舞台打开在这一行挂着的那张卡上**，由装配层给（见 `ItemListFace.openCard`）。
   *
   * 缺席时卡芯片**退回一枚读数**（不画成一枚按不动的按钮）。
   */
  readonly onOpenCard?: (cardId: string) => void
  /** Whether that card is running, so 「开工」 is not offered twice. */
  readonly running: boolean
  /**
   * Whether that card can run at all (`taskExecutable`: 执行 Prompt 非空).
   *
   * `undefined` = this row has no card (a different sentence, said by 「不挂」),
   * `false` = it has one and it cannot run — the menu then says why.
   */
  readonly runnable?: boolean
  readonly onRemove: () => void
  /** The in-place detail, rendered only when `inPlace` and open. */
  readonly inPlace: boolean
  readonly detail?: React.ReactNode
}

/**
 * One row.
 * @param props - the projection and every hand-off it needs.
 * @returns the row: a bead, a sentence, its tags and one control.
 */
export function ItemRowLine(props: ItemRowLineProps) {
  const { view, expanded, selected, inPlace, panelId, menuOpen, onMenuToggle, onMenuClose } = props
  const item = view.item
  /* 卡片的 id 取成一个 const：守卫里的收窄进不了回调（`onClick` 是另一个函数作用域），
     而 `view.cardId` 是一个属性访问——TS 不会相信它在闭包里还窄着。 */
  const cardId = view.cardId
  const english = t('item.field.title') === 'Title'
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.title)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const rowRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const regionId = `${panelId}-row-${item.id}-detail`

  // The draft follows the row it is renaming, and a row's title changes from three
  // places — the pencil, the keyboard, the model — so an edit that started on a stale
  // value would file the stale value.
  useEffect(() => { if (!editing) setDraft(item.title) }, [item.title, editing])
  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])
  /* E 的租约在这里结账：面板每按一次 E 都把 nonce 涨一格，本行只接自己见过的
     最高一次——接过的不再重放， нераспредел的留给别的行。 */
  const servedRename = useRef<number | undefined>(props.renameNonce)
  useEffect(() => {
    if (props.renameNonce === undefined) return
    if (props.renameNonce === servedRename.current) return
    servedRename.current = props.renameNonce
    startEditing()
  }, [props.renameNonce]) // startEditing closes over the current title; the nonce is the change

  const startEditing = (): void => { setDraft(item.title); setEditing(true); onMenuClose() }
  const commitTitle = (): void => {
    const words = draft.trim()
    if (words !== '' && words !== item.title) props.onPatch({ title: words })
    setEditing(false)
  }

  const due = dueLine(view, english, props.now)

  return (
    <div
      ref={rowRef}
      className={css.itemRow}
      role="listitem"

      data-status={view.status}
      data-open={inPlace && expanded ? '' : undefined}
      data-selected={selected ? '' : undefined}
      data-cursor={props.cursor ? '' : undefined}
      data-picked={props.picked ? '' : undefined}
      onClick={event => {
        /* A MODIFIER PRESS HOLDS, AND A PLAIN PRESS SELECTS.
         *
         * 多选那一列 44px 的常驻勾选框拿掉之后，进这一格的门就只剩这一个手势：读者
         * 想「拿着」一行，不该先知道有个模式存在。而它在重写这一行的时候跟着勾选框
         * 一起没了——于是「不用先进模式就能拿到一行」变成了一个根本不成立的承诺，
         * 而承诺留在文档里、按钮不在界面上，是最难发现的一种坏。
         *
         * **Shift 是范围，⌘ 是这一行。** 两个都叫修饰键，意思却不一样：一个说
         * 「屏幕上的这几行」，一个说「这一行」。所以两者都要分清，而不是统一成
         * 「按了就是切换」——那会让 Shift 在没有锚点时把整整一列都拿走。 */
        if (props.picking && (event.shiftKey || event.metaKey || event.ctrlKey)) {
          event.stopPropagation()
          props.onPick(event.shiftKey)
          return
        }
        props.onSelect()
        /* A PLAIN PRESS ALSO OPENS THE ROW, ON BOTH BANDS.
         *
         * 它原来在宽屏**不**展开：那时候宽屏的详情住在右边单独一栏，点一行是「选中」，
         * 而那一栏是选中之后才租的。侧栏拿掉之后两档都改成在行里展开，而这一行还留着
         * 「只有窄屏才展开」的旧判断——于是**两档都变成只选中、永远打不开**：一个点
         * 下去什么都不发生的控件，而读屏工具与键盘同样进不去。
         *
         * 「展开」与「收起」是同一件事的两个方向，所以它读 `onToggle`（面板自己知道
         * 现在是开着还是关着），而不是记一个「第一次点要展开」的旗子——旗子是必须和
         * UI 状态同步的第二份真相，而第二份真相迟早会不同步。 */
        props.onToggle()
      }}
    >
      {/* THE LEAD SLOT: the state bead, or — while the batch is armed — the
          tickbox that is armed mode's own face. The press must not reach the row
          underneath it: a box whose press also opens the row is two controls in
          one, and the reader cannot say which one they pressed. */}
      <span
        className={css.itemRowLead}
        aria-hidden={props.picking && props.armed ? undefined : 'true'}
        onClick={props.picking && props.armed ? event => event.stopPropagation() : undefined}
      >
        {props.picking && props.armed
          ? (
              <Tickbox
                checked={props.picked}
                label={t(props.picked ? 'item.batch.release' : 'item.batch.hold')}
                onToggle={() => props.onPick(false)}
              />
            )
          : <StatusMark status={view.status} />}
      </span>
      <div className={css.itemRowCell}>
        {editing
          ? (
            <input
              ref={inputRef}
              className={css.itemRowTitleInput}
              value={draft}
              /* THE FIELD SAYS WHICH KEYS ARE ITS OWN: Enter confirms here, Escape
               * dismisses here, and the panel's keymap stands aside on both —
               * otherwise Enter would also re-run 「打开这一条」 and Escape would
               * also collapse the row, one press acting twice. */
              data-dsh-tb-keys="Enter Escape"
              onChange={event => setDraft(event.target.value)}
              onBlur={commitTitle}
              onKeyDown={event => {
                if (event.key === 'Enter') { event.preventDefault(); commitTitle() }
                if (event.key === 'Escape') { event.preventDefault(); setEditing(false) }
              }}
            />
          )
          : (
            /* THE SENTENCE, WITH ITS OWN MARKS INSIDE IT.
             *
             * 行内排版，不是 flex —— flex 的换行是在**收缩之前**按基准尺寸决定的，于是
             * 芯片 30px 加上整句的 max-content 超过一行宽时，**整句被推到下一行、芯片
             * 自己留在上面**。412px 上每一行都成了「一行芯片 + 三行标题」。换成正常的行内
             * 流之后，芯片是段首的一个词、标签是句末的一个词，文字自己折行。
             *
             * **标签也在这条流里了。** 它们原来是右边独立的一列，于是「同一个短语的两个
             * 部分」被排在句子的两头（读者的原话：把标签挪到标题右边，左右间距与左边那些
             * 元素**完全一致**）。现在它们是句子末尾的词，间距读的是同一档 6px——即
             * `!N` 与句子之间那一档。 */
            <h3 className={css.itemRowTitle}>
              {/* ONE PRESS OPENS THE FIELD. It used to need two — 「press the title
                  * again」 — because the title was text; now it is a control, and a
                  * control with a hidden first press is a control that does nothing
                  * the first time. */}
              <button
                type="button"
                className={css.itemPrioButton}
                /* THE NAME SAYS WHAT THE PRESS DOES and what the glyph reads: the
                 * chip opens the title editor (the priority is a word IN the
                 * title's grammar), so 「优先级：紧急」 alone was a title that lied
                 * about the action. */
                aria-label={`${t(PRIORITY_LABEL[item.priority])} · ${t('item.menu.rename')}`}
                title={`${t(PRIORITY_LABEL[item.priority])} · ${t('item.menu.rename')}`}
                onClick={event => { event.stopPropagation(); startEditing() }}
              >
                {<PriorityMark priority={item.priority} />}
              </button>
              {/* THE SENTENCE IS THE VIEW'S TITLE, not the stored field. A row
                  written from a body alone (「正文（可留空）」 is an honest way to
                  save) has no `title` of its own, and printing the raw field drew
                  a row with nothing in it — the derivation that borrows the body's
                  first line existed and had no reader. It has one now. */} 
              <span className={css.itemRowText}>{view.title}</span>
              {item.tags.map(tag => <span key={tag} className={css.itemTag}>{`#${tag}`}</span>)}
            </h3>
          )}

        {/* THE META LINE SAYS TWO THINGS NOW, and it used to say four.
         *
         * **状态不在这里。** 它原来印着「待办」，而左边那个点已经说了同一件事——一个
         * 事实在一行里出现两遍，读者得先判断哪一遍算数。
         *
         * **步数与挂卡也不在这里了。** 它们各自有了图标、各自站进了右边那簇记号里（读者
         * 的原话：那个 `1-1` 看不懂、太小；那个小方块看不出是什么，还把编号挤开了）。
         * 副行留下的两样都是「关于这一条自己的账」：编号与放置天数。 */}
        <p className={css.itemRowMeta}>{metaLine(view)}</p>
      </div>

      {/* ── 行右边的三枚记号：步数 · 卡 · 日期 ──────────────────────────────────
        *
        * **它们在同一簇里，是因为它们是同一类事实**：都是「这一条现在什么状况」的读数，
        * 都不是句子的一部分。位置也来自读者给的那张参考图：**日期在最右边、紧挨着 ⋮**，
        * 左边是卡，再左边是步数。
        *
        * 三枚各有一枚图标，而现在只有「步数」是控件（按下去开步骤那一栏）：卡与日期这两枚
        * 说的是事实，事实不该长得像按钮。 */}
      <div className={css.itemRowMarks}>
        {view.progress !== undefined && (
          <button
            type="button"
            className={css.itemRowSteps}
            aria-label={t('item.menu.steps')}
            title={t('item.menu.steps')}
            onClick={event => { event.stopPropagation(); props.onSteps() }}
          >
            <StepsMark />
            {t('item.steps', { done: String(view.progress.done), total: String(view.progress.total) })}
          </button>
        )}
        {/* **状态那一枚胶囊，每一行都在。**
         *
         * 它原来只在**挂着卡**的行上画，于是「待办 / 已完成」这两个词在没有卡的行上哪儿都不
         * 出现——而左边那颗珠子是**形状**：五个栏三个形状，形状说不出你站在哪一栏。读者的话
         * 是「不管怎么变它的状态，只要不挂上卡，标题右边是不会显示那些胶囊的，感觉很难区分
         * 出来」。
         *
         * 所以：**词一律在**（它读的是 `view.status`，那已经是「这条工作现在在哪儿」的唯一
         * 答案）；卡片有没有只决定两件事——那枚卡记号画不画，以及它是**一扇门**还是一枚读数
         * （按它跳去看板那张卡；没有卡就没有可跳的地方）。
         *
         * 装配层没给这扇门时（`onOpenCard` 缺席）它同样退回读数，而不是画一枚按了没反应的
         * 按钮。 */}
        {cardId !== undefined && props.onOpenCard !== undefined
          ? (
            <button
              type="button"
              className={css.itemRowCardChip}
              data-door=""
              aria-label={t('item.row.cardDoor', { where: t(GROUP_LABEL[view.status]) })}
              onClick={event => { event.stopPropagation(); props.onOpenCard?.(cardId) }}
            >
              <CardMark size="chip" />
              {t(GROUP_LABEL[view.status])}
            </button>
          )
          : (
            <span
              className={css.itemRowCardChip}
              data-door={undefined}
              aria-label={t('item.row.status', { where: t(GROUP_LABEL[view.status]) })}
            >
              {cardId !== undefined && <CardMark size="chip" />}
              {t(GROUP_LABEL[view.status])}
            </span>
          )}
        {due !== undefined && (
          <span className={css.itemRowDate} data-tone={due.tone}>
            <ClockMark />
            <span className={css.itemRowDateText}>{due.text}</span>
          </span>
        )}
      </div>

      <button
        ref={triggerRef}
        type="button"
        className={css.itemRowDots}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        // The menu is the region this control governs, so it names it. A disclosure
        // that says 「I am open」 without saying 「I open THAT」 announces a state the
        // listener cannot tie to anything.
        aria-controls={`item-menu-${item.id}`}
        aria-label={t('item.menu.more')}
        onClick={event => { event.stopPropagation(); onMenuToggle() }}
      >
        <svg viewBox="0 0 4 16" width="4" height="16" aria-hidden="true">
          <circle cx="2" cy="3" r="1.3" fill="currentColor" />
          <circle cx="2" cy="8" r="1.3" fill="currentColor" />
          <circle cx="2" cy="13" r="1.3" fill="currentColor" />
        </svg>
      </button>

      {props.receipt !== undefined && <p className={css.itemHint} role="status">{props.receipt}</p>}

      {menuOpen && (
        <ItemRowMenu
          rowId={item.id}
          trigger={triggerRef.current}
          /* THE BOX THE MENU HAS TO STAY INSIDE, resolved from the row by climbing.
           *
           * The menu is `position: fixed`, so its spot is computed from viewport
           * coordinates — and the box it must not leave is this panel's stage: the
           * only element here that carries `data-dsh-taskboard-view`, which the
           * plugin puts on its own subtree (see AGENTS.md, use discipline 1).
           *
           * `closest` rather than `document.querySelector`: the checklist and the
           * board are two panels of the same plugin and both carry that attribute,
           * so a document-wide lookup opened from here would find whichever one
           * happens to be first in the document and place the menu against a
           * different surface. Climbing can only ever find THIS row's own panel. */
          panel={rowRef.current?.closest('[data-dsh-taskboard-view]') as HTMLElement | null ?? null}
          onClose={onMenuClose}
          actions={[
            /* THE VERBS ANSWER THIS ROW'S STATE — the same law the detail's
             * footer row speaks. 「变成看板卡片」 lives where there is nothing to
             * attach to yet; 「开工」 / 「问这张卡」 live where there is a card to
             * run and to ask. No disabled judges with hover-only reasons: the
             * 「不挂」 chip and the primary already state that fact, and an entry
             * that comes and goes with a fact the interface never states is one
             * that never needed to exist. While the card runs, the slot says so. */
            ...(cardId === undefined
              ? [{ key: 'promote', label: t('item.menu.promote'), onPick: props.onPromote }]
              : [
                  {
                    key: 'start',
                    label: t(props.running ? 'item.menu.running' : 'item.menu.start'),
                    /* **两个禁用理由，各说各的。** 「正在跑」是这一条现在的状态；
                     * 「Prompt 为空」是它压根跑不起来——后者必须写出理由，否则读者按了一枚
                     * 灰按钮，而屏上没有任何东西说为什么。 */
                    hint: props.runnable === false ? t('detail.promptEmpty') : undefined,
                    disabled: props.running === true || props.runnable === false || undefined,
                    onPick: props.onStart,
                  },
                  {
                    key: 'ask',
                    label: t('item.ask'),
                    disabled: props.asking === true || undefined,
                    onPick: props.onAsk,
                  },
                ]),
            // Only where there is something to expand. On a band with a detail card
            // the row toggle is not what opens it, so offering 「expand」 there would
            // name an action the reader cannot take.
            ...(inPlace
              ? [{ key: 'expand', label: t(expanded ? 'item.menu.collapse' : 'item.menu.expand'), onPick: props.onToggle }]
              : []),
            { key: 'steps', label: t('item.menu.steps'), onPick: props.onSteps },
            { key: 'rename', label: t('item.menu.rename'), onPick: startEditing },
            /* **挂卡的行不在这里改状态，改的是那张卡。** 菜单项是看板自己的动词
             * （`status.move.*`），与看板详情里那一排同一个写法、同一个判据（已经在那一栏
             * 的不给、跑着的时候不给）。没有卡的行就是清单自己的两个值。
             *
             * 只有「这一行现在不在的那个状态」会被列出：给一条已经是待办的行再列一枚
             * 「标为待办」是一个做不了任何事的按钮。挂卡那一支不筛——与看板一样，三个动作
             * 常驻、当前那个禁用，因为**一个长度随隐形事实变化的菜单，是没人学得会的菜单**。 */
            ...(cardId === undefined
              ? ITEM_STATUSES
                .filter(mark => mark !== item.status)
                .map(mark => ({ key: mark, label: t(STATUS_LABEL[mark]), onPick: () => props.onMark(mark) }))
              : MANUAL_STATUSES.map(mark => ({
                key: mark,
                label: t(`status.move.${mark}` as TaskBoardKey),
                disabled: props.view.status === mark || props.running === true || undefined,
                onPick: () => props.onMoveCard?.(mark),
              }))),
            /* HOLDING ONE ROW WITHOUT A MODIFIER, because the pickbox that used to do
             * this was a column on every row for one checkbox. The entry says which
             * state it is in, because a menu whose labels flip is a menu nobody can
             * learn. */
            ...(props.picking
              ? [{ key: 'pick', label: t(props.picked ? 'item.batch.release' : 'item.batch.hold'), onPick: () => props.onPick(false) }]
              : []),
            { key: 'remove', label: t('item.menu.delete'), hint: t('item.archive.window'), onPick: props.onRemove },
          ]}
        />
      )}

      {/* THE DETAIL DOES NOT TELL THE ROW IT WAS PRESSED.
        *
        * 行本身是一个按钮——点一下就开、再点一下就关——而展开区**长在行里面**。所以
        * 在展开区里按任何东西（加一步、勾一个步骤、点一个标签、选一个日期）都会冒泡
        * 到行上，把读者刚打开的那一行当场关掉。
        *
        * **一个容器里装了一台机器，而机器的按钮会关掉这台机器。** 展开区自己吃掉这
        * 一次冒泡：读者在里面按的任何东西都属于那一行，不是一次「收起」。
        *
        * 关掉整行的地方仍然是行本身——点在句子、珠子或空白上就是收起，那是有意的。 */}
      {inPlace && expanded && (
        <div
          className={css.itemDetail}
          id={regionId}
          onClick={event => event.stopPropagation()}
          onKeyDown={event => event.stopPropagation()}
        >
          {props.detail}
        </div>
      )}
    </div>
  )
}