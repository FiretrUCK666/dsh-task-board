/**
 * Column-tabs math — the compact board's navigator strip. On a phone the
 * five status columns share a horizontal scroll track; the tabs (dot + name
 * + count, the column header's own grammar) jump a column into view and keep
 * the active tab honest with the track's scroll position. The position→tab
 * rule is pure so it is unit-testable without a DOM.
 */

/** The column index whose left edge sits nearest the scroll position (a
 *  column scrolled fully past the left edge still counts once it is the
 *  closest one to being centered — the first index wins exact ties). */
export function activeColumnIndexAt(scrollLeft: number, lefts: readonly number[]): number {
  let best = 0
  let bestGap = Number.POSITIVE_INFINITY
  for (let index = 0; index < lefts.length; index += 1) {
    const gap = Math.abs(lefts[index] - scrollLeft)
    if (gap < bestGap) {
      bestGap = gap
      best = index
    }
  }
  return best
}
