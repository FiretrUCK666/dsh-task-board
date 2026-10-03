/**
 * The key help sheet: every shortcut the panel answers to, in the reader's words.
 *
 * WHY IT EXISTS RATHER THAN BEING PRINTED AT THE BOTTOM OF THE PALETTE. The
 * palette used to end with a line of bare symbols — `A ⌘⌫ ⌘Z` — which is a list
 * of glyphs, not a list of things you can do: no Chinese word, no grouping, no
 * order, and a reader who does not already know what `⌘⌫` means learns nothing
 * from it. A table of shortcuts that is only legible to someone who already knew
 * them is not a reference. So the symbols are gone from the palette and the table
 * itself is a thing you can open, and it says what each key DOES.
 *
 * WHY IT PRINTS THE MAP RATHER THAN LISTING KEYS. The list is generated from
 * `ITEM_KEYS`, grouped by that table's own `KeyGroup`. A hand-written copy is a
 * second truth about which shortcuts exist, and the drift is invisible: the copy
 * keeps promising a key the registrar stopped answering, and the day the registrar
 * stops answering it, the copy is the only thing still making the promise. This
 * file cannot name a shortcut that does not exist, because it names none.
 *
 * IT IS NOT PART OF THE PALETTE. It is its own overlay beside it: closing this
 * leaves the palette exactly as it was, and closing the palette leaves this one
 * alone. Two layers that share a close gesture would close together, which is
 * what `stopPropagation` below is there to prevent — the topmost layer answers
 * `Esc`, and only the topmost one.
 *
 * IT IS ALSO ITS OWN STATE. Nothing outside this component has to know whether
 * it is open, so the panel does not have to grow a field for it; the palette
 * renders it beside itself and the `?` key reaches it through
 * {@link PaletteCommands.showKeys}.
 */
import { useEffect, useRef } from 'react'
import { ITEM_KEYS, type KeyBinding, type KeyGroup } from './keyboard.ts'
import { t } from '../locales.ts'
// 这张表并进了 `item.module.css`：它原本一半装的是新建弹层（已改名
// `itemCreateDialog*`，落在那边），另一半是这张键位表，而两者**共用同一块遮罩**。
// 一个只装两样、而那两样共用一个零件的样式表，是把「浮层长什么样」这个答案分成
// 两处的最快办法——而本项目的既定风格是**一个表面对一张样式表**。
import css from './item.module.css'

/** The four groups, in the order a reader meets them: write, look, change, look again. */
const GROUP_ORDER: readonly KeyGroup[] = ['write', 'move', 'edit', 'surface']

/** What each group is FOR, because 「surface」 is a word about the code. */
const GROUP_TITLE: Readonly<Record<KeyGroup, 'item.keys.group.write' | 'item.keys.group.move' | 'item.keys.group.edit' | 'item.keys.group.surface'>> = {
  write: 'item.keys.group.write',
  move: 'item.keys.group.move',
  edit: 'item.keys.group.edit',
  surface: 'item.keys.group.surface',
}

/** One line of the sheet: the key, and what it does. */
interface KeyRow {
  /** Stable across renders so React can keep the node. */
  readonly id: string
  /** The keys, in the spelling the table uses (`⌘K`, `↵`, `↓`). */
  readonly keys: string
  /** What it does, in the reader's language. */
  readonly what: string
}

/** One band of the sheet: its title and its lines, in table order. */
interface KeyBand {
  readonly id: string
  readonly title: string
  readonly rows: readonly KeyRow[]
}

/**
 * THE SHEET, as data.
 *
 * Built once per render from the table, and the table is the only place a
 * shortcut is named. A group with no bindings is left out rather than drawn as a
 * title over nothing, which is the same rule the rest of the panel follows.
 */
function bandsOf(): readonly KeyBand[] {
  return GROUP_ORDER
    .map((group, index) => ({
      id: group,
      title: t(GROUP_TITLE[group]),
      rows: ITEM_KEYS
        .filter((binding: KeyBinding) => binding.group === group)
        .map(binding => ({
          id: `${index}-${group}-${binding.keys}`,
          keys: binding.keys,
          what: t(binding.what),
        })),
    }))
    .filter(band => band.rows.length > 0)
}

export interface ItemKeyHelpProps {
  readonly open: boolean
  readonly onClose: () => void
}

/**
 * The key help sheet.
 *
 * The focus lands on the sheet when it opens, because a dialog the reader cannot
 * reach with `Tab` is not one they are inside — and because `Esc` has to work
 * from wherever they land, which is the same thing said about the keyboard.
 * @param props - whether it is open, and how it is dismissed.
 * @returns the overlay, or nothing.
 */
export function ItemKeyHelp(props: ItemKeyHelpProps) {
  const sheet = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (props.open) sheet.current?.focus()
  }, [props.open])
  /* ONLY THE TOPMOST LAYER ANSWERS `Esc`, and it has to be a NATIVE listener to
     manage that. The panel's key map is one listener on an ancestor of this box,
     and React's own handlers are delegated to the root even further up — so a
     `stopPropagation` written in a React `onKeyDown` runs AFTER the panel's map
     has already taken the event and closed the palette underneath. Two layers, one
     keypress, and the reader loses the box they were standing in.
     A listener on this element runs before both, because it is the closest one
     to the keypress. */
  useEffect(() => {
    const node = sheet.current
    if (node === null || !props.open) return
    const take = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      props.onClose()
    }
    node.addEventListener('keydown', take)
    return () => { node.removeEventListener('keydown', take) }
  }, [props])
  if (!props.open) return null
  const bands = bandsOf()

  return (
    <div
      className={css.itemKeyHelpMask}
      // `target === currentTarget` and not 「outside the box」: a press that
      // starts inside the sheet and drags out to the mask would otherwise close it
      // under the reader's finger, and a press inside the sheet is not a press on
      // the mask at all.
      onPointerDown={event => { if (event.target === event.currentTarget) props.onClose() }}
    >
      <div
        ref={sheet}
        className={css.itemKeyHelpSheet}
        role="dialog"
        aria-modal="true"
        aria-label={t('item.keys.title')}
        tabIndex={-1}
      >
        <header className={css.itemKeyHelpHead}>
          <h2 className={css.itemKeyHelpTitle}>{t('item.keys.title')}</h2>
          <p className={css.itemKeyHelpHint}>{t('item.keys.hint')}</p>
        </header>
        {bands.map(band => (
          <section key={band.id} className={css.itemKeyHelpBand}>
            <h3 className={css.itemKeyHelpBandTitle}>{band.title}</h3>
            <dl className={css.itemKeyHelpList}>
              {band.rows.map(row => (
                <div key={row.id} className={css.itemKeyHelpRow}>
                  <dt className={css.itemKeyHelpKeys}>
                    <kbd className={css.itemKeyHelpKey}>{row.keys}</kbd>
                  </dt>
                  <dd className={css.itemKeyHelpWhat}>{row.what}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  )
}
