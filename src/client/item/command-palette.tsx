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
 *
 * ── THE THINGS THIS BOX USED TO GET WRONG, AND WHY THEY ARE WRITTEN THIS WAY ──
 *
 * **THE MASK HAD NO WAY OUT.** The root element was a full-screen `dialog` with
 * not one handler on it: clicking the dimmed area outside the box did nothing,
 * so a reader who opened it with the mouse and changed their mind had nothing to
 * press. A modal surface that declares `aria-modal` owes the reader two things —
 * a way to dismiss it, and its focus back — so the mask answers a press that
 * LANDED ON IT (`target === currentTarget`), and {@link ItemCommandPaletteProps.onClosed}
 * hands the caller the moment to give the focus back.
 *
 * **THE FOOTNOTE PROMISED KEYS THAT DID NOTHING.** It said 「回车执行」 over a
 * screen with no selection anywhere on it: no `activeIndex`, no `Enter` handler,
 * no such thing. A sentence under an interface is a claim about that interface,
 * and this one was false. So the claim is now true: there IS a candidate cursor,
 * `↑` `↓` move it, `↵` runs it, and the footnote describes the machinery that
 * exists.
 *
 * **TWO ROWS BOTH CALLED 「优先级」.** One filtered by priority and the other
 * ASSIGNED priority to the row under the cursor — same word, opposite order, same
 * shape, side by side. The filtering row is gone from this box (it belongs on the
 * spine, where a filter belongs) and the assigning row says what it does.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ITEM_SORTS, itemRefOf, type ItemQuery, type ItemSort } from '../../core/item-view.ts'
import { ITEM_PRIORITIES, itemTitleOf, type ItemRecord } from '../../core/item.ts'
import { freeTextOf, isFacetOn, ITEM_FACETS, tagFacetValuesOf, withFacetToken } from './facets.ts'
import { ItemQueryChips } from './query-chips.tsx'
import { PRIORITY_LABEL, SORT_LABEL } from './labels.ts'
import { ItemKeyHelp } from './key-help.tsx'
import { t, type TaskBoardKey } from '../locales.ts'
import css from './item.module.css'

/** One answer in the palette: a label, and what pressing it does. */
export interface PaletteAction {
  /**
   * The action's own name, and the only thing the palette routes on.
   *
   * A `page-` id is a way to GET somewhere and lands on its own row; every other
   * id is something to DO and lands on the actions row. One convention, in the
   * name the panel already gives each action, rather than a second list the two
   * halves would have to keep in step.
   */
  readonly id: string
  readonly label: string
  readonly run: () => void
}

/** ONE THING THE CURSOR CAN BE ON. Every pressable word in this box is one. */
interface PaletteOption {
  /** Stable, so the cursor can name it and React can keep its node. */
  readonly id: string
  readonly label: string
  /** Whether this option is a switch that is currently on. */
  readonly pressed: boolean
  /** What a press does — including closing the box, where that is what it does. */
  readonly run: () => void
}

/** ONE ROW OF WORDS, and the name that row goes by. */
interface PaletteGroup {
  /** Stable, and the `data-palette-group` the stylesheet reads. */
  readonly id: string
  /**
   * WHETHER THIS ROW IS THE GRAMMAR OR AN ANSWER.
   *
   * `words` is the vocabulary — the facets, the orders, the priority the reader
   * can put on the row under the cursor. `answers` is what a search returns: a
   * page to go to, an action to run, a row to jump to. This is the one fact that
   * decides both what typing narrows and what the cursor walks, so it is declared
   * on the row rather than recovered from an id — a filter that has to recognise
   * ids by their first letters is a filter that breaks when an id is renamed.
   */
  readonly kind: 'words' | 'answers'
  /** The row's short name, printed in the name column. */
  readonly name: TaskBoardKey
  /** The row's full name, for the group a screen reader announces. */
  readonly full: TaskBoardKey
  readonly options: readonly PaletteOption[]
}

