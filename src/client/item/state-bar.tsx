/**
 * The state bar: what the reader has narrowed BY, and the two ways back.
 *
 * WHY IT IS ITS OWN LINE AND NOT PART OF THE FILTER BAR. The filter bar is the
 * machinery — twenty-three chips, the ordering, the batch door. This is the
 * ANSWER: a sentence naming the filters that are actually on, and one control to
 * put them all down. A reader who has narrowed a list of forty to three rows
 * should be able to see, in one glance and without opening anything, WHICH
 * narrowing did it — and if that sentence sits inside the thing that performs the
 * narrowing, it is one level too deep: the reader has to open the panel to learn
 * what is open.
 *
 * IT RENDERS ONLY WHEN SOMETHING IS ON, and that is the whole design rather than
 * an optimisation. With nothing filtered, the sentence would be empty, and an
 * empty line above the reader's first row is a line of nothing — the reader's eye
 * stops on it, finds no words, and moves on, having been made to check. Zero
 * height when there is nothing to say, full height the moment there is.
 *
 * `aria-live` IS DELIBERATELY ABSENT. The bar appears and disappears as the
 * reader types, and an announcement on every keystroke is a screen reader
 * reciting the filter back at someone who just typed it. The words are in the
 * filter controls themselves, which is where they were typed.
 */
import { useState } from 'react'
import { queryChipsOf } from './facets.ts'
import { ITEM_SORTS, type ItemQuery, type ItemSort } from '../../core/item-view.ts'
import { t } from '../locales.ts'
import { Button } from '../board/ui.tsx'
import { SORT_LABEL } from './labels.ts'
import css from './item.module.css'

export interface ItemStateBarProps {
  /** The parsed search box — the source of every term named on the bar. */
  readonly query: ItemQuery
  /** Every row's tags, so a tag chip can be named the way it was spelled. */
  readonly tags: readonly (readonly string[])[]
  /** The current ordering, named on the sort control. */
  readonly sort: ItemSort
  /** The orders themselves, from the model — the bar names them, never lists its own. */
  readonly onSort: (next: ItemSort) => void
  /** Put every filter down. One act, not one click per facet. */
  readonly onClear: () => void
}

/** The listbox's id, and it is ONE id because there is one ordering control. */
const SORT_LIST_ID = 'item-sort-list'

/** The whole query, named. Order is the facet order, then the reader's own tags. */
function termsOf(query: ItemQuery, tags: readonly (readonly string[])[]): string[] {
  const chips = queryChipsOf(query.text, tags)
  return chips.map(chip => (chip.tag === null ? t(chip.value ?? chip.facet) : `#${chip.tag}`))
}

export function ItemStateBar(props: ItemStateBarProps) {
  const [sorting, setSorting] = useState(false)
  const terms = termsOf(props.query, props.tags)
  if (terms.length === 0) return null
  return (
    <div className={css.itemStatebar} role="group" aria-label={t('item.statebar.label')}>
      {/* THE ANSWER, and the words are the CHIPS' words rather than the raw
          tokens: a reader who pressed 「进行中」 should read 「进行中」 here, not
          `status:inProgress`. A status line that printed the grammar would be
          showing the reader their own source code. */}
      <p className={css.itemStatebarTerms}>{terms.join(' · ')}</p>
      <div className={css.itemStatebarActions}>
        {/* THE ORDERING IS NAMED ON ITS OWN CONTROL, and it is a disclosure
            rather than a permanently drawn list of six. Six options standing on
            screen is a paragraph wearing the costume of a setting, and it sits
            directly above the rows the reader came to read. */}
        <button
          type="button"
          className={css.itemStatebarAction}
          aria-haspopup="listbox"
          aria-expanded={sorting}
          /* THE DISCLOSURE NAMES WHAT IT GOVERNS. `aria-expanded` alone says
             「something is open」 and points at nothing, which is the one thing a
             screen reader cannot follow: it cannot tell that the control the
             listener heard about is the control that opens this list. The id is
             the same on every render, so it does not change identity under the
             reader while the list is open. */
          aria-controls={SORT_LIST_ID}
          aria-label={t('item.sort.label')}
          onClick={() => setSorting(open => !open)}
        >
          {t(SORT_LABEL[props.sort])}
        </button>
        {sorting && (
          <ul id={SORT_LIST_ID} className={css.itemStatebarTerms} role="listbox" aria-label={t('item.sort.label')}>
            {ITEM_SORTS.map(order => (
              <li key={order} role="option" aria-selected={order === props.sort}>
                <button
                  type="button"
                  className={css.itemStatebarAction}
                  onClick={() => { props.onSort(order); setSorting(false) }}
                >
                  {t(SORT_LABEL[order])}
                </button>
              </li>
            ))}
          </ul>
        )}
        <Button variant="ghost" size="sm" className={css.itemStatebarAction} onClick={props.onClear}>
          {t('item.filter.clear')}
        </Button>
      </div>
    </div>
  )
}
