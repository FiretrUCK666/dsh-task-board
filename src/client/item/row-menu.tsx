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
  /**
   * SHOWN BUT NOT TAKEN, and the reason beside it.
   *
   * A menu entry used to be a sentence. It became a button — which is the right
   * control — and that change opened the question of what an unavailable one
   * looks like, and the answer is NOT to leave it out: a list whose length changes
   * with a fact the reader cannot see is a list nobody can learn. So the entry
   * stays, it is `aria-disabled` rather than absent, and the hint names the fact
   * that is missing. **The reader is never left to work out whether the entry
   * is broken or their row is.**
   */
  readonly disabled?: boolean
  readonly hint?: string
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

/**
 * A box, or nothing — and "nothing" includes a box with no AREA.
 *
 * A `null` node was the only rejected input, so an element that is present in the
 * DOM and not rendered (`hidden`, `display: none`, an un-attached node) measured
 * as `{0,0,0,0}` and was accepted as a real box. Placement then ran honestly on a
 * box that cannot contain anything: room below is negative, room above is not, so
 * the menu "opens upward" to a clamped `top` of 0 with a ceiling of exactly 0 —
 * **a zero-height strip pinned to the window's top-left corner.** Nothing threw
 * and nothing logged; the only symptom was a menu that did not appear.
 *
 * A size of zero is never a real box for a popover: every element it could be
 * anchored to is something the reader can see, and everything the reader can see
 * has area. So the guard belongs here, at the one place a rectangle enters this
 * module, rather than in the arithmetic downstream — `placeRowMenu` is pure and
 * its inputs have to be boxes.
 */
function rectOf(node: HTMLElement | null): Rect | undefined {
  if (node === null) return undefined
  const box = node.getBoundingClientRect()
  if (box.width === 0 || box.height === 0) return undefined
  return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width, height: box.height }
}

/**
 * The box the menu may not leave, or the window when the panel cannot be
 * measured.
 *
 * The menu is `position: fixed`, so the window is ALWAYS a valid box for it —
 * which makes the viewport the honest fallback rather than a guess: it is the
 * one box that certainly exists and certainly contains the trigger. The panel is
 * the better box, because the panel is inset and scrolled and its edges are the
 * ones the reader can reach, so it wins whenever it can be measured.
 */
function boxFor(node: HTMLElement | null): Rect | undefined {
  return rectOf(node) ?? rectOf(document.documentElement)
}

export function ItemRowMenu(props: ItemRowMenuProps) {
  const menu = useRef<HTMLDivElement | null>(null)
  const [spot, setSpot] = useState<MenuSpot | undefined>(undefined)

  /**
   * Measure, place, and move focus in — all before the browser paints.
   *
   * The spot is computed TWICE, and the second pass is the one that matters. The
   * first runs on an element with no `style` yet, so it measures the menu at its
   * natural size. The second runs after that spot has been applied, and it exists
   * because applying the spot can CHANGE the menu: `maxBlockSize` is a ceiling
   * derived from the box we just measured, so a menu taller than the room below
   * its trigger is given a scroller — and a scrolled menu is shorter than the one
   * the first pass measured against. Left at the first pass's numbers, the edge
   * that has to be flush beside the trigger is flush to the wrong pixel.
   *
   * So the first pass is the neighbourhood and the second is the truth, and the
   * effect that owns the second re-runs whenever the spot changes. It only
   * `setSpot` when a NUMBER actually moved, because the alternative — an effect
   * that always sets state — re-renders forever.
   */
  useLayoutEffect(() => {
    const trigger = rectOf(props.trigger)
    const panel = boxFor(props.panel)
    if (trigger === undefined || panel === undefined) return
    const box = menu.current?.getBoundingClientRect()
    const next = placeRowMenu(trigger, panel, {
      width: box?.width ?? ASSUMED.width,
      height: box?.height ?? ASSUMED.height,
    })
    setSpot(current => (current !== undefined
      && current.placement === next.placement
      && current.top === next.top
      && current.left === next.left
      && current.maxBlockSize === next.maxBlockSize
      ? current
      : next))
    menu.current?.focus()
  }, [props.trigger, props.panel, spot])

  // A menu that stays put while the list scrolls is a menu pointing at nothing.
  useEffect(() => {
    const onReflow = (): void => {
      const trigger = rectOf(props.trigger)
      const panel = boxFor(props.panel)
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
    // A disabled entry closes nothing and runs nothing. It is not `pointer-events:
    // none` in CSS either: that would take the entry out of the keyboard order
    // without saying so, and a `disabled` control the reader cannot reach is the
    // one thing they cannot discover.
    if (action.disabled === true) return
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
      /* THE TRIGGER IS THE MENU'S OTHER HALF, so a press on the ⋯ belongs to the
       * button's own toggle and to nothing else. Closing here AND toggling there
       * made one click answer to two handlers whose order nothing guarantees:
       * the menu could shut and flip straight back open, or shut twice — both
       * read as 「再按一次⋯，面板不收」。 Exempting the trigger leaves every
       * press on it exactly ONE writer: the toggle, which reads the state that
       * is current when the click runs. */
      if (props.trigger !== null && target instanceof Node && props.trigger.contains(target)) return
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
            aria-disabled={action.disabled === true || undefined}
            title={action.hint}
            /* The press must not reach the row the menu sits inside: the row
               treats a plain press as 「select AND open」, and every menu item
               that let it through would also flip the row — 改标题 would open
               the detail, 删除 this 删除这条 would open it and then remove it.
               The menu's own outside-click listener runs on capture and has
               already exempted this target, so stopping the bubble here costs
               the row nothing. */
            onClick={event => { event.stopPropagation(); pick(action) }}
          >
            <span className={css.itemRowMenuLabel}>{action.label}</span>
            {action.hint !== undefined && <span className={css.itemRowMenuHint}>{action.hint}</span>}
          </button>
        ))}
      </div>
  )
}
