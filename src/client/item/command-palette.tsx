/**
 * The command palette: search, ordering, facets and actions, in one box.
 *
 * WHY THE SEARCH BOX MOVED IN HERE, and it is a budget argument before it is a
 * taste one. The spine spent about 190px on a search field, a segmented strip of
 * six orders and a row of filter chips — every one of it standing between the
 * reader and the first row of their work, which is the one thing this panel is
 * for. Those controls are not gone: `⌘K` reaches all of them in two keystrokes.
 * The reading is that a control the reader has to look for is worth less than a
 * control they can call, and a panel whose first screen is its own toolbar is a
 * panel whose first impression is a set of buttons.
 *
 * IT IS ONE BOX, NOT FOUR CONTROLS IN A LAYER. Search, ordering, the facets and
 * the actions are the same kind of thing — 「a thing I can ask for」 — and a
 * palette showing only a search field would be the search box with a dialog
 * around it, which is the 190px problem wearing a costume.
 *
 * THE STATE IS THE PANEL'S, NOT THE PALETTE'S. The query, the ordering and the
 * selection all live where they already lived and this component is handed
 * callbacks, so closing the palette cannot lose a filter and a filter set from
 * the panel and the same filter typed in the palette are the same string through
 * the same writer. A second copy of the query here would be a second answer to
 * 「what is filtered」 on one screen.
 *
 * NOTHING HERE DECIDES ANYTHING ABOUT A ROW. The palette names ACTIONS; what a
 * filter means is `core/item-view.ts`'s and what a write does is
 * `core/item-transitions.ts`'s, read here and by `taskboard_query` alike.
 */
import { useEffect, useRef } from 'react'
import { ITEM_SORTS, itemRefOf, type ItemQuery, type ItemSort } from '../../core/item-view.ts'
import { ITEM_PRIORITIES, itemTitleOf, type ItemRecord } from '../../core/item.ts'
import { freeTextOf, isFacetOn, ITEM_FACETS, queryChipsOf, tagFacetValuesOf, withFacetToken } from './facets.ts'
import { ItemQueryChips } from './query-chips.tsx'
import { PRIORITY_LABEL, SORT_LABEL } from './labels.ts'
import { ITEM_KEYS, keysInGroup } from './keyboard.ts'
import { t } from '../locales.ts'
import { Button } from '../board/ui.tsx'
import css from './item.module.css'

/** One answer in the palette: a label, and what pressing it does. */
export interface PaletteAction {
  readonly id: string
  readonly label: string
  readonly run: () => void
}

export interface ItemCommandPaletteProps {
  readonly open: boolean
  /** The whole query, exactly as the reader typed it. The ONLY state. */
  readonly text: string
  readonly onText: (next: string) => void
  readonly query: ItemQuery
  readonly tags: readonly (readonly string[])[]
  readonly sort: ItemSort
  readonly onSort: (next: ItemSort) => void
  /** Set a priority on whatever the cursor is on. Undefined before a row is chosen. */
  readonly onPriority: ((priority: ItemRecord['priority']) => void) | undefined
  /** The rows to offer as jump targets. */
  readonly rows: readonly ItemRecord[]
  readonly actions: readonly PaletteAction[]
  readonly onPickRow: (id: string) => void
  readonly onClose: () => void
}

