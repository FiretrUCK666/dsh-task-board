/**
 * useNarrow — the one viewport signal for BEHAVIOR/STRUCTURE switches.
 *
 * Geometry breakpoints live in CSS container queries (board-box relative);
 * React cannot branch on them. Where the DOM SHAPE must differ — the cruise
 * settings ride a compact anchored popover on a wide board but must become a
 * full Dialog on a phone — this hook is the single switch. The threshold
 * tracks the phone class of board boxes (the compact container stage is 680px
 * plus the sidebar allowance); anything narrower than this gets the stacked,
 * touch-first form of the same content.
 */
import { useEffect, useState } from 'react'

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
