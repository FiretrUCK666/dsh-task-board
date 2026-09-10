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
export declare function keyboardOverlapPx(innerHeight: number, visibleHeight: number, visibleTop: number, noiseFloorPx?: number): number;
/** Watch and write `--dsh-tb-kb` on `root`. @returns the disposer. */
export declare function watchKeyboardInset(root: HTMLElement): () => void;
