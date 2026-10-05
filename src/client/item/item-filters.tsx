/**
 * The filter bar — THE ONLY PLACE A FILTER LIVES.
 *
 * WHY IT IS HERE AND NOT IN THE PALETTE. A filter the reader has to open a box to
 * find is a filter that exists in two places the moment anything else needs one.
 * The palette used to draw all four faces; the command palette also prints what
 * the reader is already filtered by. Two places, one setting, and a reader who
 * filtered in one and looked in the other finds the wrong rows. So: the bar owns
 * the filters, the palette owns 「what can I ask for」, and the palette says which
 * filters are ON by echoing them as chips rather than by drawing a second set of
 * buttons.
 *
 * WHY THE CHIPS ECHO UNDER THE BAR AND NOT INSIDE THE PALETTE ONLY. The bar is
 * the control; the chips are the sentence. A reader who filtered from the bar can
 * still see — and take off — exactly what they filtered by, without opening
 * anything.
 *
 * WHY THE ORDER IS A MENU. Six orders in a segmented strip is a strip that eats the
 * first screen to say something the current value already says. The bar carries
 * the current order as its own button and the five others behind it.
 */
import { useEffect, useRef, useState } from 'react'
import { ITEM_SORTS, type ItemSort } from '../../core/item-view.ts'
import { freeTextOf, isTokenIn, withFacetToken } from './facets.ts'
import { SORT_LABEL } from './labels.ts'
import { ItemQueryChips } from './query-chips.tsx'
import { t, type TaskBoardKey } from '../locales.ts'
import css from './item.module.css'

/**
 * One facet's values, as buttons. The label is a DICTIONARY KEY and not a word,
 * so the caller hands over the model's own key rather than a string this file
 * would have to recognise — a union written here is a second list of the four
 * faces, and it goes stale the day the model grows one.
 */
interface Face {
  readonly id: string
  readonly label: TaskBoardKey
  readonly values: readonly { readonly token: string; readonly key: string; readonly label: string }[]
}

/**
 * THE ID OF AN OPEN FACE, derived rather than written twice.
 *
 * The button that opens a face and the region it opens are two elements in two
 * places in this file, and `aria-controls` is the only thing that ties them
 * together — so the name is computed once from the face id rather than pasted
 * into both, because a pair of matching strings nobody checks is a pair that
 * stops matching the first time one of them is edited.
 *
 * `sort` shares the table with the four faces on purpose: it opens the same kind
 * of region in the same place, and giving it its own spelling would be a second
 * namespace for one mechanism.
 * @param faceId - the face, or `sort`.
 * @returns the element id.
 */
function facePanelId(faceId: string): string {
  return `item-facet-${faceId}`
}

export interface ItemFiltersProps {
  /** The four faces, already reduced to what this document actually holds. */
  readonly faces: readonly Face[]
  /** The whole query, exactly as it stands. The ONLY state. */
  readonly text: string
  readonly onSearch: (next: string) => void
  readonly sort: ItemSort
  readonly onSort: (next: ItemSort) => void
  readonly tags: readonly (readonly string[])[]
  /** Whether completed rows are shown on the list page. */
  readonly showDone: boolean
  readonly onShowDone: (next: boolean) => void
  /** How many rows the filter leaves, for the count beside each open face. */
  readonly countOf: (token: string) => number
}

/**
 * The bar.
 * @param props - the query, the four faces, the order and the finished switch.
 * @returns the bar, the open face's values, and the echo of what is filtered.
 */
