/**
 * The filter bar: what picks the rows out. It belongs to the LIST page only.
 *
 * ONE PLACE, BESIDE THE THING IT CHANGES. Grouping, ordering, filtering and
 * batching are controls ABOUT the rows, so they sit with the rows. The header
 * keeps the four things that are about the page itself — what it is, how to
 * search it, which page, and where a thought goes in — and nothing else. A
 * toolbar at the top of a 1600px stage separates the controls from the list by
 * most of a screen, which is the distance at which a reader stops connecting
 * them.
 *
 * THE INBOX AND THE AGENDA DO NOT GET THIS BAR, and that is a decision rather
 * than a gap. A note that was written thirty seconds ago is read once, top to
 * bottom, and everything that would help you ORGANISE it is one step too early
 * for that. The agenda's own sections are already its grouping, so a filter row
 * above them would be a second grouping that disagrees with the first.
 *
 * THE ORDERING CONTROL HAS TWO SHAPES AND BOTH ARE RENDERED. Seven options do
 * not fit a 390px line, and a segmented control that cannot wrap or scroll
 * simply loses the options past its right edge — the reader is shown four of
 * seven and told nothing. So the phone band gets a `<select>`, which holds all
 * seven and needs no room, and the wide band gets the pills. WHICH ONE SHOWS is
 * decided by a container query and not by JavaScript: the component cannot know
 * its own box's width, and a JS switch beside a CSS container query is two
 * sources of truth for one decision, where a disagreement does not look wrong —
 * it looks like a control that cannot decide how wide it is.
 */
import { ITEM_SORTS, type ItemQuery, type ItemSort } from '../../core/item-view.ts'
import { t } from '../locales.ts'
import { Button, Segmented } from '../board/ui.tsx'
import { ITEM_FACETS, isFacetOn, tagFacetValuesOf, withFacetToken, type FacetValue, type ItemFacetId, type TagFacetValue } from './facets.ts'
import css from './item.module.css'

const SORT_LABEL: Readonly<Record<ItemSort, 'item.sort.sequence' | 'item.sort.starts' | 'item.sort.due' | 'item.sort.hard' | 'item.sort.priority' | 'item.sort.birth' | 'item.sort.title'>> = {
  sequence: 'item.sort.sequence',
  starts: 'item.sort.starts',
  due: 'item.sort.due',
  hard: 'item.sort.hard',
  priority: 'item.sort.priority',
  birth: 'item.sort.birth',
  title: 'item.sort.title',
}

export interface ItemFilterBarProps {
  /** The parsed search box. The ONLY state the facets read. */
  readonly query: ItemQuery
  /** The raw text, handed back with one token added or removed. */
  readonly onSearch: (next: string) => void
  readonly sort: ItemSort
  readonly onSort: (next: ItemSort) => void
  /** Every row's tag list, so the tag facet can offer what this document holds. */
  readonly tags: readonly (readonly string[])[]
  /** Whether a filter is in force, which is what the clear affordance is for. */
  readonly filtering: boolean
  readonly onClear: () => void
}

/** One chip: a toggle that says it is on, and the token it stands for. */
function FacetChip(props: {
  readonly token: string
  readonly text: string
  readonly on: boolean
  readonly onToggle: () => void
}) {
  return (
    <button
      type="button"
      className={css.itemFacetChip}
      aria-pressed={props.on}
      onClick={props.onToggle}
    >
      {props.text}
    </button>
  )
}

/**
 * One facet, FOLDED.
 *
 * WHY IT FOLDS, and the arithmetic is the whole argument. The four faces hold
 * sixteen values between them, and the ordering control holds seven more, so a
 * bar that shows everything costs twenty-three chips in two wrapped rows. Twenty-
 * three controls in a band 320px tall is not a filter bar, it is a paragraph: it
 * is louder than the rows it filters, it is the same weight as the content, and
 * the reader's eye lands on it instead of on their work. That is the 「各种文字墙，
 * 没有视觉中心」 failure in its most literal form, and it arrived wearing the
 * costume of a feature.
 *
 * So the bar keeps ONE row: the ordering (which is a thing the reader READS, so
 * it stays open — knowing how your list is ordered is not a setting you make
 * once, it is the frame everything else is seen in) plus one pill per face. A
 * face's values appear when the reader opens that face, and the pill NAMES what
 * is currently on it, so a closed pill is still an honest answer to 「is
 * anything filtered」.
 *
 * `<details>`/`<summary>` and not a controlled boolean, for one concrete reason:
 * a controlled `open` that the component re-asserts every render fights the
 * reader's own click, and the symptom is a disclosure that opens and shuts
 * itself. The native element owns the state, the summary carries the state, and
 * nothing has to be kept in step.
 */
