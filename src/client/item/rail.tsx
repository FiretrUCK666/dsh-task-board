/**
 * The rail: where a reader goes, and how much of each thing is there.
 *
 * ── WHY EVERY NUMBER ON IT IS A ROW COUNT AND NOT A LITERAL ─────────────────
 *
 * A table of words with numbers written into it is wrong in a way nothing on
 * screen can report: the number is a
 * fixture value and the row beside it is a filter, so 「落后的 2」 and 「点进去
 * 看到几行」 are two facts that agree only while nobody edits the data — the
 * exact defect PRODUCT's first invariant forbids, committed by the very
 * component meant to satisfy it.
 *
 * So the rows come FROM `itemRailGroupsOf` — each entry carries the rows it
 * holds, and its count is their length. There is no number in this file to go
 * stale, because there is no number in this file at all.
 *
 * ── WHY THE GROUPS ARE GROUPS AND NOT ONE LIST ──────────────────────────────
 *
 * A single column of grey words would present the THREE SETS, the date
 * predicates, and a STATUS as siblings, and they are not:
 *
 *   全部      这份文档本身——唯一一行不收窄任何东西的。它是这一栏的地板，
 *             所以它站在最上面、自己一组。
 *   按条件看  四个关于**时间**的谓词。日期过了、日期没到、没有日期、停了多久没动。归成
 *             一组是因为读者扫这一组时问的是同一句：日历在跟我说什么。
 *   按重要程度 四档优先级。它们是**刻度**不是条件——所以它们是另一组。
 *   按状态    五个状态。它们是**字段的投影**，不是收窄。
 *   日程 / 已删除 换的是**形态**不是筛子：一个把同一份文档按天读，一个读的是已经
 *             不在这份文档里的那些行。
 *
 * **受阻只出现在「按状态」里，不在「按条件看」里。** 一批行在一个栏里有两个身份，
 * 就是不变量 1 禁止的那种重复：两个数、两份真相，而且两边都会对，直到某天不一样。
 *
 * ── WHY 「问一句」AND 「变成看板卡片」 ARE NOT IN HERE ─────────────────────
 *
 * They act on ONE row, not on a view. A rail is a map of where you can go, and
 * putting a row action on it would make the map claim to be something it is not.
 */
import { useId } from 'react'
import type { ItemPriority, ItemStatusView } from '../../core/item.ts'
import type { ItemRailEntry, ItemRailGroup, ItemRailGroupWord, ItemRailKey } from '../../core/item-view.ts'
import { t, type TaskBoardKey } from '../locales.ts'
import { STATUS_KEY } from '../board/status.ts'
import { PRIORITY_LABEL } from './labels.ts'
import { GroupMark, ChevronMark, PriorityMark, StatusMark, type ItemMarkId } from './marks.tsx'
import css from './item.module.css'

/** The word each stable key is spoken in. A filter written against a display
 *  name matches nothing the moment that name is reworded, so the core hands over
 *  keys and the dictionary owns the words.
 *
 *  **NO FALLBACK, AND THAT IS THE POINT.** Read with
 *  `?? 'item.rail.all'`, this table prints 「全部」 for a key it does not know —
 *  next to that entry's own
 *  real count, which is the one thing on this surface a reader cannot check: the
 *  rail shows 「全部 0」 and 「全部 12」 on one screen at once. A fallback on a
 *  WORD TABLE is not robustness; it is a way to say something false without
 *  noticing. So the key set is closed over what the core can actually produce,
 *  and a new flag is a `tsc` error naming this file and nothing else. */
/* The closed key set lives in core, beside the tables that build the rail. */

