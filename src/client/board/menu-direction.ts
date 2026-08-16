/**
 * Slash-menu direction: decide whether the autocomplete menu must open
 * upward instead of downward. The menu is absolutely positioned below the
 * prompt field by default; inside a modal that has overflow hidden, a menu
 * that would extend past the clipping container's bottom edge gets cut off
 * (scrolling the menu itself cannot help — the ancestor clips it). The
 * review page's composer sits at the bottom of the modal, so this is the
 * normal case there. Pure and framework-free so the decision unit-tests in
 * isolation.
 */

/** The menu's maximum rendered height (the CSS max-height). */
export const SLASH_MENU_MAX_HEIGHT = 280

/** The gap between the field and the menu (the CSS offset). */
const MENU_GAP = 4

/**
 * Whether the menu should open upward. True when there is not enough room
 * below the field within the clipping container (the menu would be cut off)
 * and there is more room above than below. Rectangles are in the same
 * coordinate space (e.g. both from getBoundingClientRect).
 *
 * @param fieldRect - the prompt field's rectangle.
 * @param clipRect - the nearest clipping ancestor's rectangle (the modal),
 *   or undefined when no clipping ancestor was found (falls back to
 *   viewport-level judgment via the field's own position).
 * @param viewportHeight - the viewport height (fallback coordinate space).
 * @param menuHeight - the menu's rendered height; defaults to the max.
 */
export function shouldFlipMenuUp(
  fieldRect: { top: number; bottom: number },
  clipRect: { top: number; bottom: number } | undefined,
  viewportHeight: number,
  menuHeight = SLASH_MENU_MAX_HEIGHT,
): boolean {
  const spaceBelow = clipRect !== undefined
    ? clipRect.bottom - fieldRect.bottom
    : viewportHeight - fieldRect.bottom
  const spaceAbove = clipRect !== undefined
    ? fieldRect.top - clipRect.top
    : fieldRect.top
  // Enough room below → keep the default downward opening.
  if (spaceBelow >= menuHeight + MENU_GAP) return false
  // Not enough below; open upward only when there is genuinely more room
  // above (otherwise both directions clip and downward stays the default).
  return spaceAbove > spaceBelow
}