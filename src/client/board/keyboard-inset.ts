/**
 * Keyboard inset — the ONE mechanism keeping floating panels fully visible
 * under the mobile soft keyboard.
 *
 * When a text field takes focus on a phone, the keyboard eats the bottom of
 * the VISUAL viewport while the layout viewport (and every absolute panel
 * sized against it) stays whole — the panel's header, then its title, slide
 * above the screen edge (the 「添加已有会话」标题被顶没 report). The watcher
 * measures the overlap from `visualViewport` and writes it into
 * `--dsh-tb-kb`; the floating backdrop adds that to its bottom padding, so
 * every capped panel simply shrinks to the space the keyboard leaves —
 * header on top, actions at the bottom, nothing buried. One variable, all
 * overlays follow (no per-dialog keyboard plumbing anywhere).
 *
 * The noise floor separates a keyboard (≥ ~150px) from the browser's dynamic
 * toolbars (~60-120px of height change), which must NOT resize the stage.
 */

/** Pure overlap math: keyboard pixels occluding the bottom of the layout box. */
export function keyboardOverlapPx(
  innerHeight: number,
  visibleHeight: number,
  visibleTop: number,
  noiseFloorPx: number = 150,
): number {
  const overlap = innerHeight - visibleHeight - visibleTop
  return overlap >= noiseFloorPx ? Math.round(overlap) : 0
}

/** Watch and write `--dsh-tb-kb` on `root`. @returns the disposer. */
export function watchKeyboardInset(root: HTMLElement): () => void {
  const viewport = globalThis.visualViewport
  if (viewport === undefined || viewport === null) return () => {}
  /* The last value written, so a scroll that does not change the keyboard overlap
   * does not touch the DOM. `visualViewport` fires this on EVERY scroll of a page
   * that is being pinch-zoomed or has a keyboard open; writing a custom property
   * each time invalidates style for the whole subtree that inherits it.
   *
   * The listeners are `passive`: this code never calls `preventDefault`, and
   * saying so is what lets the browser run the gesture without waiting for the
   * main thread first. */
  let lastPx: number | undefined
  const apply = (): void => {
    const px = keyboardOverlapPx(globalThis.innerHeight, viewport.height, viewport.offsetTop)
    if (px === lastPx) return
    lastPx = px
    if (px === 0) root.style.removeProperty('--dsh-tb-kb')
    else root.style.setProperty('--dsh-tb-kb', `${px}px`)
  }
  apply()
  viewport.addEventListener('resize', apply, { passive: true })
  viewport.addEventListener('scroll', apply, { passive: true })
  return () => {
    viewport.removeEventListener('resize', apply)
    viewport.removeEventListener('scroll', apply)
    root.style.removeProperty('--dsh-tb-kb')
  }
}