const WORD: Readonly<Record<ItemRailKey, TaskBoardKey>> = {
  all: 'item.rail.all',
  schedule: 'item.page.schedule',
  deleted: 'item.rail.deleted',
  overdue: 'item.rail.overdue',
  ahead: 'item.rail.ahead',
  undated: 'item.rail.undated',
  stale: 'item.rail.stale',
  /* **四档优先级、五栏状态都是别处那一份**，不是这里的第二张表：`PRIORITY_LABEL` 是
   * 四档的词（展开区、批量条、新建纸同读），`STATUS_KEY` 是看板那五栏的词。同一枚筛子
   * 在两个面板上必须是同一个词，而一张抄过来的表会在下一次改词时留下一个角落。 */
  urgent: PRIORITY_LABEL.urgent,
  high: PRIORITY_LABEL.high,
  normal: PRIORITY_LABEL.normal,
  low: PRIORITY_LABEL.low,
  backlog: STATUS_KEY.backlog,
  todo: STATUS_KEY.todo,
  running: STATUS_KEY.running,
  review: STATUS_KEY.review,
  done: STATUS_KEY.done,
}

const CAPTION: Readonly<Record<ItemRailGroupWord, TaskBoardKey>> = {
  when: 'item.rail.when',
  idle: 'item.rail.idle',
  rank: 'item.rail.rank',
  state: 'item.rail.state',
}

/**
 * ONE MARK PER ENTRY, so the rail is readable with the ink taken away.
 *
 * ── 形状住在一处，**哪一件事戴哪一枚住在这里** ────────────────────────────────
 *
 * 形状本身在 `marks.tsx`（一处画，处处用）；下面这张表说哪一枚筛子戴哪一枚，按
 * `ItemRailKey` 闭合——加一枚筛子就编译不过，而新那一枚戴着什么必须在这里说清楚。
 * 一枚记号在一个表面上只该说一件事，而这里的几枚各说各的：
 *
 *   截止过了   一枚实心的环 —— 唯一会让这一行变红的那一个
 *   日期已过   同一枚实心环——它问的是「有没有哪个日子过了」（硬期限或计划），
 *              真正是哪一个由行尾那句判决说出来
 *   放着没动   一段弧：很久没有人碰
 *   没定日期   一根平线：什么都没有
 *   日期未到   一扇关着的门：有一个日期，只是还没到
 *   全部 / 日程 / 已删除   平线 / 日历 / 一顶盖子（「去别的地方」）
 */
const GLYPH_OF: Readonly<Record<Exclude<ItemRailKey, ItemPriority | ItemStatusView>, ItemMarkId>> = {
  all: 'line',
  schedule: 'calendar',
  deleted: 'lid',
  overdue: 'ring-full',
  ahead: 'door',
  undated: 'line',
  stale: 'arc',
}

function markOf(entry: ItemRailEntry) {
  switch (entry.kind) {
    // The priority rows wear the SAME chip the title wears, one size smaller — the
    // same component, so a colour changed for the row cannot leave this column behind.
    case 'priority':
      return <PriorityMark priority={entry.key as ItemPriority} size="rail" />
    case 'status':
      // The same marks the row's own lead dot wears, from the same function — the
      // rail and the list are one vocabulary by construction, not by a comment.
      return <StatusMark status={entry.key as ItemStatusView} />
    default:
      /* 其余每一枚都在表里：平线（全部）· 日历（日程）· 盖子（已删除）·
         实心环（日期已过）· 门（日期未到）· 平线（没定日期）· 弧（放着没动）。 */
      return <GroupMark mark={GLYPH_OF[entry.key as Exclude<ItemRailKey, ItemPriority | ItemStatusView>]} size={11} />
  }
}

