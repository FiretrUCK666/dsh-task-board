/**
 * The board's ONE Escape grammar for its overlay family.
 *
 * Overlays legitimately stack (a confirm dialog over the preset manager over
 * the new-task modal; the review page over the task detail). A per-overlay
 * `document` keydown listener can never express "only the top one closes":
 * `stopPropagation` does not stop ANOTHER listener on the SAME node, so one
 * Escape used to pop the whole stack at once. This module keeps a single
 * LIFO stack of open overlays and routes ONE shared keydown listener to the
 * TOP overlay only — every overlay registers through this hook and the family
 * gets correct, drift-free Escape behavior from exactly one place.
 */
import { useEffect, useRef } from 'react'

/** One open overlay; `close` is kept fresh by the owning component. */
interface EscapeEntry {
  close: () => void
}

/** The live stack (bottom → top). Module-level: one per page, like the DOM. */
const stack: EscapeEntry[] = []
let installed = false

function onKey(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  const top = stack[stack.length - 1]
  if (top === undefined) return
  // The topmost overlay owns this Escape — nothing beneath it moves.
  event.stopPropagation()
  event.preventDefault()
  top.close()
}

/**
 * Register an overlay's close callback on the Escape stack for as long as it
 * is mounted. Safe with inline closures: the entry is refreshed on every
 * render, so the shared listener always calls the latest callback without
 * re-shuffling the stack order.
 */
export function useEscapeStack(onClose: () => void): void {
  const entryRef = useRef<EscapeEntry>()
  if (entryRef.current === undefined) entryRef.current = { close: onClose }
  entryRef.current.close = onClose
  useEffect(() => {
    const entry = entryRef.current as EscapeEntry
    stack.push(entry)
    if (!installed) {
      document.addEventListener('keydown', onKey)
      installed = true
    }
    return () => {
      const index = stack.lastIndexOf(entry)
      if (index >= 0) stack.splice(index, 1)
      if (stack.length === 0 && installed) {
        document.removeEventListener('keydown', onKey)
        installed = false
      }
    }
  }, [])
}