export function ItemCommandPalette(props: ItemCommandPaletteProps) {
  const input = useRef<HTMLInputElement | null>(null)
  // The caret goes to the box, because the box is what a reader opened a palette
  // to type into, and a palette that opens with the focus nowhere makes them
  // reach for the mouse to do the thing they opened it for.
  useEffect(() => {
    if (props.open) input.current?.focus()
  }, [props.open])
  if (!props.open) return null

  const typed = freeTextOf(props.text).toLowerCase()
  const hits = (label: string): boolean => typed === '' || label.toLowerCase().includes(typed)
  /* THE VOCABULARY IS NOT FILTERED BY WHAT THE READER TYPED, and that is the whole
     reading of this box. Typing narrows the TARGETS — the rows you can jump to
     and the actions you can run — and leaves the facets, the orders and the
     priorities standing. The first version filtered everything, so typing one word
     made the entire vocabulary vanish: a reader who opened the palette and typed
     「画廊」 saw the rows they matched and nothing else. That is right for a
     launcher and wrong for a box whose other half is 「the filters this surface
     understands」 — a palette that hides its own grammar the moment you start
     using it is one you have to close and reopen in order to think. */
  const tagValues = tagFacetValuesOf(props.tags)
  const facets = ITEM_FACETS
  const sorts = ITEM_SORTS
  const priorities = ITEM_PRIORITIES
  const answers = props.actions.filter(action => hits(action.label))
  const rows = props.rows.filter(row => hits(itemTitleOf(row))).slice(0, 8)
  // A qualifier chip is something the reader can take OFF, so a palette holding
  // a filter it cannot undo is not an empty palette — it is a trap. The count
  // therefore includes the chips, which is why this asks the same function the
  // chip component draws from.
  const nothing = facets.length === 0 && tagValues.length === 0 && sorts.length === 0
    && priorities.length === 0 && answers.length === 0 && rows.length === 0
    && queryChipsOf(props.text, props.tags).length === 0

  return (
    <div className={css.itemCommandPalette} role="dialog" aria-modal="true" aria-label={t('item.palette.title')}>
      <div className={css.itemCommandPaletteBox}>
        <input
          ref={input}
          className={css.itemSearch}
          value={freeTextOf(props.text)}
          placeholder={t('item.search')}
          aria-label={t('item.search.label')}
          onChange={event => { props.onText(withFacetToken(freeTextOf(props.text), event.target.value, true)) }}
          onKeyDown={event => { if (event.key === 'Escape') props.onClose() }}
        />

        {/* THE SAME CHIP COMPONENT the spine used, and not a second rendering of
            it. The palette was written with these chips INLINED, which left
            `query-chips.tsx` imported by nobody while both copies answered the
            same question — the day 「take a qualifier off」 gains a behaviour, one
            of the two would have it and the other would not, and the one that did
            would be whichever a reader happened to meet. One component, reached
            from here. */}
        <ItemQueryChips
          text={props.text}
          tags={props.tags}
          onSearch={props.onText}
          onClearQualifiers={() => { props.onText(freeTextOf(props.text)) }}
        />

        {facets.map(facet => (
          <div key={facet.id} className={css.itemFacetRow} data-palette-group="facets">
            <span className={css.itemFacetName}>{t(facet.label)}</span>
            <div className={css.itemFacetValues}>
              {facet.values.map(value => (
                <button
                  key={value.token}
                  type="button"
                  className={css.itemFacetChip}
                  aria-pressed={isFacetOn(props.query, facet.id, value.key)}
                  onClick={() => { props.onText(withFacetToken(props.text, value.token, !isFacetOn(props.query, facet.id, value.key))) }}
                >
                  {t(value.label)}
                </button>
              ))}
            </div>
          </div>
        ))}

        {tagValues.length > 0 && (
          <div className={css.itemFacetRow} data-palette-group="facets">
            <span className={css.itemFacetName}>{t('item.facet.tag')}</span>
            <div className={css.itemFacetValues}>
              {tagValues.map(value => (
                <button
                  key={value.token}
                  type="button"
                  className={css.itemFacetChip}
                  aria-pressed={isFacetOn(props.query, 'tag', value.key)}
                  onClick={() => { props.onText(withFacetToken(props.text, value.token, !isFacetOn(props.query, 'tag', value.key))) }}
                >
                  {value.text}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* THE FOUR FACET FACES ARE ONE BLOCK, and they have to be ADJACENT in the
            DOM to read as one. They used to be interrupted by the ordering row,
            so the status / priority / date / tag group was split into two pieces
            with a different thing in the middle — and **spacing can express 「there
            is a gap here」 but it cannot move one thing out from between two
            others.** Priority therefore comes before the ordering, and the
            ordering starts the second block.
            `data-palette-group` says which block a row belongs to, because
            grouping is the CALLER's knowledge and the stylesheet cannot invent it
            from four identical rows. */}
        {priorities.length > 0 && props.onPriority !== undefined && (
          <div className={css.itemFacetRow} data-palette-group="facets">
            <span className={css.itemFacetName}>{t('item.facet.priority')}</span>
            <div className={css.itemFacetValues}>
              {priorities.map(priority => (
                <button key={priority} type="button" className={css.itemFacetChip} onClick={() => { props.onPriority?.(priority); props.onClose() }}>
                  {t(PRIORITY_LABEL[priority])}
                </button>
              ))}
            </div>
          </div>
        )}

        {sorts.length > 0 && (
          <div className={css.itemFacetRow} data-palette-group="sort">
            <span className={css.itemFacetName}>{t('item.sort.label')}</span>
            <div className={css.itemFacetValues}>
              {sorts.map(order => (
                <button
                  key={order}
                  type="button"
                  className={css.itemFacetChip}
                  aria-pressed={order === props.sort}
                  onClick={() => props.onSort(order)}
                >
                  {t(SORT_LABEL[order])}
                </button>
              ))}
            </div>
          </div>
        )}

        {answers.length > 0 && (
          <div className={css.itemFacetRow} data-palette-group="actions">
            <span className={css.itemFacetName}>{t('item.palette.act')}</span>
            <div className={css.itemFacetValues}>
              {answers.map(action => (
                <Button key={action.id} variant="ghost" size="sm" className={css.itemFacetChip} onClick={() => { action.run(); props.onClose() }}>
                  {action.label}
                </Button>
              ))}
            </div>
          </div>
        )}

        {rows.length > 0 && (
          <div className={css.itemFacetRow} data-palette-group="rows">
            <span className={css.itemFacetName}>{t('item.palette.rows')}</span>
            <div className={css.itemFacetValues}>
              {rows.map(row => (
                <button
                  key={row.id}
                  type="button"
                  className={css.itemFacetChip}
                  onClick={() => { props.onPickRow(row.id); props.onClose() }}
                >
                  {itemRefOf(row).text ?? '—'} {itemTitleOf(row)}
                </button>
              ))}
            </div>
          </div>
        )}

        {nothing && <p className={css.itemHint}>{t('item.palette.nothing')}</p>}

        {/* THE KEYS, printed from the map rather than written out, so the list
            cannot describe a shortcut the registrar does not answer. */}
        <p className={css.itemHint} data-palette-keys={ITEM_KEYS.length}>
          {keysInGroup('write').map(binding => (
            <span key={binding.keys} className={css.itemHint}>{binding.keys} {t(binding.what as never)} </span>
          ))}
        </p>
        <p className={css.itemHint}>{t('item.palette.hint')}</p>
      </div>
    </div>
  )
}