export interface ItemRailProps {
  readonly groups: readonly ItemRailGroup[]
  /** Go to a row, a page, or 「wherever this entry points」. */
  readonly onEnter: (entry: ItemRailEntry) => void
  /**
   * **读者正站在哪些行上**，从查询里读出来的**一组**。
   *
   * 筛子是叠加的（「日期已过」+「紧急」可以同时开着），所以这一侧必须是集合：取第一个匹配的
   * 行就停（`string | undefined`）——三枚芯片亮着而左栏只有一行有底色，读者看到
   * 的是「我按了三个，它只认一个」。
   */
  readonly activeIds: ReadonlySet<string>
  /** The month being shown, and the days that hold rows. */
  readonly month: string
  readonly daysWithRows: readonly string[]
  readonly today: string
  /** The day the reader is looking at, read off the query — the calendar's own
   *  「you are here」 for the cell, distinct from aria-current (the rail row). */
  readonly activeDay?: string
  /** Whether the month grid is unfolded. The reader's own choice, defaulted by
   *  the band (see `ItemRail`): a fold is one of the six moves rule 11 allows,
   *  while `display: none` is not. */
  readonly calendarOpen: boolean
  readonly onToggleCalendar: () => void
  /** Move the shown month by ±1. Two buttons rather than a text field: a month is
   *  a place you step through, and nobody types 「2026-09」 to get there. */
  readonly onShiftMonth: (by: -1 | 1) => void
  /** Back to the month that holds today, and off whatever day was picked. */
  readonly onToday: () => void
  /** Whether there is anything to return FROM — a month that is not today's, or a
   *  day that is picked. It greys the control rather than removing it: a control
   *  that vanishes the instant it is pressed reads as 「it broke」, and the reader
   *  gets no chance to see that the press worked. */
  readonly canReturnToToday: boolean
  readonly onPickDay: (day: string) => void
}