/**
 * WHAT THE PANEL'S KEY MAP CAN ASK OF THE BOX.
 *
 * The candidate cursor is state HERE — it is derived from this component's own
 * text, this component's own options — so the map cannot compute it and the box
 * cannot be navigated by a table that has never seen a candidate. So the box
 * publishes the four commands and the panel calls them: one direction, no second
 * copy of the candidate list, and no callback that reaches back into this
 * component's state by another name.
 */
export interface PaletteCommands {
  /** Move the candidate cursor, wrapping at both ends. */
  readonly step: (by: number) => void
  /** Run the candidate under the cursor. */
  readonly pick: () => void
  /** Open the key help sheet. */
  readonly showKeys: () => void
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
  /**
   * The palette has just closed, and the focus is owed to whatever opened it.
   *
   * A MODAL SURFACE OWES THE FOCUS BACK, and the box cannot give it back to a
   * button it does not own: the reader pressed `⌘K` and the focus is in a field
   * they cannot see from, so closing it leaves the panel with no focus at all and
   * the next key they press answers to nothing. The caller knows which control
   * opened the box, so it takes this call and gives the focus to that control.
   */
  readonly onClosed?: () => void
  /**
   * The candidate cursor, as commands — see {@link PaletteCommands}. Optional
   * because a caller that renders the palette without the key map (a screenshot,
   * a story) has nothing to call them with.
   */
  readonly onCommands?: (commands: PaletteCommands | undefined) => void
}

/** Whether a label matches what the reader typed. An empty box matches everything. */
function hits(typed: string, label: string): boolean {
  return typed === '' || label.toLowerCase().includes(typed)
}

/**
 * THE CURSOR'S POOL, and the rule that decides which rows it walks.
 *
 * WITH NOTHING TYPED the cursor walks every row in reading order, because then
 * the whole box is one list and 「what does ↓ reach」 has the answer 「the next
 * thing on screen」.
 *
 * WITH SOMETHING TYPED it walks only the ANSWERS, because a narrowed search has
 * one answer and the vocabulary is not it. This is the same reading as the row
 * above it — typing narrows the targets and leaves the facets, the orders and the
 * priorities standing — and it is what makes 「type 日程, press Enter」 land on the
 * page rather than on the first filter chip above it. The vocabulary is still on
 * screen and still one click away; it is simply not what the cursor is choosing
 * between while a search is running.
 */
function poolOf(groups: readonly PaletteGroup[], typed: string): readonly PaletteOption[] {
  return groups
    .filter(group => typed === '' || group.kind === 'answers')
    .flatMap(group => group.options)
}

