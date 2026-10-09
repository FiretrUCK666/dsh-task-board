/**
 * The rail: where a reader goes, and how much of each thing is there.
 *
 * ── WHY EVERY NUMBER ON IT IS A ROW COUNT AND NOT A LITERAL ─────────────────
 *
 * The first version of this was a table of words with numbers written into it,
 * and it was wrong in a way nothing on screen could report: the number was a
 * fixture value and the row beside it was a filter, so 「落后的 2」 and 「点进去
 * 看到几行」 were two facts that agreed only while nobody edited the data. That is
 * the exact defect PRODUCT's first invariant forbids, committed by the very
 * component meant to satisfy it.
 *
 * So the rows come FROM `itemRailGroupsOf` — each entry carries the rows it
 * holds, and its count is their length. There is no number in this file to go
 * stale, because there is no number in this file at all.
 *
 * ── WHY THE GROUPS ARE GROUPS AND NOT ONE LIST ──────────────────────────────
 *
 * A single column of grey words makes a reader treat a COLLECTION, two
 * PREDICATES and a STATUS as siblings, and they are not:
 *
 *   刚记的   一个集合——「我刚记下、还没给它任何结构的」。它是入口，也是唯一
 *            一个不带条件的入口。
 *   按条件看 四个关于**时间**的谓词。日历欠了、停了、没有日子、还没到。归成一组
 *            是因为读者扫这一组时问的是同一句：日历在跟我说什么。
 *   按重要程度 四档优先级。它们是**刻度**不是条件——所以它们是另一组。
 *   按状态   四个状态。它们是**字段的投影**，不是收窄。
 *   全部 / 已删除 两个地方，不是筛选。
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
import { PriorityMark, StatusMark } from './marks.tsx'
import css from './item.module.css'

/** The word each stable key is spoken in. A filter written against a display
 *  name matches nothing the moment that name is reworded, so the core hands over
 *  keys and the dictionary owns the words.
 *
 *  **NO FALLBACK, AND THAT IS THE POINT.** This table used to be read with
 *  `?? 'item.rail.all'`, so a key it did not know printed 「全部」 — next to its own
 *  real count, which is the one thing on this surface a reader cannot check. The
 *  rail showed 「全部 0」 and 「全部 12」 on one screen at once. A fallback on a
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
 * Five predicates that all wore the same arc is the same defect as five words with
 * one number: the mark looked like it was carrying information and was not. Each
 * predicate is a different *shape of claim* about the calendar, so each gets a
 * different shape:
 *
 *   不晚于过了  一枚实心的环 —— 唯一会让这一行变红的那一个
 *   希望在过了    一个圈 + 一根往下走的指针 —— 落后于一个计划，而不是坏了
 *   停滞的      一段虚线的弧 —— 很久没有人碰
 *   没日期的    一根平线 —— 什么都没有
 *   还没到日子的 一扇关着的门 —— 有一个日子，只是还没到
 *
 * The four statuses are three shapes and a gap, for the same reason: 待办 is an
 * empty circle because it is the resting state, 受阻 is a broken one because it is
 * a thread waiting on something, and 完成 is a closed one because it is finished.
 */
function markOf(entry: ItemRailEntry) {
  switch (entry.kind) {
    // The priority rows wear the SAME chip the title wears, one size smaller — the
    // same component, so a colour changed for the row cannot leave this column behind.
    case 'priority':
      return <PriorityMark priority={entry.key as ItemPriority} size="rail" />
    case 'flag':
      return flagMarkOf(entry.key)
    case 'status':
      // The same marks the row's own lead dot wears, from the same function — the
      // rail and the list are one vocabulary by construction, not by a comment.
      return <StatusMark status={entry.key as ItemStatusView} />
    case 'collection':
      /* 「刚记下的」是这一栏里唯一一个**不带条件**的入口，所以它戴一枚还没写上的
       * 加号——而「加一个」在别处是往清单里加一行。词、记号、位置三样说的是同一件
       * 事，而弧线留给「停滞的」。 */
      return <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M5 2v6M2 5h6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
    case 'place':
      // 「已删除」是唯一一处读者会去、而不是去收窄的地方，所以它戴一顶盖子，
      // 不戴一条横线——横线是「缩小」，盖子是「别的地方」。
      return entry.key === 'deleted'
        ? <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M1.4 2.6h7.2M3.8 2.6V1.3h2.4v1.3M2.3 2.6l.5 6.1h4.4l.5-6.1" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        : <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M2 5h6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
    default:
      return <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M1.6 8.4a3.4 3.4 0 0 1 6.8 0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
  }
}

