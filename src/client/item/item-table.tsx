/**
 * The table: a head that names its columns and a body that fills them.
 *
 * WHY THE HEAD IS A SEPARATE FILE AND NOT A THIRD ARGUMENT. The head row and the
 * body row declare the SAME seven tracks, and they declare them in two different
 * rules in the stylesheet. Nothing checks that they still agree — the only thing
 * that can is a reader looking at a column whose label has drifted off the data
 * under it. So the seven names live HERE, as one list, and both rows are drawn
 * from it: a column cannot be added to the body without a name, and a name cannot
 * exist without a column.
 *
 * WHY THE HEAD IS STICKY. The reader scrolls a list of forty rows and needs to
 * know what 「落后 3 天」 was counting in; a head that scrolls away is a head that
 * answers the question once. It sticks to the top of the list's own scroller, so
 * it travels with the rows and with nothing else.
 *
 * WHY THERE IS NO PICKBOX COLUMN HEADER. 「勾选」 over a column of tick boxes is a
 * label about a control, not about the data. The cell is still there — the tracks
 * must be seven on both rows or everything after the first slides — and an empty
 * cell draws nothing.
 */
import { Fragment } from 'react'
import type { ItemRowLineProps } from './row-line.tsx'
import { ItemRowLine } from './row-line.tsx'
import { ItemGrammarExample } from './composer.tsx'
import { itemDayGroupsOf } from './day-groups.ts'
import type { ItemDayBucket } from './day-groups.ts'
import type { ItemSort } from '../../core/item-sort.ts'
import { t } from '../locales.ts'
import css from './item.module.css'

/** The word each bucket is spoken in. Closed over the buckets core can produce. */
const DAY_WORD: Readonly<Record<ItemDayBucket, 'item.day.today' | 'item.day.yesterday' | 'item.day.beforeYesterday' | 'item.day.earlier'>> = {
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
 * ONE HEAD, ONE TABLE, AND NO BRANCH ABOVE EITHER. The head used to be written
 * twice — once inside the empty branch and once inside the filled one — and the
 * two copies had already drifted: only the filled one declared `role="row"` and
 * `role="columnheader"`, so a table with rows in it was an accessible table and
 * the same table with none in it was a pile of `<div>`s. A reader who filtered
 * a list down to nothing lost the row semantics of the very header that was
 * still on screen, and no test said anything, because the two branches were two
 * literals and a literal cannot disagree with itself loudly enough to be caught.
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
      {/* NO HEAD. There is no table here any more, so there is nothing for a head
          * to name: the row is a bead, a sentence, its tags and one control, and
          * 「状态 / 标题 / 优先级 / 截止 / 标签」 named a shape this surface no
          * longer has. It stayed because the head was rendered from its own
          * `COLUMNS` list and removing it would have meant touching a component
          * four other files reach into — which is a cost, not a reason. **A rule
          * that is kept because removing it is inconvenient is a rule that has
          * stopped describing the thing it names.** */}
      {props.rows.length === 0
        /* 读不到 与 没有，是两件事；而「被筛选空了」又是第三件，所以这里接的是
           调用方已经分好的那一档，而不是它自己再猜一次。

           AND THE EMPTY ONE CARRIES THE GRAMMAR. 「There is nothing here」 is a fact
           the reader already has — they are looking at the empty page. What they do
           not have is the shape of a line, so the empty state shows one, out of the
           vocabulary this panel already uses everywhere else. `noMatch` does NOT
           get the example: a reader whose filter emptied the list has rows, has
           learned the grammar, and needs to be told which of their own settings is
           hiding them — an example there would be teaching during an interruption. */
        ? (props.noMatch === undefined
            ? (
              <div className={css.itemListEmpty}>
                <p className={css.itemListEmptyWords}>{props.empty}</p>
                <ItemGrammarExample />
              </div>
            )
            : <p className={css.itemNoMatch}>{props.noMatch}</p>)
        : (
          <div className={css.itemTableBody} role="list">
            {props.dayHeads
              ? itemDayGroupsOf(props.rows.map(row => row.view.item), props.now, props.sort).map(group => (
                <Fragment key={group.bucket}>
                  {/* ONE DAY, AND HOW MANY. The heading is `presentation` so it does
                      * not become a list item — the rows are the list, and a heading
                      * among them is a heading ABOUT them. */}
                  <div className={css.itemDayHead} role="presentation">
                    <svg viewBox="0 0 13 13" width="13" height="13" aria-hidden="true">
                      <rect x="1.5" y="2.6" width="10" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="1.1" />
                      <path d="M1.5 5.6h10M4.2 1.2v2.6M8.8 1.2v2.6" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
                    </svg>
                    <b>{t(DAY_WORD[group.bucket])}</b>
                    <i>{t('item.day.count', { n: String(group.n) })}</i>
                  </div>
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