export function ItemCommandPalette(props: ItemCommandPaletteProps) {
  const input = useRef<HTMLInputElement | null>(null)
  const [active, setActive] = useState(0)
  const [keysOpen, setKeysOpen] = useState(false)
  // The text this cursor was last placed against. A changed query means a
  // different list, so the cursor goes back to its first row rather than staying
  // on a position that now belongs to something else — which is why this is a
  // remembered fact and not a second piece of state derived from the props.
  const [placedAt, setPlacedAt] = useState(props.text)
  // `useId` returns something containing colons, which are legal in an id and
  // illegal in a selector — and `aria-controls` / `aria-activedescendant` are
  // matched by selector, so the name is reduced to what a selector can hold.
  const listboxId = `palette-${useId().replace(/[^a-zA-Z0-9]/g, '')}`

  const typed = freeTextOf(props.text).toLowerCase()

  // THE CURSOR GOES HOME WHEN THE QUERY CHANGES, AND WHEN THE BOX OPENS. React's
  // documented way to adjust state while rendering: setting state during a render
  // is discarded and re-run against the new props, which is exactly one extra pass
  // and never a flash of the old selection against the new list. Both facts are
  // remembered rather than derived, because 「the list I chose from」 is not a
  // value the props carry — it is the list as it was when I chose.
  const [openedAt, setOpenedAt] = useState(props.open)
  if (placedAt !== props.text || openedAt !== props.open) {
    setPlacedAt(props.text)
    setOpenedAt(props.open)
    setActive(0)
  }

  // The caret goes to the box, because the box is what a reader opened a palette
  // to type into, and a palette that opens with the focus nowhere makes them
  // reach for the mouse to do the thing they opened it for.
  useEffect(() => {
    if (props.open) input.current?.focus()
  }, [props.open])

  // THE FOCUS COMES BACK, and only on the way out. Unmounting is not closing:
  // a reader who navigated away from the panel has nothing to give the focus to,
  // and reaching for a button that is no longer on the page would be worse than
  // doing nothing.
  const closedBy = useRef(props.open)
  useEffect(() => {
    if (closedBy.current && !props.open) props.onClosed?.()
    closedBy.current = props.open
  }, [props.open])

  const groups = useMemo<readonly PaletteGroup[]>(() => {
    const out: PaletteGroup[] = []
    /* THE PRIORITY FILTER IS NOT DRAWN HERE, and the row is not missing — it
       moved. The grammar keeps `p1`..`p4` (core reads them, and so does the
       model's own query), but a filter belongs on the spine where the current
       filter is already stated, and the one place it cannot live is under a row
       that ASSIGNS a priority: two rows, same word, opposite order, same shape,
       and nothing on screen to tell a reader which one they were reading. */
    for (const facet of ITEM_FACETS.filter(one => one.id !== 'priority')) {
      out.push({
        id: `facet-${facet.id}`,
        kind: 'words',
        name: facet.label,
        full: facet.label,
        options: facet.values.map(value => ({
          id: `${facet.id}-${value.key}`,
          label: t(value.label),
          pressed: isFacetOn(props.query, facet.id, value.key),
          run: () => { props.onText(withFacetToken(props.text, value.token, !isFacetOn(props.query, facet.id, value.key))) },
        })),
      })
    }
    const tagValues = tagFacetValuesOf(props.tags)
    if (tagValues.length > 0) {
      out.push({
        id: 'facet-tag',
        kind: 'words',
        name: 'item.facet.tag',
        full: 'item.facet.tag',
        options: tagValues.map(value => ({
          id: `tag-${value.key}`,
          label: value.text,
          pressed: isFacetOn(props.query, 'tag', value.key),
          run: () => { props.onText(withFacetToken(props.text, value.token, !isFacetOn(props.query, 'tag', value.key))) },
        })),
      })
    }
    // THE ROW THAT ASSIGNS a priority, and the row that FILTERS by one used to
    // carry the same two words. This one says what it does to WHOM, which is the
    // half the reader cannot see: it writes the row the cursor is on.
    if (props.onPriority !== undefined) {
      out.push({
        id: 'priority-set',
        kind: 'words',
        name: 'item.palette.prioritySet',
        full: 'item.palette.prioritySetName',
        options: ITEM_PRIORITIES.map(priority => ({
          id: `set-${priority}`,
          label: t(PRIORITY_LABEL[priority]),
          pressed: false,
          run: () => { props.onPriority?.(priority); props.onClose() },
        })),
      })
    }
    out.push({
      id: 'sort',
      kind: 'words',
      name: 'item.sort.label',
      full: 'item.sort.label',
      // THE ORDER THAT IS ON IS SAID, NOT TINTED. A background would be the
      // same channel the candidate cursor uses, and two facts drawn the same way
      // are two facts the reader has to tell apart by looking twice.
      options: ITEM_SORTS.map(order => ({
        id: `sort-${order}`,
        label: order === props.sort ? `${t(SORT_LABEL[order])} · ${t('item.palette.onNow')}` : t(SORT_LABEL[order]),
        pressed: order === props.sort,
        run: () => props.onSort(order),
      })),
    })
    // GOING SOMEWHERE AND DOING SOMETHING ARE TWO ROWS. 「收件 / 清单 / 日程」
    // change which page you are on and leave the document alone; 「多选 / 清空
    // 筛选 / 撤销」 act on it. In one row called 「动作」 the reader cannot tell
    // which of the two pressing a word will do.
    for (const [id, name, full] of [
      ['go', 'item.palette.go', 'item.palette.goName'],
      ['act', 'item.palette.act', 'item.palette.act'],
    ] as const) {
      const list = props.actions
        .filter(action => (id === 'go') === action.id.startsWith('page-'))
        .filter(action => hits(typed, action.label))
      if (list.length === 0) continue
      out.push({
        id,
        kind: 'answers',
        name,
        full,
        options: list.map(action => ({
          id: `act-${action.id}`,
          label: action.label,
          pressed: false,
          run: () => { action.run(); props.onClose() },
        })),
      })
    }
    const rows = props.rows.filter(row => hits(typed, itemTitleOf(row))).slice(0, 8)
    if (rows.length > 0) {
      out.push({
        id: 'rows',
        kind: 'answers',
        name: 'item.palette.rows',
        full: 'item.palette.rows',
        options: rows.map((row, index) => ({
          id: `row-${index}`,
          label: `${itemRefOf(row).text ?? '—'} ${itemTitleOf(row)}`,
          pressed: false,
          run: () => { props.onPickRow(row.id); props.onClose() },
        })),
      })
    }
    return out
  }, [props, typed])

  const pool = useMemo(() => poolOf(groups, typed), [groups, typed])
  const cursor = pool.length === 0 ? undefined : pool[Math.min(active, pool.length - 1)]

  const step = useMemo(() => (by: number) => {
    setActive(current => {
      if (pool.length === 0) return 0
      // WRAPS AT BOTH ENDS, because a list whose arrow keys stop at the end is a
      // list that answers 「there is nothing more」 when there is.
      return (Math.min(current, pool.length - 1) + by + pool.length) % pool.length
    })
  }, [pool.length])

  const pick = useMemo(() => () => {
    if (cursor !== undefined) cursor.run()
  }, [cursor])

  const commands = useMemo<PaletteCommands>(() => ({
    step,
    pick,
    showKeys: () => setKeysOpen(true),
  }), [pick, step])
  useEffect(() => {
    props.onCommands?.(commands)
    return () => { props.onCommands?.(undefined) }
  }, [commands, props])

  // Typing narrows the ANSWERS and leaves the vocabulary standing, so the one
  // sentence about an empty box has to be about the answers: the facets are on
  // screen either way, and 「没有匹配的东西」 over a screen showing twelve chips is
  // the sentence that never used to be true and always looked broken.
  const nothing = typed !== '' && groups.every(group => group.kind === 'words' || group.options.length === 0)

  return (
    <>
      <ItemKeyHelp open={keysOpen} onClose={() => setKeysOpen(false)} />
      {props.open && (
        <div
          className={css.itemCommandPalette}
          role="dialog"
          aria-modal="true"
          aria-label={t('item.palette.title')}
          onPointerDown={event => {
            /* `target === currentTarget`, and NOT 「a press that missed the box」:
               a press that starts inside the field and drags out onto the mask
               ends with `target === currentTarget` only on the second event, so
               judging by position instead would close the box under a reader who
               was selecting text. Judging by WHERE THE PRESS LANDED closes it for
               exactly the presses that meant it. */
            if (event.target === event.currentTarget) props.onClose()
          }}
        >
          <div className={css.itemCommandPaletteBox}>
            <input
              ref={input}
              className={css.itemSearch}
              value={freeTextOf(props.text)}
              placeholder={t('item.search')}
              aria-label={t('item.search.label')}
              /* THE COMBOBOX SHAPE, because the caret stays in the field: the
                 reader types a word and then picks from what it found, which is
                 not what a text field with a list of buttons below it tells a
                 screen reader it is. `aria-activedescendant` is what carries the
                 cursor — the caret never leaves the field, so the thing the
                 reader is choosing has to be named from out here. */
              role="combobox"
              aria-expanded="true"
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={cursor === undefined ? undefined : `${listboxId}-${cursor.id}`}
              onChange={event => { props.onText(withFacetToken(freeTextOf(props.text), event.target.value, true)) }}
            />

            {/* THE SAME CHIP COMPONENT the spine used, and not a second rendering
                of it. The palette was written with these chips INLINED, which left
                `query-chips.tsx` imported by nobody while both copies answered the
                same question — the day 「take a qualifier off」 gains a behaviour,
                one of the two would have it and the other would not. */}
            <ItemQueryChips
              text={props.text}
              tags={props.tags}
              onSearch={props.onText}
              onClearQualifiers={() => { props.onText(freeTextOf(props.text)) }}
            />

            {/* THE LISTBOX IS ALSO THE PANEL'S ONLY SCROLLER.
                *
                * 盒子自己不滚，而这一列滚——于是搜索框停在原处，滚动条属于**答案那一列**
                * 而不是属于那个正在打字的框。盒子自己滚的时候，那条滚动条画在盒子内衬
                * 的边上，于是它压着最后一枚芯片，看起来像从这一块面板里穿了出去。
                * 盒子自己不滚，而这一列滚——于是搜索框停在原处，滚动条属于**答案那一列**
                * 而不是属于那个正在打字的框。盒子自己滚的时候，那条滚动条画在盒子内衬
                * 那些东西。 */}
            <div id={listboxId} className={css.itemCommandPaletteList} data-dsh-tb-scroll="" role="listbox" aria-label={t('item.palette.answers')}>
              {groups.map(group => (
                <div key={group.id} className={css.itemFacetRow} data-palette-group={group.id}>
                  <span className={css.itemFacetName}>{t(group.name)}</span>
                  <div className={css.itemFacetValues} role="group" aria-label={t(group.full)}>
                    {group.options.length === 0 ? null : group.options.map(option => {
                      const on = cursor !== undefined && option.id === cursor.id
                      return (
                        <button
                          key={option.id}
                          type="button"
                          id={`${listboxId}-${option.id}`}
                          className={css.itemFacetChip}
                          role="option"
                          aria-selected={on}
                          data-selected={on ? '' : undefined}
                          aria-pressed={option.pressed}
                          onClick={() => option.run()}
                        >
                          {option.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>

            {nothing && <p className={css.itemKeyHelpNothing}>{t('item.palette.nothing')}</p>}

            {/* THE FOOTER IS A SENTENCE AND A DOOR, not a wall of symbols. The key
                table used to be printed here as `A ⌘⌫ ⌘Z`: no word for any of
                them, so a reader who did not already know the table learned
                nothing from it. It is now a thing that opens — from the `?`
                button, which is also the reason the keyboard is not the only way
                in.

                AND IT IS NOT A GROUP. It was drawn as a facet row with an EMPTY
                name cell, borrowing that shape to line the footer up with the
                groups above it — which is what an empty name cell cannot do: the
                row's first track still reserved its width, so the sentence was
                indented by it and sat in the middle of a box whose every other
                line starts at the left edge. **A sentence about how to use the
                whole box, pushed right by a label that does not exist, reads as a
                sentence that does not know where to stand.**
                The footer's left edge is the BOX's left edge, because that is
                what it is about. */}
            <div className={css.itemPaletteFoot}>
              <p className={css.itemPaletteHint}>{t('item.palette.hint')}</p>
              <button
                type="button"
                className={`${css.itemFacetChip} ${css.itemKeyHelpTrigger}`}
                aria-label={t('item.keys.show')}
                title={t('item.keys.show')}
                onClick={() => setKeysOpen(true)}
              >
                <span aria-hidden="true">?</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