/**
 * THE THREE DATE PREDICATES, ONE SHAPE.
 *
 * Five marks is one too many: at ten pixels a ring, a dashed arc, a ring with a
 * needle and a lidded box are four **textures**, and a column of textures reads as
 * noise rather than as a list. A mark can only carry one fact at this size, and
 * the fact worth carrying is 「this row is about a date」 — the word says which
 * date.
 *
 * So the shape is one ring, and the difference between 「超期了」and the two that
 * are not a problem is **filled against hollow** — which is the one distinction
 * that survives at ten pixels and in a dark theme.
 *
 * It was a STROKE WIDTH first, and it did not survive: 1px against 1.8px on a
 * ten-pixel circle is a difference of texture, and a column of textures reads as
 * noise. Fill against hollow is a difference of **ink**, which is the only thing
 * a reader can pick out of a list without stopping.
 */
function flagMarkOf(key: ItemRailKey) {
  return key === 'overdue'
    ? <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="3.6" fill="currentColor" /></svg>
    : <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="2.6" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
}

export interface ItemRailProps {
  readonly groups: readonly ItemRailGroup[]
  /** Go to a row, a page, or 「wherever this entry points」. */
  readonly onEnter: (entry: ItemRailEntry) => void
  /**
   * **读者正站在哪些行上**，从查询里读出来的**一组**。
   *
   * 筛子是叠加的（「已超期」+「紧急」可以同时开着），所以这一侧必须是集合：它原来是一个
   * `string | undefined`，取第一个匹配的行就停——三枚芯片亮着而左栏只有一行有底色，读者看到
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
   *  while `display: none` — what the phone used to get — is not. */
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
        * **它是一枚可以折的日历，不是一行裸数字。** 老版只有「一个月题 + 七列
        * 数字」：没有星期几、不能翻月、今天之外没有任何可对照的东西，读者的原话是
        * 「像个毛坯房」。而它在窄档还被整块 `display: none` 掉——**手机上并没有
        * 「另一种看日子」的办法**，那等于把一项能力只发给桌面端（硬性规范 11）。
        *
        * 现在的形状：一行题（月份 + 翻月 + 折叠），折起来是一枚芯片、展开是一整幅
        * 月历（周首行 + 日格 + 今天）。折起来是**读者自己的选择**，不是宽度替他做的
        * ——窄档默认折起（那一条横带里放不下一幅月历），宽档默认展开。 */}
      <div className={css.itemRailCalendar}>
        <div className={css.itemRailCalendarHead}>
          <button
            type="button"
            className={css.itemRailCalendarFold}
            aria-expanded={props.calendarOpen}
            aria-controls={calendarId}
            aria-label={t('item.rail.calendar.label')}
            onClick={props.onToggleCalendar}
          >
            <span className={css.itemRailMonth}>{props.month}</span>
            {/* 记号在**右边**：它在左边时，月题整体右移那 14px，于是标题的左沿与
                七列网格的左沿差着一格——而「月题对准格子左缘」正是这一处读者点名
                要的那条对齐。记号本身说的是「这块能折」，它站在标题末尾一样说得清。 */}
            <svg className={css.itemRailCalendarMark} viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
              <path d="M3 1.5 7 5l-4 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        {/* **正文永远在 DOM 里，折起来是 `hidden` 而不是按宽度裁掉。**
          *
          * 这是硬性规范 11 的分界线：**宽度不许决定一个控件在不在**（老版就是
          * `display: none` 掉整块日历，于是手机上没有任何按日子看的入口），而读者
          * 自己按一下折起来是允许的六种让位之一——展开它的那枚控件一直在、带着
          * 名字、`aria-expanded` 说得出当前状态。`hidden` 而不是 `display: none`
          * 写在样式表里：折起来的按钮不该还能被 Tab 走到。 */}
        <div className={css.itemRailCalendarBody} id={calendarId} hidden={!props.calendarOpen}>
          {/* **翻月与「今天」是同一条导航行。**
            *
            * 「回到今天」原本站在月历**下面**，而且只在「离今天远了」的时候才出现——
            * 于是它按下去的一瞬间自己就消失了（条件不再成立），读者看到的是一个控件
            * 在他手指底下不见了，而屏幕别处没有任何东西说明刚才发生了什么。控件可以
            * 变灰，不能在按下的那一刻消失。
            *
            * 放在 `‹ ›` 中间也是日历的常识：左右是「挪一格」，中间是「回今天」。 */}
          <span className={css.itemRailMonthNav}>
            <button
              type="button"
              className={css.itemRailNavBtn}
              aria-label={t('item.rail.month.prev')}
              onClick={() => props.onShiftMonth(-1)}
            >
              <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
                <path d="M6.5 1.5 2.5 5l4 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              type="button"
              className={css.itemRailToday}
              disabled={!props.canReturnToToday}
              onClick={props.onToday}
            >
              {t('item.rail.today')}
            </button>
            <button
              type="button"
              className={css.itemRailNavBtn}
              aria-label={t('item.rail.month.next')}
              onClick={() => props.onShiftMonth(1)}
            >
              <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
                <path d="M3.5 1.5 7.5 5l-4 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
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
              <span className={css.itemRailWord}>{t(WORD[entry.key])}</span>
              <b className={css.itemRailCount}>{entry.n}</b>
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
          （原来只有日格，而数字是从第四列才开始有的，于是月题看起来「往左偏了」）。
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