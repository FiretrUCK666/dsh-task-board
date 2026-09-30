/**
 * Where the keyboard flow is actually LISTENED, which is the only place in the
 * panel that knows a key event exists.
 *
 * WHY IT IS ITS OWN FILE. The registration is a lifecycle problem — a listener
 * on a node that goes away, a disposer that must be returned, and a body-level
 * listener that must stop the moment the panel unmounts — and lifecycle code
 * hidden inside a component is lifecycle code nobody can check. Here it is one
 * function with one disposer, and a test can mount and unmount it.
 *
 * WHY THE LISTENER IS ON THE PANEL AND NOT ON `document`. A body-level handler
 * answers keys for a panel that is not on screen, and the panel next door
 * answers keys meant for this one. The listener is attached to the surface's own
 * root, found the same way the row menu finds it — by asking for the NEAREST
 * ancestor carrying this panel's attribute, never `document`, because the board
 * carries the same attribute and "the first one in the document" is the board
 * whenever both are mounted.
 *
 * THE DISPOSER IS NOT OPTIONAL AND NOT BEST-EFFORT (hard rule 6). A key handler
 * left attached after the panel unmounts calls `setState` on a dead tree, and
 * React's answer to that is a warning nobody reads and a surface that stops
 * responding.
 */
import { useEffect } from 'react'
import { claimsKey, dispatchKey, type ItemKeyActions, type KeyState } from './keyboard.ts'

/** The attribute this panel marks its own root with, and the board marks its own. */
const SURFACE = '[data-dsh-taskboard-view]'

export interface UseItemKeysOptions {
  /** What the flow knows when a key is pressed. */
  readonly state: KeyState
  /** One handler per action the map names. Closed, so a name cannot go missing. */
  readonly actions: ItemKeyActions
  /** The panel's own root, or `null` before it is mounted. */
  readonly surfaceRef: React.RefObject<HTMLElement | null>
}

/**
 * Listen for the item panel's keys, for as long as the component is mounted.
 *
 * @param options - the flow's state, its handlers, and the box to listen on.
 * @returns nothing; the effect owns the listener and returns the disposer.
 */
export function useItemKeys(options: UseItemKeysOptions): void {
  const { state, actions, surfaceRef } = options
  useEffect(() => {
    const root = surfaceRef.current?.closest<HTMLElement>(SURFACE) ?? surfaceRef.current
    if (root === null || root === undefined) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!claimsKey(event)) return
      // Swallow FIRST and unconditionally, then decide. A key we claim that turns
      // out to be inert must still not reach the browser: `Esc` in an empty panel
      // scrolling the page is the exact symptom of deciding in the other order.
      event.preventDefault()
      dispatchKey(event, state, actions)
    }
    root.addEventListener('keydown', onKeyDown)
    return () => { root.removeEventListener('keydown', onKeyDown) }
  }, [state, actions, surfaceRef])
}
