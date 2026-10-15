/**
 * Same-column reorder math: where a dropped card lands, computed from the
 * pointer's Y against the insertion gaps of a column (each card's upper gap,
 * including the column top, and the column tail below the last card).
 * Symmetric in both directions and correct for any column size: a pointer
 * in a card's lower half lands in the gap below it, a pointer in its upper
 * half in the gap above. Pure and DOM-free so it unit-tests in isolation.
 */
/** Where a drop lands within a column. */
export interface InsertionGap {
    /** Insert before this card id; undefined = append at the column tail. */
    beforeId: string | undefined;
    /** The gap center's Y (viewport coordinates): where the indicator sits. */
    top: number;
}
/**
 * The indicator bar's Y in the scroll container's CONTENT coordinate space:
 * the viewport gap top minus the container's viewport top PLUS the container's
 * scroll offset — without the scroll term the bar drifts upward by exactly
 * the scrolled amount, and drops land at a visually different gap than the
 * bar promised. Clamped to the content's top and bottom so the bar is never
 * clipped away from its gap.
 */
export declare function indicatorTopOf(viewportTop: number, containerTop: number, scrollTop: number, contentHeight: number): number;
/**
 * Compute the insertion gap for a drag at `dropY` over a column's cards (in
 * visual order, excluding the dragged card itself): the nearest gap center
 * to the pointer wins — a gap center is `gap / 2` above each card and
 * `gap / 2` below the last card (the column tail). `top` is the gap center
 * in the same coordinate space as the rects, so the indicator is always
 * drawn exactly where the drop lands.
 */
export declare function insertionGapOf(cards: readonly {
    id: string;
    rect: {
        top: number;
        height: number;
    };
}[], dropY: number, dragId: string, gap: number): InsertionGap;
/**
 * The same question the pointer asks, asked by the keyboard: which gap does a
 * card move to when it is told to go one place up or down INSIDE its column?
 *
 * It exists because the manual order is PERSISTED — the board's own rule is that
 * a hand-placed card is never reordered by the engine — so "where I put it" is a
 * capability, and a capability with only a pointer as its door is unreachable for
 * a keyboard reader. `[` / `]` answer the column half; this answers the position
 * half, through the same gap shape the drop produces, so both roads end in the
 * one `moveTask(id, status, beforeId)` funnel.
 *
 * `others` is the column's ids in visual order with the moving card REMOVED —
 * the same shape `insertionGapOf` takes, for the same reason: the card being
 * moved is not a landmark for its own landing. `at` is where it currently sits in
 * the full column, which is also the index it would be re-inserted at.
 *
 * Returns `undefined` when there is nothing to swap with — the top card asked to
 * go up, the bottom card asked to go down. `{ beforeId: undefined }` is a real
 * answer and a different one: it means the column TAIL.
 */
export declare function reorderTargetOf(others: readonly string[], at: number, direction: -1 | 1): {
    beforeId: string | undefined;
} | undefined;
