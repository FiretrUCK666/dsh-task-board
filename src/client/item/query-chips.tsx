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
 * THE CHIP SAYS BOTH HALVES — the kind AND the value, in the reader's words
 * rather than in the grammar's. 「标签：画廊」 is a filter a reader can read back
 * and take off; `画廊` alone is a word, and the only place on this surface where
 * the filter is stated in the language it is written in rather than in the
 * tokens it is written with.
 */
import { t, isEnglish } from '../locales.ts'
import { queryChipsOf, withFacetToken, type QueryChip } from './facets.ts'
import { formatDayKey } from './model.ts'
import { CrossMark } from './marks.tsx'
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

/**
 * THE CHIP'S OWN NAME, and it is always 「种类：值」.
 *
 * The value is the half that makes the chip removable rather than decorative:
 * 「状态」 on its own says a filter is on without saying which, and a chip a
 * reader cannot read is a chip they will not press. It is also the only place the
 * filter is stated in the reader's language rather than in the grammar's — the
 * text underneath is one string and still says `has:hardOverdue`, which is the
 * implementation, not the filter.
 *
 * Total by construction: a chip that somehow arrives without either value falls
 * back to its facet's own name instead of reaching for a dictionary entry that
 * does not exist. `undefined` renders as nothing at all, so the miss would look
 * like a chip labelled 「状态：」 — a filter applied, described by nothing.
 */
function chipLabel(chip: QueryChip): string {
  const facet = t(chip.facet)
  if (chip.day !== null) return `${facet}：${formatDayKey(chip.day, isEnglish())}`
  if (chip.tag !== null) return `${facet}：${chip.tag}`
  if (chip.value === null) return facet
  return `${facet}：${t(chip.value)}`
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
            <CrossMark />
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
