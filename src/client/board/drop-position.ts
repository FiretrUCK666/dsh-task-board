/**
 * Same-column reorder math: where a dropped card lands, computed from the
 * pointer's Y against each card's midpoint (half-split). Dragging down over
 * a card inserts after it, dragging up inserts before — symmetric in both
 * directions and correct for any column size (a two-card column can swap
 * both ways). Pure and DOM-free so it unit-tests in isolation.
 */

/** Where a drop lands within a column. */
export interface DropAnchor {
  /** Insert before this card id; undefined = append at the column tail. */
  beforeId: string | undefined
}

/**
 * Compute the insertion anchor for a drag at `dropY` over a column's cards
 * (in visual order, excluding the dragged card itself): the first card whose
 * midpoint lies below the pointer becomes the "insert before" anchor; a
 * pointer below every midpoint appends at the tail.
 */
export function insertionAnchorOf(
  cards: readonly { id: string; rect: { top: number; height: number } }[],
  dropY: number,
  dragId: string,
): DropAnchor {
  for (const card of cards) {
    if (card.id === dragId) continue
    if (dropY < card.rect.top + card.rect.height / 2) return { beforeId: card.id }
  }
  return { beforeId: undefined }
}
