/**
 * useNarrow / useSurfaceNarrow — the two sanctioned signals for
 * BEHAVIOR/STRUCTURE switches (React cannot branch on a CSS container query).
 *
 * Geometry breakpoints live in CSS container queries (surface-relative); where
 * the DOM SHAPE or a default state must differ — the cruise settings ride a
 * compact anchored popover on a wide board but must become a full Dialog on a
 * phone; a review panel's folds start collapsed on a phone and open on a
 * desktop — these hooks are the switch.
 *
 * `useSurfaceNarrow` is the honest one: it measures THE SURFACE itself (the
 * floating panel the CSS is querying), so JS and CSS can never disagree.
 * `useNarrow` measures the viewport, which is only a proxy — a mid-size window
 * with the shell sidebar open has a viewport that says "wide" and a panel that
 * the container query already stacked; a default that follows the viewport
 * would then disagree with the geometry the user is looking at.
 */
import { useEffect, useRef, useState } from 'react'

export function useNarrow(maxPx: number = 720): boolean {
  const query = `(max-width: ${maxPx}px)`
  const [narrow, setNarrow] = useState(() => globalThis.matchMedia?.(query).matches === true)
  useEffect(() => {
    const list = globalThis.matchMedia?.(query)
    if (list === undefined) return
    const onChange = (event: MediaQueryListEvent): void => { setNarrow(event.matches) }
    setNarrow(list.matches)
    list.addEventListener('change', onChange)
    return () => { list.removeEventListener('change', onChange) }
  }, [query])
  return narrow
}

/**
 * Is the surface identified by `selector` (the nearest ancestor matching it,
 * counted from `from`) narrower than `maxPx`? `from` may be a ref or a CSS
 * class token used as a selector. Falls back to the viewport proxy until the
 * first measurement lands (one frame), so a default never flashes the wrong
 * shape on mount.
 */
export function useSurfaceNarrow(selector: string, maxPx: number, viewportFallback: number = 720): [boolean, { current: HTMLDivElement | null }] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [narrow, setNarrow] = useState(() => globalThis.matchMedia?.(`(max-width: ${viewportFallback}px)`).matches === true)
  useEffect(() => {
    // The observer is re-armed on every surface the node resolves to, and the
    // disposer closes it — no leaked observer when the panel re-mounts.
    const surface = ref.current?.closest(selector) ?? null
    if (surface === null) return
    const measure = (): void => { setNarrow(surface.getBoundingClientRect().width <= maxPx) }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(surface)
    return () => { observer.disconnect() }
  }, [selector, maxPx])
  return [narrow, ref]
}