export function ItemRail(props: ItemRailProps) {
  /* **说得清状态，也要说得清管的是哪一块。** `aria-expanded` 单独出现只宣布了
   * 「我是开着的」，没说「我开的是什么」——读屏读到的是一个状态和一块随后出现的、
   * 它不认识的区域。`useId` 而不是手写字符串：这个面板可以在同一页里出现两次
   * （看板与清单各一个舞台），手写的 id 会在第二份里撞车，而撞车之后 `aria-controls`
   * 指向的是**另一份的那块日历**。 */
  const calendarId = useId()
  return (
    <nav className={css.itemRail} data-dsh-tb-scroll="" data-calendar={props.calendarOpen ? '' : undefined} aria-label={t('item.rail.label')}>
      {/* ── 日历 ─────────────────────────────────────────────────────────────
        *
        * **它是一枚可以折的日历，不是一行裸数字。** 一行裸数字（一个月题 + 七列
        * 数字）说不出三件事：没有星期几、不能翻月、今天之外没有任何可对照的东西——
        * 那就是一个毛坯房。**它也不许在窄档被整块 `display: none` 掉**：手机上并没有
        * 「另一种看日期」的办法，那等于把一项能力只发给桌面端（硬性规范 11）。
        *
        * 形状是一行题（月份 + 翻月 + 折叠），折起来是一枚芯片、展开是一整幅
        * 月历（周首行 + 日格 + 今天）。折起来是**读者自己的选择**，不是宽度替他做的
        * ——窄档默认折起（那一条横带里放不下一幅月历），宽档默认展开。 */}
      <div className={css.itemRailCalendar}>
        <div className={css.itemRailCalendarHead}>
          <button
            type="button"
            className={css.itemRailCalendarFold}
            aria-expanded={props.calendarOpen}
            aria-controls={calendarId}
            /* **可达名里带着月题**：屏上那串字是「2026-09」，而这一枚做的事是「展开
               日历」——只写后者，一个用嘴操作的人念出他看见的那串字就对不上
               （WCAG 2.5.3：可见的标签要在名字里）。 */
            aria-label={`${t('item.rail.calendar.label')}：${props.month}`}
            onClick={props.onToggleCalendar}
          >
            <span className={css.itemRailMonth}>{props.month}</span>
            {/* 记号在**右边**：它在左边时，月题整体右移那 14px，于是标题的左沿与
                七列网格的左沿差着一格——而「月题对准格子左缘」正是这一处读者点名
                要的那条对齐。记号本身说的是「这块能折」，它站在标题末尾一样说得清。
                方向由元件给（`dir`），不靠一条 `rotate` 挂在这个态上：旋转挂在哪个
                态，取决于基础字形朝哪边——那是一句必须和声明放在一起的理由。 */}
            <span className={css.itemRailCalendarMark}>
              <ChevronMark dir={props.calendarOpen ? 'down' : 'right'} size={12} />
            </span>
          </button>
        </div>
        {/* **正文永远在 DOM 里，折起来是 `hidden` 而不是按宽度裁掉。**
          *
          * 这是硬性规范 11 的分界线：**宽度不许决定一个控件在不在**（`display: none`
          * 掉整块日历就是反例：手机上没有任何按日期看的入口），而读者
          * 自己按一下折起来是允许的六种让位之一——展开它的那枚控件一直在、带着
          * 名字、`aria-expanded` 说得出当前状态。`hidden` 而不是 `display: none`
          * 写在样式表里：折起来的按钮不该还能被 Tab 走到。 */}
        <div className={css.itemRailCalendarBody} id={calendarId} hidden={!props.calendarOpen}>
          {/* **翻月与「今天」是同一条导航行，而它是「一枚控件、三个格子」。**
            *
            * **「回到今天」不许在按下的那一刻消失。** 只在「离今天远了」的时候才出现的话，
            * 它按下去的一瞬间条件就不再成立、控件自己消失了——读者看到的是一个控件
            * 在他手指底下不见了，而屏幕别处没有任何东西说明刚才发生了什么。控件可以
            * 变灰，不能在按下的那一刻消失。
            *
            * 放在 `‹ ›` 中间也是日历的常识：左右是「挪一格」，中间是「回今天」。
            *
            * **三格共用一个盒**（一条发丝边、没有格与格之间的分隔线），于是「居中、
            * 对称」是结构性质而不是三个数凑出来的：两边的格子一样宽、一样高，中间那一格
            * 包住自己的字，三格的墨心各自落在自己的盒心上（`ChevronMark` 的墨绕中心对称）。
            * 语义不借分段控件那一套：那是**取值**（radiogroup），这三枚是**动作**。 */}
          <span className={css.itemRailMonthNav} role="group" aria-label={t('item.rail.monthNav')}>
            <button
              type="button"
              className={css.itemRailNavBtn}
              aria-label={t('item.rail.month.prev')}
              onClick={() => props.onShiftMonth(-1)}
            >
              <ChevronMark dir="left" size={15} />
            </button>
            <button
              type="button"
              className={css.itemRailToday}
              disabled={!props.canReturnToToday}
              onClick={props.onToday}
            >
              <span className={css.itemPillText} data-dsh-tb-pilltext>{t('item.rail.today')}</span>
            </button>
            <button
              type="button"
              className={css.itemRailNavBtn}
              aria-label={t('item.rail.month.next')}
              onClick={() => props.onShiftMonth(1)}
            >
              <ChevronMark dir="right" size={15} />
            </button>
          </span>
          <MonthGrid month={props.month} days={props.daysWithRows} today={props.today} activeDay={props.activeDay} onPick={props.onPickDay} />
        </div>
      </div>
      {props.groups.map(group => (
        /* `data-turn` on the ONE group that changes the question rather than
           narrowing the view, because that is the only place a rule earns its
           keep: the rest are separated by the gap alone. */
        <div key={group.id} className={css.itemRailGroup} data-turn={group.id === 'out' ? '' : undefined}>
          {group.word !== undefined && <p className={css.itemRailCaption}>{t(CAPTION[group.word])}</p>}
          {group.entries.map(entry => (
            <button
              key={entry.id}
              type="button"
              className={css.itemRailRow}
              data-kind={entry.kind}
              aria-current={props.activeIds.has(entry.id) ? 'true' : undefined}
              onClick={() => props.onEnter(entry)}
            >
              <span className={css.itemRailMark}>{markOf(entry)}</span>
              {/* 词与数是**一个盒子里的两块字**：盒子按基线对齐（中文与拉丁的字体度量
                  不同，按盒子居中会让两串字的基线差着将近一个像素）。这个盒子自己不带任何
                  光学补偿——按字体量出来的数只在一种字体上成立，见 `src/client/ink-shift.ts`。 */}
              <span className={css.itemRailText}>
                <span className={css.itemRailWord}>{t(WORD[entry.key])}</span>
                <b className={css.itemRailCount}>{entry.n}</b>
              </span>
            </button>
          ))}
        </div>
      ))}
    </nav>
  )
}

