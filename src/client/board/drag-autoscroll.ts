/**
 * Drag edge auto-scroll — the ONE grammar for every draggable scroll surface
 * (board columns and the detail's session list).
 *
 * While a drag is active over a scrollable root and the pointer nears the
 * root's TOP/BOTTOM edge, the root scrolls itself (a proximity-scaled step
 * per frame), so dragging a card to the far bottom / top of a long list
 * completes in one gesture instead of stalling at the edge. The optional
 * per-frame callback re-computes the insertion gap with the LAST pointer
 * position, so the drop indicator stays truthful while the content moves.
 *
 * KEY implementation point: the roots use `scroll-behavior: smooth` (the
 * board's quiet-glide grammar) — programmatic per-frame stepping against a
 * smooth-scroll container would animate each step and fight itself. The hook
 * therefore switches the root to `scroll-behavior: auto` only while it is
 * actually scrolling and restores the original value when it stops.
 */
import { useEffect, useRef } from 'react'

/** Edge zone height from each edge (px). */
export const AUTO_SCROLL_EDGE_PX = 48
/** Maximum scroll step per animation frame (px). */
export const AUTO_SCROLL_MAX_STEP = 14

/**
 * The scroll step for a pointer at `pointerY` over a root spanning
 * [rectTop, rectBottom]: 0 outside the edge zones; positive (scroll down)
 * near the bottom, negative (scroll up) near the top, magnitude linear in
 * proximity (1..maxStep).
 */
export function edgeScrollStep(
  pointerY: number,
  rectTop: number,
  rectBottom: number,
  edgePx = AUTO_SCROLL_EDGE_PX,
  maxStep = AUTO_SCROLL_MAX_STEP,
): number {
  if (pointerY < rectTop || pointerY > rectBottom || edgePx <= 0) return 0
  const fromTop = pointerY - rectTop
  const fromBottom = rectBottom - pointerY
  const step = (distance: number): number => Math.max(1, Math.ceil(maxStep * (1 - distance / edgePx)))
  if (fromBottom < edgePx) return step(fromBottom)
  if (fromTop < edgePx) return -step(fromTop)
  return 0
}

/**
 * The edge-scroll loop for one drag surface. `getRoot` resolves the scroll
 * container under the pointer (stable closure over a ref); `active` switches
 * the loop on for the surface's drag kind. Every frame while the pointer sits
 * inside the root: `onFrame(lastPointerY)` only when a step was actually
 * applied (the gap/indicator follow the scroll).
 */
export function useDragAutoScroll(
  getRoot: () => HTMLElement | null,
  active: boolean,
  onFrame?: (pointerY: number) => void,
): void {
  const pointerRef = useRef(0)
  const frameRef = useRef(onFrame)
  frameRef.current = onFrame
  useEffect(() => {
    if (!active) return
    let raf = 0
    let scrolling = false
    const onDragOver = (event: DragEvent): void => {
      pointerRef.current = event.clientY
    }
    // NaN never satisfies the inside-rect comparison — a stopped drag can
    // never produce a trailing scroll frame.
    const stop = (): void => { pointerRef.current = Number.NaN }
    window.addEventListener('dragover', onDragOver, { passive: true })
    window.addEventListener('drop', stop)
    window.addEventListener('dragend', stop)
    const release = (root: HTMLElement): void => {
      if (scrolling) {
        scrolling = false
        root.style.scrollBehavior = ''
      }
    }
    const tick = (): void => {
      const root = getRoot()
      if (root !== null) {
        const rect = root.getBoundingClientRect()
        const y = pointerRef.current
        if (y >= rect.top && y <= rect.bottom) {
          const step = edgeScrollStep(y, rect.top, rect.bottom)
          if (step !== 0) {
            if (!scrolling) {
              scrolling = true
              // Smooth would fight the per-frame stepping (see module doc).
              root.style.scrollBehavior = 'auto'
            }
            root.scrollTop += step
            frameRef.current?.(y)
          } else {
            release(root)
          }
        } else {
          release(root)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', stop)
      window.removeEventListener('dragend', stop)
    }
  }, [active, getRoot])
}
