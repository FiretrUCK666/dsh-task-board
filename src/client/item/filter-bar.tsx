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
  /**
   * THE BATCH'S DOOR, and it lives here rather than on a row.
   *
   * A resident pickbox would make every row on every page pay 28px for a control
   * most readers never want, and a pickbox that appears with nothing to announce
   * it is worse. So the reader asks for the batch ONCE, here, and every row then
   * shows a pickbox INSTEAD of its state dot — one track, two states, and the
   * list's left edge moves once for the whole list.
   *
   * Select-all sits in the same reach, because a reader who wanted everything
   * should not have to find a second control for it — and it counts only the rows
   * on screen, so a narrowed filter can never produce a bar that says 「选了
   * 40 条」 over a list of eight.
   */
  readonly armed: boolean
  readonly onArm: (on: boolean) => void
  readonly allPicked: boolean
  readonly onPickAll: (on: boolean) => void
  /** Whether there is anything on screen to select at all. */
  readonly selectable: boolean
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
function FacetRow(props: {
  readonly label: string
  readonly children: React.ReactNode
}) {
  return (
    <div className={css.itemFacetRow}>
      <span className={css.itemFacetName}>{props.label}</span>
      <div className={css.itemFacetValues}>{props.children}</div>
    </div>
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

  /** Every face that has something on it, named once, in reading order. */
  const activeFaces = [
    ...ITEM_FACETS.flatMap(facet => activeWords(facet.id, facet.values)),
    ...tagValues.filter(value => isFacetOn(props.query, 'tag', value.key)).map(value => value.text),
  ]

  return (
    <div className={css.itemFilterRow} role="group" aria-label={t('item.filter.label')}>
      {/* The batch door, FIRST — the row that leads the bar is the one that
          changes what every row below it is, and it is the only control here that
          is about the list rather than about the reading. */}
      {props.selectable && (
        <>
          <button
            type="button"
            className={css.itemFacetToggle}
            aria-pressed={props.armed}
            onClick={() => props.onArm(!props.armed)}
          >
            {t(props.armed ? 'item.batch.armed' : 'item.batch.arm')}
          </button>
          {/* Only while the batch is on: a select-all over rows that have no
              pickbox is a control for something the reader cannot see. */}
          {props.armed && (
            <span
              className={css.itemPick}
              data-picked={props.allPicked ? '' : undefined}
              role="checkbox"
              aria-checked={props.allPicked}
              aria-label={t(props.allPicked ? 'item.batch.allDone' : 'item.batch.all')}
              onClick={() => props.onPickAll(!props.allPicked)}
            />
          )}
        </>
      )}
      {/* ONE ORDERING CONTROL, IN BOTH BANDS. It used to be two: a `<select>` at
          the base band and this segmented row from 720, with the container query
          hiding one and showing the other. That is the move rule 11 bans outright
          — a second component for the narrow band — and it was not necessary,
          because the shared segmented row already WRAPS.

          MEASURED, and the note that used to sit here was WRONG: it claimed 「seven
          named orders on a 342px line is two lines」. On a 390px phone the row
          measures THREE lines and 111px. Shortening the three long labels (最早开始,
          优先级, 出生时刻 → 最早, 优先, 出生) was tried and changed the height by
          ZERO, so the labels were put back — **a change that buys nothing
          measurable is not a change.**

          The height is not the LABELS. This bar has three children — the batch-arm
          toggle, the ordering block, and the filter facet — and the arm toggle, one
          short word, is taking a LINE TO ITSELF on a phone. That is the whole of
          the waste, and the fix is to let it share the line it is already on the
          edge of. */}
      <div className={css.itemFilterWide}>
        <Segmented
          ariaLabel={t('item.sort.label')}
          value={props.sort}
          options={ITEM_SORTS.map(sort => ({ value: sort, label: t(SORT_LABEL[sort]) }))}
          onChange={next => { props.onSort(next as ItemSort) }}
        />
      </div>

      {/* ONE DISCLOSURE FOR THE WHOLE FILTER SET, and the reason is not tidiness.
          One disclosure per face was the first shape, and it is a trap: opening the
          third face changed where the other three sat, so the bar you had just
          learned to read rearranged itself under your hand — on a phone, faces
          appeared to vanish and then to reappear. Four independent open/closed
          states is four pieces of state describing ONE thing the reader thinks of
          as 「the filters」. So the set is one control and one panel, and inside
          the panel every face is a ROW with a fixed label column: the labels
          line up with each other, which is the only way four rows of different
          lengths can be read as one list. */}
      <details className={css.itemFacetPanel}>
        <summary className={css.itemFacetToggle} data-active={activeFaces.length > 0 ? '' : undefined}>
          <span className={css.itemFacetName}>{t('item.filter.label')}</span>
          {activeFaces.length > 0 && (
            <span className={css.itemFacetActive}>{activeFaces.join(' · ')}</span>
          )}
        </summary>
        <div className={css.itemFacetPanelBody}>
          {ITEM_FACETS.map(facet => (
            <FacetRow key={facet.id} label={t(facet.label)}>
              {chips(facet.id, facet.values)}
            </FacetRow>
          ))}

          {/* The tag face only exists when the document has tags. An empty row of
              nothing is a row that says 「there are no tags」, which is a claim
              about the document that the row itself cannot make. */}
          {tagValues.length > 0 && (
            <FacetRow label={t('item.facet.tag')}>
              {tagValues.map((value: TagFacetValue) => (
                <FacetChip
                  key={value.token}
                  token={value.token}
                  text={value.text}
                  on={isFacetOn(props.query, 'tag', value.key)}
                  onToggle={() => toggle(value.token, !isFacetOn(props.query, 'tag', value.key))}
                />
              ))}
            </FacetRow>
          )}
        </div>
      </details>

      {props.filtering && (
        <Button onClick={props.onClear} variant="ghost" size="sm" className={css.itemClearFilter}>
          {t('item.filter.clear')}
        </Button>
      )}
    </div>
  )
}
