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
export declare function activeColumnIndexAt(scrollLeft: number, lefts: readonly number[]): number;
/**
 * The scroll offset that puts column `index` at the track's left edge — the
 * inverse of `activeColumnIndexAt`, clamped into the scrollable range. Tab
 * jumps, resize re-anchoring and the FLIP cross-column scroll all aim with
 * THIS one function, so the track's persistent state is the COLUMN IDENTITY
 * and the pixel value is always derived. (Scroll-snap stored pixels and
 * re-anchored to them on every container resize — that is what made the
 * board "shift a little" each time the shell sidebar opened or closed.)
 */
export declare function scrollLeftForColumn(index: number, lefts: readonly number[], clientWidth: number, scrollWidth: number): number;
