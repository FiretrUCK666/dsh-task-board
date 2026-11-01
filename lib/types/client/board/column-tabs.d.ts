/**
 * Column-tabs math — the compact board's navigator strip. On a phone the
 * five status columns share a horizontal scroll track; the tabs (dot + name
 * + count, the column header's own grammar) jump a column into view and keep
 * the active tab honest with the track's scroll position. The position→tab
 * rule is pure so it is unit-testable without a DOM.
 *
 * ── 两个数字必须在同一个坐标系里 ─────────────────────────────────────────────
 *
 * `scrollLeft` 指向**滚动容器自己**的内容原点。而 `offsetLeft` 指向**`offsetParent`**
 * ——它不是「父元素」，是「最近的有定位的祖先」。两者只有在滚动容器自己带
 * `position: relative` 时才同源。
 *
 * **这条不是理论。** 从前 `.columns` 没有 `position`，于是每一列的 `offsetParent`
 * 是外面那个 `.board`，`offsetLeft` 里含了 `.board` 的内衬偏移（实测 +12px）。
 * 手机上一列约 212px 宽，12px 的偏移就足以让「最近的一列」判错一档；而更致命的是
 * **最后一列**：它的 `offsetLeft`（860）大于整条轨道的最大滚动量（684），于是
 * 「左边缘最接近」这个判据**永远够不到它**——读者把轨道拖到最右，「完成」那一栏
 * 已经整个在看，底下那枚 tab 却仍然高亮着「审核」。
 *
 * 所以滚动容器必须声明 `position: relative`（那条规矩写在 `board.module.css` 的
 * `.columns` 上，`tests/board-panel.spec.ts` 钉着它）。这一层只负责算术，
 * 但它算的两个数**要求**调用方把它们喂进同一个坐标系——那是这里唯一的约定。
 */
/** The column index whose left edge sits nearest the scroll position (a
 *  column scrolled fully past the left edge still counts once it is the
 *  closest one to being centered — the first index wins exact ties). */
export declare function activeColumnIndexAt(scrollLeft: number, lefts: readonly number[]): number;
/**
 * The column that owns the tab at a scroll position, in the scroller's OWN
 * coordinate system — and the end-of-track case that the plain "nearest left
 * edge" rule gets wrong.
 *
 * Even with both numbers sourced correctly, "nearest left edge" cannot express
 * the LAST column: at maximum scroll that column's left edge is still hundreds
 * of pixels from the scroller's left edge (a column is ~212px wide and the
 * overscroll is zero), so the second-to-last column is always nearer and the
 * final tab can never be reached by scrolling. Measured: at `scrollLeft = 684`
 * (the maximum) the nearest left edge was column 3 of 5.
 *
 * So the track's END is its own case: once the reader has scrolled as far as the
 * track goes, the column they are looking at is the last one, whatever the
 * left-edge arithmetic says. This is what a reader means by "I dragged it all the
 * way right" — the answer is the end, not the nearest edge.
 *
 * @param scrollLeft - the scroller's current offset.
 * @param lefts - each column's offset from the scroller's content origin.
 * @param scrollWidth - the scroller's full content width.
 * @param clientWidth - the scroller's visible width.
 * @returns the index of the column that owns the tab.
 */
export declare function columnIndexAtScroll(scrollLeft: number, lefts: readonly number[], scrollWidth: number, clientWidth: number): number;
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
