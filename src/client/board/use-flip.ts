/**
 * FLIP (First-Last-Invert-Play) for card movement: between every commit, the
 * board region's card rects are captured; a card whose rect changed (a
 * same-column reorder or a cross-column move — the element may even remount
 * into another column) is animated FROM its old position TO its new one. One
 * hook per board region, one transition grammar, reduced-motion degrades to
 * static. The drop confirmation is THIS card settle — no column-edge flash.
 */
import { useLayoutEffect, useRef, type RefObject } from 'react'

const FLIP_MS = 240

/** Whether the page asked for reduced motion (decorative animation off). */
function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

/** Animate cards whose position changed since the previous commit. */
export function useFlipRegion(containerRef: RefObject<HTMLElement | null>): void {
  const previous = useRef<ReadonlyMap<string, DOMRect>>(new Map())
  useLayoutEffect(() => {
    const container = containerRef.current
    if (container === null) return
    const current = new Map<string, DOMRect>()
    for (const element of container.querySelectorAll<HTMLElement>('[data-task-id]')) {
      const id = element.getAttribute('data-task-id')
      if (id !== null) current.set(id, element.getBoundingClientRect())
    }
    if (!reducedMotion()) {
      for (const [id, before] of previous.current) {
        const after = current.get(id)
        // A card only animates when it is still on the board AND its origin
        // moved (a scroll of the column also moves rects — a scrolled-into-
        // view row should not re-play; the origin delta is what the user
        // caused by the drop, so a pure scroll must look like a scroll).
        if (after === undefined || after.left === before.left && after.top === before.top) continue
        const element = container.querySelector<HTMLElement>(`[data-task-id="${id}"]`)
        if (element === null) continue
        const dx = before.left - after.left
        const dy = before.top - after.top
        if (dx === 0 && dy === 0) continue
        // Invert (place at the old rect) → play (transition to identity).
        element.style.transition = 'none'
        element.style.transform = `translate(${dx}px, ${dy}px)`
        void element.offsetHeight // flush so the inverted state commits
        element.style.transition = `transform ${FLIP_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`
        element.style.transform = ''
        element.addEventListener('transitionend', () => {
          element.style.transition = ''
          element.style.transform = ''
        }, { once: true })
      }
    }
    previous.current = current
  })
}
