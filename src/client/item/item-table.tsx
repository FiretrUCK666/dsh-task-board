/**
 * The list's own body: a run of row cards, and between them the day the next run
 * was written on.
 *
 * ── WHAT THIS FILE IS, AND WHAT IT IS NOT ────────────────────────────────────
 *
 * It is NOT a table, and the file's name is the last thing left of one. There is
 * no head row and no column: a row is a bead, a sentence, its tags and one
 * control, and a head naming 「状态 / 标题 / 优先级 / 计划 / 标签」 would name a
 * shape this surface does not have. The rows carry their own status, their own
 * dates and their own priority marks; a header above them would be a second place
 * saying what each row already says.
 *
 * What is left of the old shape is the CONTAINER: one flex column that grows but
 * never shrinks (the scroller's own geometry — see the stylesheet), and the one
 * branch that matters, which is which of the two bodies to draw: rows, or the
 * sentence standing in for them when there are none.
 *
 * ── AND THE DAY HEAD BETWEEN TWO RUNS IS ONE COMPONENT, NOT A MARKUP ─────────
 *
 * It is `GroupHead` — the same head the agenda's sections wear. Two inline
 * versions of 「a mark + a word + a count」 is how the same defect came out looking
 * different on two pages.
 */
import { Fragment } from 'react'
import type { ItemRowLineProps } from './row-line.tsx'
import { ItemRowLine } from './row-line.tsx'
import { GroupHead } from './group-head.tsx'
import { itemDayGroupsOf } from './day-groups.ts'
import type { ItemDayBucket } from './day-groups.ts'
import type { ItemSort } from '../../core/item-sort.ts'
import { t, type TaskBoardKey } from '../locales.ts'
import css from './item.module.css'

/** The word each bucket is spoken in. Closed over the buckets core can produce, and
 *  typed as the dictionary's own key type rather than as the four strings written
 *  out a second time below. */
const DAY_WORD: Readonly<Record<ItemDayBucket, TaskBoardKey>> = {
  today: 'item.day.today',
  yesterday: 'item.day.yesterday',
  beforeYesterday: 'item.day.beforeYesterday',
  earlier: 'item.day.earlier',
}

export interface ItemTableProps {
  readonly rows: readonly ItemRowLineProps[]
  /** What the table says when there are no rows at all. */
  readonly empty: string
  /** What the table says when the filter is what emptied it. */
  readonly noMatch?: string
  /**
   * WHETHER THE CARD NAMES ITS DAYS INSIDE, and every caller states its answer.
   *
   * The LIST page's heads are about WHEN THE ROW WAS WRITTEN (今天/昨天/前天/更早,
   * cut by {@link itemDayGroupsOf}); that is a fact the list page exists to say.
   * The AGENDA already names its day outside the card — section name, then the
   * date, then this card — so a head in here would say the day twice and, worse,
   * say a THIRD fact: the card's head buckets by write-day, so a row due today
   * but written yesterday would carry 「昨天」 inside the agenda's 「今天」 section.
   * False = the rows are drawn exactly as they were handed over, no regrouping.
   */
  readonly dayHeads: boolean
  /**
   * THE CLOCK, and the ORDERING the reader chose.
   *
   * Both are handed in rather than read: a day heading says 「今天」 and that word
   * is only true against the same clock that decided 「超期 15 天」 on the row under
   * it, and whether a day heading may appear at all is a question about the
   * ordering, which this component cannot see. The ordering goes down as itself —
   * not as a boolean — because the table would then be trusting a caller's memory
   * of which orders qualify.
   */
  readonly now: number
  readonly sort: ItemSort
}

/**
 * The table.
 *
 * ONE HEAD, ONE TABLE, AND NO BRANCH ABOVE EITHER. A head written twice — once
 * inside the empty branch and once inside the filled one — is two copies that
 * drift: only the filled one declares `role="row"` and `role="columnheader"`, so
 * a table with rows in it is an accessible table and the same table with none in
 * it is a pile of `<div>`s. A reader who filters a list down to nothing loses
 * the row semantics of the very header that is still on screen, and no test says
 * anything, because two branches are two literals and a literal cannot disagree
 * with itself loudly enough to be caught.
 *
 * The fix is not 「remember to keep them equal」. It is that there is only one
 * head and one card, and the only question the component asks is WHICH OF THE
 * TWO BODIES to draw — a difference the header has no opinion about.
 * @param props - the rows, each already projected, and the two empty sentences.
 * @returns the card, its sticky head and its rows or its empty sentence.
 */
export function ItemTable(props: ItemTableProps) {
  return (
    <div className={css.itemTable}>
      {/* NO HEAD. There is no table here, so there is nothing for a head
          * to name: the row is a bead, a sentence, its tags and one control, and
          * 「状态 / 标题 / 优先级 / 计划 / 标签」 names a shape this surface does not
          * have. A head rendered from its own `COLUMNS` list would mean touching a
          * component four other files reach into — a cost, not a reason to keep it.
          * **A rule that is kept because removing it is inconvenient is a rule that
          * has stopped describing the thing it names.** */}
      {props.rows.length === 0
        /* 读不到 与 没有，是两件事；而「被筛选空了」又是第三件，所以这里接的是
           调用方已经分好的那一档，而不是它自己再猜一次。

           THE EMPTY ONE POINTS AT THE DOOR AND NOTHING ELSE. 「这里什么都没有」是读者
           已经有的事实（他正看着空页），所以这句话只说**下一步按哪儿**——那句
           `nothingToShowOf` 里已经带着那枚按钮的词，屏上再教一遍写法就是第二种说法了。 */
        ? (props.noMatch === undefined
            ? <p className={css.itemListEmptyWords}>{props.empty}</p>
            : <p className={css.itemNoMatch}>{props.noMatch}</p>)
        : (
          <div className={css.itemTableBody} role="list">
            {props.dayHeads
              ? itemDayGroupsOf(props.rows.map(row => row.view.item), props.now, props.sort).map(group => (
                <Fragment key={group.bucket}>
                  {/* ONE DAY, AND HOW MANY. The heading is `presentation` so it does
                      * not become a list item — the rows are the list, and a heading
                      * among them is a heading ABOUT them. */}
                  <GroupHead
                    as="presentation"
                    mark="calendar"
                    word={t(DAY_WORD[group.bucket])}
                    count={t('item.day.count', { n: String(group.n) })}
                  />
                  {group.rows.map(item => {
                    const row = props.rows.find(one => one.view.item.id === item.id)
                    return row === undefined ? null : <ItemRowLine key={item.id} {...row} />
                  })}
                </Fragment>
              ))
              : props.rows.map(row => <ItemRowLine key={row.view.item.id} {...row} />)}
          </div>
        )}
    </div>
  )
}