/**
 * THE MONTH, as a set of day cells rather than a grid of numbers.
 *
 * It is a DATE FILTER — 「show me that day」 — and it is deliberately not a
 * scheduler. PRODUCT refuses month grids on the grounds that排产 needs a
 * capacity figure this product has no field for and no honest answer to; that
 * reasoning does not touch a control whose whole job is 「which day am I
 * looking at」. What it does NOT become is a place to plan: a day holds a dot
 * when rows land on it and nothing else, and there is no capacity, no load, no
 * 「too much here」 anywhere in it.
 *
 * A dot under a day, ONE dot, never a row of ticks: three ticks in a 27px cell is
 * a quantity, and a quantity here is a number nobody can act on. And today gets
 * no dot at all — the filled pill already is the mark, and two marks on one cell
 * is one too many.
 *
 * THE WEEK STARTS ON SUNDAY, and that is a fact about the calendar rather than a
 * preference: `getDay()` counts from Sunday, the leading blanks are computed from
 * it, and the month's own layout has always followed it. The weekday row above the
 * cells says so out loud, which is what the reader was missing — the columns were
 * already in this order, nobody could tell.
 */
const WEEKDAYS: readonly string[] = ['日', '一', '二', '三', '四', '五', '六']

function MonthGrid(props: { readonly month: string; readonly days: readonly string[]; readonly today: string; readonly activeDay?: string; readonly onPick: (day: string) => void }) {
  const [year, month] = props.month.split('-').map(Number)
  if (year === undefined || month === undefined || Number.isNaN(year) || Number.isNaN(month)) return null
  const lead = new Date(year, month - 1, 1).getDay()
  const length = new Date(year, month, 0).getDate()
  const stem = `${year}-${String(month).padStart(2, '0')}-`
  const held = new Set(props.days)
  /* The LEADING BLANKS ARE REAL CELLS. A month that starts on a Wednesday still
   * has to sit under the right column, and a grid that quietly pulled the first
   * day left is a month where every day is one place out of true. An empty cell
   * draws nothing — so it costs nothing and it cannot lie. */
  const cells: Array<{ readonly day: number; readonly key: string } | null> = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length }, (_, at) => ({ day: at + 1, key: `${stem}${String(at + 1).padStart(2, '0')}` })),
  ]
  while (cells.length % 7 !== 0) cells.push(null)
  return (
    <div className={css.itemRailMonthGrid} role="group">
      {/* **一周七天先报名。** 没有这一行，七列数字是一堆按列排好的数：读者数不出
          哪一列是周一，而「这一格是星期几」正是他扫月历时唯一在问的问题。它同时
          给这块日历一条**可见的左沿**——月题、周首行与日格从此站在同一条竖线上
          （只有日格而没有它的话，数字是从第四列才开始有的，于是月题看起来「往左偏了」）。
          读屏不需要它：每个日格的 accessible name 已经带着日期。 */}
      {WEEKDAYS.map((word, at) => (
        <span key={word} className={css.itemRailWeekday} aria-hidden="true" data-weekend={at === 0 || at === 6 ? '' : undefined}>
          {word}
        </span>
      ))}
      {cells.map((cell, at) => cell === null
        ? <span key={`blank-${at}`} className={css.itemRailDayBlank} aria-hidden="true" />
        : (
          <button
            key={cell.key}
            type="button"
            className={css.itemRailDay}
            data-has={held.has(cell.key) ? '' : undefined}
            data-today={cell.key === props.today ? '' : undefined}
            data-picked={cell.key === props.activeDay ? '' : undefined}
            aria-pressed={cell.key === props.activeDay}
            /* A day is a NUMBER until something says what pressing it does. So the
             * accessible name carries the verb: without it the grid is thirty-one
             * one-word buttons, and the reader has to guess whether they filter,
             * navigate, or open something. */
            aria-label={`${cell.day}日 · ${t('item.rail.pickDay')}`}
            onClick={() => props.onPick(cell.key)}
          >
            <span className={css.itemRailDayNum}>{cell.day}</span>
            <i className={css.itemRailDayDot} aria-hidden="true" />
          </button>
        ))}
    </div>
  )
}