/**
 * FLIP for card movement — structure-driven, never rect-driven.
 *
 * The original rect-diff approach treated ANY geometry change (a column
 * scroll, a hover lift, the dragging scale) as a move, so a busy board
 * repainted cards into their old positions — the "cards vanish / ghost
 * copies / endless flicker" symptoms. This version compares STRUCTURE only:
 * a card's column and its index inside it, read from the DOM order, never
 * from rects. A card animates only when its structure changed (a reorder or
 * a column move); a pure scroll or hover can never trigger it. The animation
 * runs on the Web Animations API (the browser owns the lifecycle — no
 * transitionend dependency, no inline-transform residue, auto-cancel on
 * unmount), and it is fully suppressed while the user is dragging: the
 * post-drop settle is the one moment it plays.
 */
import { useLayoutEffect, useRef, type RefObject } from 'react'

const FLIP_MS = 240
const FLIP_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)'

/** A card's structural identity: which column, and which index inside it. */
export interface CardStructure {
  status: string
  index: number
}

/** Whether the page asked for reduced motion (decorative animation off). */
function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

/**
 * The ids whose structure (column or in-column order) actually changed
 * between two snapshots — the ONLY cards eligible for a FLIP. A card absent
 * from the previous snapshot is new content (no old rect to animate FROM), a
 * card absent from both sides is ignored.
 */
export function flipCandidatesOf(
  previous: ReadonlyMap<string, CardStructure>,
  current: ReadonlyMap<string, CardStructure>,
): string[] {
  const candidates: string[] = []
  for (const [id, now] of current) {
    const before = previous.get(id)
    if (before === undefined) continue
    if (before.status !== now.status || before.index !== now.index) candidates.push(id)
  }
  return candidates
}

/** Collect the structural snapshot of a board region (columns → cards in
 *  DOM order) plus each card's rect at the same instant. */
function snapshotRegion(container: HTMLElement): {
  structures: Map<string, CardStructure>
  rects: Map<string, DOMRect>
} {
  const structures = new Map<string, CardStructure>()
  const rects = new Map<string, DOMRect>()
  for (const column of container.querySelectorAll<HTMLElement>('[data-status]')) {
    const status = column.getAttribute('data-status') ?? ''
    let index = 0
    for (const card of column.querySelectorAll<HTMLElement>('[data-task-id]')) {
      const id = card.getAttribute('data-task-id')
      if (id !== null) {
        structures.set(id, { status, index })
        rects.set(id, card.getBoundingClientRect())
      }
      index += 1
    }
  }
  return { structures, rects }
}

/**
 * Animate the cards whose structure changed into their new positions.
 *
 * Compact horizontal track: a cross-column move on a phone lands OFF-SCREEN
 * (the target column is not the one under the eye), so the animation —
 * though it plays — is never seen: 「移动没有动效」. Before playing, the
 * moved card's TARGET column is brought into view (instant scroll: a smooth
 * one would fight the rects the animation is computed from), and the track's
 * scroll-snap is pinned off while the flights run — snapping mid-animation
 * would yank the stage under the moving card. Desktop (no horizontal scroll)
 * never touches either.
 */
export function useFlipRegion(containerRef: RefObject<HTMLElement | null>, disabled: boolean): void {
  const previousStructures = useRef<ReadonlyMap<string, CardStructure>>(new Map())
  const previousRects = useRef<ReadonlyMap<string, DOMRect>>(new Map())
  useLayoutEffect(() => {
    const container = containerRef.current
    if (container === null) return
    const { structures, rects } = snapshotRegion(container)
    if (!disabled && !reducedMotion()) {
      const candidates = flipCandidatesOf(previousStructures.current, structures)
      if (candidates.length > 0) {
        const track = container.querySelector<HTMLElement>('[data-dsh-tb-columns]')
        const scrollsSideways = track !== null && track.scrollWidth > track.clientWidth + 1
        if (track !== null && scrollsSideways) {
          // Center the first moved card's target column in view, instantly.
          const first = container.querySelector<HTMLElement>(`[data-task-id="${candidates[0]}"]`)
          const targetColumn = first?.closest('section[data-status]')
          if (targetColumn !== null && targetColumn !== undefined) {
            targetColumn.scrollIntoView({ behavior: 'auto', inline: 'center', block: 'nearest' })
          }
          track.dataset.flipActive = ''
        }
        const flights: Array<Promise<void>> = []
        for (const id of candidates) {
          const before = previousRects.current.get(id)
          if (before === undefined) continue
          const after = rects.get(id)
          // Re-measure AFTER the scroll: the pre-scroll rect is not where the
          // card visually departed from once the track moved.
          const element = container.querySelector<HTMLElement>(`[data-task-id="${id}"]`)
          if (element === null || after === undefined) continue
          const live = element.getBoundingClientRect()
          const dx = before.left - live.left
          const dy = before.top - live.top
          if (dx === 0 && dy === 0) continue
          // WAAPI: the animation object is owned by the browser (auto-cancel on
          // unmount, no inline style left behind); no transitionend needed.
          const animation = element.animate(
            [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
            { duration: FLIP_MS, easing: FLIP_EASING },
          )
          flights.push(animation.finished.then(() => undefined).catch(() => undefined))
        }
        if (track !== null && scrollsSideways && flights.length > 0) {
          void Promise.all(flights).then(() => { delete track.dataset.flipActive })
        }
      }
    }
    previousStructures.current = structures
    previousRects.current = rects
  })
}