function FacetGroup(props: {
  readonly label: string
  readonly children: React.ReactNode
  /** The words for the values currently on, or none. */
  readonly active: readonly string[]
}) {
  return (
    <details className={css.itemFacetGroup}>
      <summary className={css.itemFacetToggle} data-active={props.active.length > 0 ? '' : undefined}>
        <span className={css.itemFacetName}>{props.label}</span>
        {props.active.length > 0 && (
          <span className={css.itemFacetActive}>{props.active.join(' · ')}</span>
        )}
      </summary>
      <div className={css.itemFacetValues}>
        {props.children}
      </div>
    </details>
  )
}

export function ItemFilterBar(props: ItemFilterBarProps) {
  const tagValues = tagFacetValuesOf(props.tags)
  const toggle = (token: string, on: boolean): void => { props.onSearch(withFacetToken(props.query.text, token, on)) }

  const chips = (facet: ItemFacetId, values: readonly FacetValue[]): React.ReactNode => values.map(value => (
    <FacetChip
      key={value.token}
      token={value.token}
      text={t(value.label)}
      on={isFacetOn(props.query, facet, value.key)}
      onToggle={() => toggle(value.token, !isFacetOn(props.query, facet, value.key))}
    />
  ))

  /** The words a closed pill says about itself: what is ON, not what exists. */
  const activeWords = (facet: ItemFacetId, values: readonly FacetValue[]): string[] =>
    values.filter(value => isFacetOn(props.query, facet, value.key)).map(value => t(value.label))

  return (
    <div className={css.itemFilterRow} role="group" aria-label={t('item.filter.label')}>
      <div className={css.itemFilterSelect}>
        <span className={css.itemFacetName}>{t('item.sort.label')}</span>
        <select
          className={css.itemInput}
          value={props.sort}
          aria-label={t('item.sort.label')}
          onChange={event => { props.onSort(event.target.value as ItemSort) }}
        >
          {ITEM_SORTS.map(sort => <option key={sort} value={sort}>{t(SORT_LABEL[sort])}</option>)}
        </select>
      </div>

      {/* The same control, seven times over, for the band with room for it. It
          STAYS OPEN: the ordering is the frame the rows are read in, and hiding
          it behind a disclosure would make the reader open a control to find out
          what they are already looking at. */}
      <div className={css.itemFilterWide}>
        <Segmented
          ariaLabel={t('item.sort.label')}
          value={props.sort}
          options={ITEM_SORTS.map(sort => ({ value: sort, label: t(SORT_LABEL[sort]) }))}
          onChange={next => { props.onSort(next as ItemSort) }}
        />
      </div>

      {ITEM_FACETS.map(facet => (
        <FacetGroup key={facet.id} label={t(facet.label)} active={activeWords(facet.id, facet.values)}>
          {chips(facet.id, facet.values)}
        </FacetGroup>
      ))}

      {/* The tag facet only exists when the document has tags. An empty row of
          nothing is a row that says 「there are no tags」, which is a claim about
          the document that the row itself cannot make. */}
      {tagValues.length > 0 && (
        <FacetGroup
          label={t('item.facet.tag')}
          active={tagValues.filter(value => isFacetOn(props.query, 'tag', value.key)).map(value => value.text)}
        >
          {tagValues.map((value: TagFacetValue) => (
            <FacetChip
              key={value.token}
              token={value.token}
              text={value.text}
              on={isFacetOn(props.query, 'tag', value.key)}
              onToggle={() => toggle(value.token, !isFacetOn(props.query, 'tag', value.key))}
            />
          ))}
        </FacetGroup>
      )}

      {props.filtering && (
        <Button onClick={props.onClear} variant="ghost" size="sm" className={css.itemClearFilter}>
          {t('item.filter.clear')}
        </Button>
      )}
    </div>
  )
}
