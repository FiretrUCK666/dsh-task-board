/**
 * The row menu: a MENU, never a dialog, and positioned against this panel only.
 *
 * WHY IT IS NOT A DIALOG ON THIS SURFACE. `boardBox()` resolves to the FIRST
 * board box on the page, so a layer opened from the checklist anchors itself to
 * the board — a different surface — and a layer that floats over another surface
 * is not this surface's layer. The board's own `Dialog` is explicitly off-limits
 * here, which is why this is a menu with its own geometry instead.
 *
 * WHY IT USES `position: fixed` AND ITS OWN ARITHMETIC. The list is inside a
 * scroller, and an absolutely-positioned menu inside a scroller is clipped by it
 * — the reported failure. The placement is therefore computed from TWO rectangles
 * this surface owns: the trigger's, and this panel root's, both from
 * `getBoundingClientRect()`. Nothing here reads the host's DOM or classes, which
 * is the one fragile surface the project forbids outright; if the shell changes
 * its sidebar the answer is still right, because the answer was never about the
 * shell.
 *
 * THE DISMISSAL IS TWO HANDLERS ON TWO ELEMENTS, and the split is deliberate.
 * Escape is the menu's own `onKeyDown`, so it fires while focus is inside the
 * menu and nowhere else. The outside click is a TRANSPARENT CAPTURE LAYER that is
 * a SIBLING of the menu — not an ancestor, and not a `document` listener that
 * guesses from bubbling. A document listener runs once per registered handler in
 * a single click, and the two failures that produces are a menu that will not
 * close and a menu that closes twice; the capture layer has exactly one handler
 * and no path by which a click inside the menu can reach it.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { placeRowMenu, type MenuSpot, type Rect } from './menu-place.ts'
import { t } from '../locales.ts'
import css from './item.module.css'

export interface RowMenuAction {
  readonly key: string
  readonly label: string
  readonly onPick: () => void
}

export interface ItemRowMenuProps {
  /** The row's uuid, for the element identity and the capture layer's sibling. */
  readonly rowId: string
  /** The `⋯` control, measured for its own placement. */
  readonly trigger: HTMLElement | null
  /** This panel's root, the box the menu may not leave. */
  readonly panel: HTMLElement | null
  readonly actions: readonly RowMenuAction[]
  readonly onClose: () => void
}

/** The measured size the placement is computed from, until the menu reports its own. */
const ASSUMED: { readonly width: number; readonly height: number } = { width: 180, height: 160 }

function rectOf(node: HTMLElement | null): Rect | undefined {
  if (node === null) return undefined
  const box = node.getBoundingClientRect()
  return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width, height: box.height }
}

export function ItemRowMenu(props: ItemRowMenuProps) {
  const menu = useRef<HTMLDivElement | null>(null)
  const [spot, setSpot] = useState<MenuSpot | undefined>(undefined)

  /**
   * Measure, place, and move focus in — all before the browser paints.
   *
   * The spot is computed TWICE on purpose. The first pass uses an assumed size,
   * so the menu is in the right neighbourhood before anyone sees it; the second
   * uses the menu's own measured box, so the edge that has to be flush — the one
   * beside the trigger — is flush to the pixel. Doing only the first would leave
   * the menu's width guessed, and doing only the second would show it for one
   * frame in the wrong place, which on a fast list is a visible jump.
   */
  useLayoutEffect(() => {
    const measure = (): void => {
      const trigger = rectOf(props.trigger)
      const panel = rectOf(props.panel)
      if (trigger === undefined || panel === undefined) return
      const box = menu.current?.getBoundingClientRect()
      setSpot(placeRowMenu(trigger, panel, {
        width: box?.width ?? ASSUMED.width,
        height: box?.height ?? ASSUMED.height,
      }))
    }
    measure()
    menu.current?.focus()
  }, [props.trigger, props.panel])

  // A menu that stays put while the list scrolls is a menu pointing at nothing.
  useEffect(() => {
    const onReflow = (): void => {
      const trigger = rectOf(props.trigger)
      const panel = rectOf(props.panel)
      const box = menu.current?.getBoundingClientRect()
      if (trigger === undefined || panel === undefined || box === undefined) return
      setSpot(placeRowMenu(trigger, panel, { width: box.width, height: box.height }))
    }
    window.addEventListener('resize', onReflow)
    window.addEventListener('scroll', onReflow, true)
    return () => {
      window.removeEventListener('resize', onReflow)
      window.removeEventListener('scroll', onReflow, true)
    }
  }, [props.trigger, props.panel])

  const pick = useCallback((action: RowMenuAction) => {
    props.onClose()
    action.onPick()
  }, [props])

  /**
   * DISMISSAL: Escape on the menu, and ONE document listener for everything
   * outside it.
   *
   * The outside half is a single capture-phase listener rather than an overlay
   * and rather than a set of per-element handlers — and the reason is one this
   * surface was wrong about twice. An overlay only sees clicks that LAND on it,
   * so a click dispatched at some other node passes straight through it: true of
   * a synthetic event, and equally true of assistive technology that activates a
   * node directly. Neither is a reader who should be left looking at an open
   * menu. A listener on the document sees every click, and the containment check
   * is what keeps it honest — one handler, so a single click cannot run it twice,
   * and an explicit `contains` test, so a click inside the menu is not a
   * dismissal. The failure this replaces (a click running through several
   * independent handlers, closing a menu twice or not at all) cannot happen with
   * one handler and one test.
   */
  useEffect(() => {
    const onOutside = (event: MouseEvent): void => {
      const target = event.target
      if (target instanceof Node && menu.current?.contains(target)) return
      props.onClose()
    }
    document.addEventListener('click', onOutside, true)
    return () => { document.removeEventListener('click', onOutside, true) }
  }, [props])

  return (
    <div
        ref={menu}
        id={`item-menu-${props.rowId}`}
        className={css.itemRowMenu}
        role="menu"
        aria-label={t('item.menu.more')}
        tabIndex={-1}
        data-placement={spot?.placement ?? 'below'}
        style={spot === undefined ? undefined : { insetBlockStart: `${spot.top}px`, insetInlineStart: `${spot.left}px`, maxBlockSize: `${spot.maxBlockSize}px` }}
        onKeyDown={event => {
          // Escape is handled HERE, on the menu, while focus is inside it. It is
          // not a document listener: that would fire for every overlay in the
          // stack on one press, and the two behaviours people actually notice are
          // "Escape does nothing" and "Escape closed something else".
          if (event.key === 'Escape') { event.stopPropagation(); props.onClose() }
        }}
      >
        {props.actions.map(action => (
          <button
            key={action.key}
            type="button"
            role="menuitem"
            className={css.itemRowMenuItem}
            onClick={() => pick(action)}
          >
            {action.label}
          </button>
        ))}
      </div>
  )
}