export function ItemFilters(props: ItemFiltersProps) {
  const [open, setOpen] = useState<string | undefined>(undefined)
  const bar = useRef<HTMLDivElement | null>(null)
  // A press anywhere else closes an open face. A filter face left open over the
  // rows it filters is a floating layer with nothing under it holding it up.
  useEffect(() => {
    if (open === undefined) return
    const away = (event: Event): void => {
      if (!bar.current?.contains(event.target as Node)) setOpen(undefined)
    }
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(undefined) }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  /**
   * A bar button TOGGLES, exactly as a palette option does.
   *
   * It used to append. So a reader who picked 「状态 受阻」 from the bar, saw the
   * list narrow, pressed it again because they wanted it off — and got a second
   * copy of the same token instead, while `aria-pressed` said 「on」 and the chip
   * row below said the filter was one thing. Two places wrote the same edit and
   * only one of them toggled, so the bar and the palette answered one press
   * differently. One writer now: {@link withFacetToken}, which the palette
   * already used.
   */
  const toggle = (next: string, token: string): string => withFacetToken(next, token, !isTokenIn(next, token))
  const chips = (
    <ItemQueryChips
      text={props.text}
      tags={props.tags}
      onSearch={props.onSearch}
      /* `freeTextOf` asks the GRAMMAR which tokens are qualifiers, rather than
         guessing with prefixes. The guess was written for `#tag` and `!1`..`!4`
         and never learned `p1`..`p4`, the same four tiers spelled the other
         way — so 「清空筛选」 left every priority in the box and the chip row went
         on listing them. */
      onClearQualifiers={() => { props.onSearch(freeTextOf(props.text)) }}
    />
  )

  return (
    <div ref={bar}>
      <div className={css.itemFilters} role="group" aria-label={t('item.filters.label')}>
        <span className={css.itemFiltersLabel}>{t('item.filters.label')}</span>
        {props.faces.map(face => {
          const live = face.values.filter(value => isTokenIn(props.text, value.token))
          const isOpen = open === face.id
          return (
            <button
              key={face.id}
              type="button"
              className={css.itemFilterButton}
              data-open={isOpen ? '' : undefined}
              aria-expanded={isOpen}
              /* 「已展开」而没有「展开的是哪一块」，是一句读者接不上的话。指向
                 它自己管的那一栏，于是这一行从按下到出现是一条可追踪的线。 */
              aria-controls={facePanelId(face.id)}
              onClick={() => setOpen(isOpen ? undefined : face.id)}
            >
              {t(face.label)}
              {live.length > 0 && <span className={css.itemFilterCount}>{live.length}</span>}
            </button>
          )
        })}
        {/* 排序：当前那一档写在按钮上，其余五档在它后面。 */}
        <button
          type="button"
          className={css.itemSortButton}
          aria-expanded={open === 'sort'}
          aria-controls={facePanelId('sort')}
          onClick={() => setOpen(open === 'sort' ? undefined : 'sort')}
        >
          {t('item.sort.label')} · {t(SORT_LABEL[props.sort])}
        </button>
        {/* 「隐藏已完成」的勾选框说的是隐藏，而不是显示：勾上 = 藏起来。状态本身仍叫
            `showDone`，因为切片要的是「要不要把做完的行算进去」；把标签的极性反过来
            写，就是让一个有着「隐藏」名字的开关去读「显示」的状态。 */}
        <label className={css.itemHideDone}>
          <input type="checkbox" checked={!props.showDone} onChange={event => props.onShowDone(!event.target.checked)} />
          {t('item.done.show')}
        </label>
      </div>

      {open === 'sort' && (
        <div id={facePanelId('sort')} className={css.itemFilters} role="group" aria-label={t('item.sort.label')}>
          {ITEM_SORTS.map(order => (
            <button
              key={order}
              type="button"
              className={css.itemFilterButton}
              data-open={order === props.sort ? '' : undefined}
              aria-pressed={order === props.sort}
              onClick={() => { props.onSort(order); setOpen(undefined) }}
            >
              {t(SORT_LABEL[order])}
            </button>
          ))}
        </div>
      )}

      {open !== undefined && open !== 'sort' && (
        <div id={facePanelId(open)} className={css.itemFilters} role="group" aria-label={t('item.filters.label')}>
          {props.faces.filter(face => face.id === open).flatMap(face => face.values.map(value => (
            <button
              key={value.token}
              type="button"
              className={css.itemFilterButton}
              aria-pressed={isTokenIn(props.text, value.token)}
              onClick={() => { props.onSearch(toggle(props.text, value.token)) }}
            >
              {value.label}
              <span className={css.itemFilterCount}>{props.countOf(value.token)}</span>
            </button>
          )))}
        </div>
      )}

      {chips}
    </div>
  )
}
