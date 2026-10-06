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
import type { ItemRailEntry, ItemRailGroup, ItemRailKey } from '../../core/item-view.ts'
import { t, type TaskBoardKey } from '../locales.ts'
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
  stale: 'item.rail.stale',
  undated: 'item.rail.undated',
  urgent: 'item.rail.priority.urgent',
  high: 'item.rail.priority.high',
  normal: 'item.rail.priority.normal',
  low: 'item.rail.priority.low',
  inProgress: 'item.rail.status.inProgress',
  open: 'item.rail.status.open',
  blocked: 'item.rail.status.blocked',
  done: 'item.rail.status.done',
}

const CAPTION: Readonly<Record<'when' | 'rank' | 'state', TaskBoardKey>> = {
  when: 'item.rail.when',
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
 *   硬期限过了  一枚实心的环 —— 唯一会让这一行变红的那一个
 *   截止过了    一个圈 + 一根往下走的指针 —— 落后于一个计划，而不是坏了
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
    // The priority rows wear the SAME CHIP the title wears: one shape in three
    // places, learned once.
    case 'priority':
      return <i className={css.itemRailChip} data-tone={entry.key}>!{priorityDigitOf(entry.key)}</i>
    case 'flag':
      return flagMarkOf(entry.key)
    case 'status':
      // The four marks are the SAME four the row's own lead dot wears, at the same
      // sizes — so the rail and the list are one vocabulary, and a reader who has
      // learned the dot has already learned the rail.
      if (entry.key === 'done') {
        return <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="3" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
      }
      if (entry.key === 'blocked') {
        return <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="5 2.4" /></svg>
      }
      if (entry.key === 'inProgress') {
        return <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill="var(--dsh-tb-accent)" /><circle cx="5" cy="5" r="7" fill="none" stroke="var(--dsh-tb-accent)" strokeOpacity="0.28" strokeWidth="1" /></svg>
      }
      return <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="2.5" fill="currentColor" /></svg>
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

function priorityDigitOf(key: ItemRailKey): string {
  switch (key) {
    case 'urgent':
      return '1'
    case 'high':
      return '2'
    case 'normal':
      return '3'
    case 'low':
      return '4'
    default:
      return ''
  }
}

export interface ItemRailProps {
  readonly groups: readonly ItemRailGroup[]
  /** Go to a row, a page, or 「wherever this entry points」. */
  readonly onEnter: (entry: ItemRailEntry) => void
  /** The entry the reader is standing in, if any. */
  readonly activeId: string | undefined
  /** The month being shown, and the days that hold rows. */
  readonly month: string
  readonly daysWithRows: readonly string[]
  readonly today: string
  readonly onPickDay: (day: string) => void
}

export function ItemRail(props: ItemRailProps) {
  return (
    <nav className={css.itemRail} data-dsh-tb-scroll="" aria-label={t('item.rail.label')}>
      <p className={css.itemRailMonth}>{props.month}</p>
      <MonthGrid month={props.month} days={props.daysWithRows} today={props.today} onPick={props.onPickDay} />
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
              aria-current={props.activeId === entry.id ? 'true' : undefined}
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
 */
function MonthGrid(props: { readonly month: string; readonly days: readonly string[]; readonly today: string; readonly onPick: (day: string) => void }) {
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
      {cells.map((cell, at) => cell === null
        ? <span key={`blank-${at}`} className={css.itemRailDayBlank} aria-hidden="true" />
        : (
          <button
            key={cell.key}
            type="button"
            className={css.itemRailDay}
            data-has={held.has(cell.key) ? '' : undefined}
            data-today={cell.key === props.today ? '' : undefined}
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