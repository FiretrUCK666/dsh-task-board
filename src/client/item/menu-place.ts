/**
 * Where the row menu goes: one pure function, no DOM.
 *
 * WHY A SEPARATE MODULE AND NOT A BEAT INSIDE THE COMPONENT. The decision is a
 * function of two rectangles, and both of them come from the panel's OWN boxes
 * (`getBoundingClientRect()` of the trigger and of this panel's root). That is
 * the whole constraint that makes this surface different from the board: the
 * row menu may be measured against nothing but the box it lives in, because
 * reading the host's DOM is the one fragile surface the project forbids
 * outright. A decision that is pure arithmetic over two rects can be stated in
 * a test; the same decision written as DOM reads inside a component can only
 * be checked by rendering it.
 *
 * WHY IT IS NOT THE BOARD'S `shouldFlipMenuUp`. That helper answers one
 * question — "does this open upward?" — and answers it against a viewport when
 * no clipping ancestor is found. This menu needs more than the boolean: the
 * panel is scrolled and offset, so `position: fixed` coordinates are viewport
 * coordinates while the flip decision has to be made against the panel, or the
 * menu flips "upward" into a region the reader cannot see because the panel
 * itself starts lower down. It also needs the clamped `left` and the height
 * ceiling, so that a menu near the right edge stays inside the panel instead of
 * hanging off it. One function returning the whole spot, rather than a boolean
 * plus three pieces of clamping scattered through the component.
 *
 * THE CLAMPING IS CONSTRUCTIVE, NOT A CHECK. The order is fixed — choose the
 * direction, place along the trigger's leading edge, clamp that edge into the
 * panel, clamp the block edge into the panel — so "the menu never leaves the
 * panel" is a property of the last two steps rather than a post-hoc assertion
 * that might be forgotten. There is no branch in this file that can return a
 * spot outside `panel`.
 */

/** A rectangle in viewport coordinates, as `getBoundingClientRect` reports it. */
export interface Rect {
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly right: number
  readonly width: number
  readonly height: number
}

/** Which side of the trigger the menu opens on. */
export type MenuPlacement = 'below' | 'above'

/** The one answer this module gives: a placement and the spot it sits at. */
export interface MenuSpot {
  readonly placement: MenuPlacement
  /** Viewport coordinate, because the menu is `position: fixed`. */
  readonly top: number
  /** Viewport coordinate, because the menu is `position: fixed`. */
  readonly left: number
  /**
   * How much block space the menu may occupy here, already clamped. The menu
   * scrolls inside this instead of growing past the panel — a menu that
   * overflows the panel is the very thing this module exists to prevent, and a
   * ceiling is what prevents it without the panel growing a scroller.
   */
  readonly maxBlockSize: number
}

/** What the caller knows about the menu it is placing. */
export interface MenuSize {
  readonly width: number
  readonly height: number
  /**
   * Room the menu wants BELOW the trigger in addition to its own height — the
   * breathing room between the two, so a flush edge does not read as a clipping
   * ancestor. Zero by default: the gap parameter already covers that, and a
   * second knob for the same edge is one more number to disagree about.
   */
  readonly minBelow?: number
  /** Air between the trigger and the menu. */
  readonly gap?: number
}

/** The house gap: the same 4px the board's own menus open with. */
const DEFAULT_GAP = 4

/** Keep a value inside a range. The two branches are ordered, not swapped. */
function clamp(value: number, low: number, high: number): number {
  if (high < low) return low
  if (value < low) return low
  if (value > high) return high
  return value
}

/**
 * Place one row menu inside this panel.
 *
 * Below is the default and upward is the exception, matching the board's slash
 * menu: when there is genuinely more room above, open upward, and when the two
 * sides are equally cramped, open downward. A menu that flips on a tie is a
 * menu that moves under the reader's thumb between two rows of the same list.
 *
 * @param trigger - the ⋯ control's own rectangle.
 * @param panel - this panel's root rectangle. NOT the viewport and NOT a host
 *   element: the menu is placed against the box it has to stay inside.
 * @param menu - the menu's own measurements.
 * @returns the placement and the clamped spot.
 */
export function placeRowMenu(trigger: Rect, panel: Rect, menu: MenuSize): MenuSpot {
  const gap = menu.gap ?? DEFAULT_GAP
  const minBelow = menu.minBelow ?? 0

  // Room is measured to the PANEL's edges, not the viewport's: the panel is
  // scrolled and inset, so viewport room would claim space the reader cannot
  // reach inside this surface.
  const roomBelow = panel.bottom - trigger.bottom - gap
  const roomAbove = trigger.top - panel.top - gap
  const wanted = menu.height + minBelow
  const placement: MenuPlacement = roomBelow < wanted && roomAbove > roomBelow ? 'above' : 'below'

  // Above places by its OWN top edge (trigger.top - gap - height) rather than
  // by `bottom - height`: the menu has no known height until it is measured, so
  // an edge computed from a height is an edge computed from a guess.
  const rawTop = placement === 'above' ? trigger.top - gap - menu.height : trigger.bottom + gap
  const top = clamp(rawTop, panel.top, panel.bottom - menu.height)

  // Along the inline axis the menu lines up with the trigger's leading edge,
  // which is what makes it read as belonging to that ⋯, then it is pushed back
  // inside the panel rather than allowed to hang off the right edge.
  const left = clamp(trigger.left, panel.left, panel.right - menu.width)

  // The ceiling is the room on the side it opened towards, measured from where
  // it actually ended up after clamping — not from the trigger, because
  // clamping may have moved it.
  const room = placement === 'above' ? top - panel.top : panel.bottom - top
  const maxBlockSize = clamp(Math.min(menu.height, room), 0, menu.height)

  return { placement, top, left, maxBlockSize }
}
