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
import type { ItemRowLineProps } from './row-line.tsx'
import { ItemRowLine } from './row-line.tsx'
import { t } from '../locales.ts'
import css from './item.module.css'

/**
 * THE COLUMNS, in order, and the two that have no name.
 *
 * `label: undefined` is not an omission: the first cell holds a tick box and the
 * last holds a menu, and naming either one would put a word about a control above
 * a column of data.
 *
 * THE `id` IS ALSO WHAT THE STYLESHEET READS, ON BOTH ROWS. A cell that holds a
 * pill is inset by that pill's own padding and border, so its label has to be
 * inset by the same amount — otherwise the head sits a pill's width to the right
 * of the column it names, which reads as 「this table is misaligned」 rather than
 * as 「two columns are misaligned by one pill each」. The head takes `column.id`
 * and the row writes the SAME word literally, so the two cannot drift apart.
 */
const COLUMNS: readonly { readonly id: string; readonly label: 'item.table.state' | 'item.table.title' | 'item.table.priority' | 'item.table.due' | 'item.table.tags' | undefined }[] = [
  { id: 'pick', label: undefined },
  { id: 'state', label: 'item.table.state' },
  { id: 'title', label: 'item.table.title' },
  { id: 'prio', label: 'item.table.priority' },
  { id: 'due', label: 'item.table.due' },
  { id: 'tags', label: 'item.table.tags' },
  { id: 'menu', label: undefined },
]

/** Which cell each column's content lands in — read by the row, not restated. */
export const COLUMN_IDS = COLUMNS.map(column => column.id)

export interface ItemTableProps {
  readonly rows: readonly ItemRowLineProps[]
  /** What the table says when there are no rows at all. */
  readonly empty: string
  /** What the table says when the filter is what emptied it. */
  readonly noMatch?: string
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
      <div className={css.itemTableHead}>
        <div className={css.itemTableHeadRow} role="row">
          {COLUMNS.map(column => (
            <span key={column.id} className={css.itemTableHeadCell} data-col={column.id} role="columnheader">
              {column.label === undefined ? '' : t(column.label)}
            </span>
          ))}
        </div>
      </div>
      {props.rows.length === 0
        /* 读不到 与 没有，是两件事；而「被筛选空了」又是第三件，所以这里接的是
           调用方已经分好的那一档，而不是它自己再猜一次。 */
        ? (props.noMatch === undefined
            ? <p className={css.itemListEmpty}>{props.empty}</p>
            : <p className={css.itemNoMatch}>{props.noMatch}</p>)
        : (
          <div className={css.itemTableBody} role="rowgroup">
            {props.rows.map(row => <ItemRowLine key={row.view.item.id} {...row} />)}
          </div>
        )}
    </div>
  )
}
