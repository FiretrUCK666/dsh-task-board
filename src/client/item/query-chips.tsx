/**
 * The query, shown as a reader would name it.
 *
 * WHY THE SEARCH BOX STOPS PRINTING THE GRAMMAR. The query is ONE string and it
 * stays one string — the model reads the same words, and a reader who wants the
 * raw form can still type it. What this file changes is only the page's way of
 * SHOWING that string: the box holds the words the reader typed, and every
 * qualifier beside it stands as a chip that says 「状态：进行中」 with a way to take
 * it off. Before, pressing a facet wrote its own implementation into a field
 * labelled 「搜索标题、正文、备注与标签」, so a control printed the reader its source
 * code — `status:inProgress`, `has:hardOverdue`, `p1` — and that is the single
 * largest reason the page read as machine-made. **A control that shows the reader
 * how it is implemented is not finished.**
 *
 * WHY IT IS NOT A SECOND STATE. The chips are DERIVED from the box's text by one
 * function, and removing one is the same byte-for-byte operation adding one was.
 * There is nothing to fall out of step, because there is nothing to keep.
 *
 * **A HAND-TYPED QUALIFIER STILL GETS A CHIP**, even one this file has no word
 * for: it is still filtering the list, and hiding it would be the worst possible
 * kind of wrong — a filtered list with nothing on screen saying what filtered it.
 */
import type { TaskBoardKey } from '../locales.ts'
import { t } from '../locales.ts'
import { queryChipsOf, withFacetToken, type QueryChip } from './facets.ts'
import css from './item.module.css'

export interface ItemQueryChipsProps {
  /** The whole query, exactly as it stands. The ONLY state. */
  readonly text: string
  /** The document's tags, so a tag chip can show the reader's own spelling. */
  readonly tags: readonly (readonly string[])[]
  /** Hand back the new text. Never a parsed object, never a re-serialised one. */
  readonly onSearch: (next: string) => void
  /** Clear every qualifier and leave the reader's words. */
  readonly onClearQualifiers: () => void
}

/** The chip's own name: 「状态：进行中」, and for a tag the reader's own word. */
function chipLabel(chip: QueryChip): string {
  const facet = t(chip.facet)
  if (chip.tag !== null) return `${facet}：${chip.tag}`
  return `${facet}：${t(chip.value as TaskBoardKey)}`
}

export function ItemQueryChips(props: ItemQueryChipsProps) {
  const chips = queryChipsOf(props.text, props.tags)
  if (chips.length === 0) return null
  return (
    <div className={css.itemQueryChips} role="group" aria-label={t('item.search.label')}>
      {chips.map(chip => (
        <span key={chip.token.toLowerCase()} className={css.itemQueryChip}>
          <span className={css.itemQueryChipLabel}>{chipLabel(chip)}</span>
          <button
            type="button"
            className={css.itemQueryChipRemove}
            aria-label={t('item.search.removeFacet', { what: chipLabel(chip) })}
            onClick={() => { props.onSearch(withFacetToken(props.text, chip.token, false)) }}
          >
            {t('item.search.remove')}
          </button>
        </span>
      ))}
      {chips.length > 1 && (
        <button
          type="button"
          className={css.itemQueryClear}
          onClick={props.onClearQualifiers}
        >
          {t('item.search.clearQualifiers')}
        </button>
      )}
    </div>
  )
}
