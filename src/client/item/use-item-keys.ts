/**
 * Where the keyboard flow is actually LISTENED, which is the only place in the
 * panel that knows a key event exists.
 *
 * WHY IT IS ITS OWN FILE. The registration is a lifecycle problem — a listener
 * that must die with the panel, and a disposer that must be returned — and
 * lifecycle code hidden inside a component is lifecycle code nobody can check.
 * Here it is one function with one disposer, and a test can mount and unmount it.
 *
 * WHY THE LISTENER IS ON `document` AND GUARDED, not on the panel's own root. A
 * listener on the surface's root only hears keys while SOMETHING INSIDE the
 * surface holds the focus — and the ordinary way to read a list is to click
 * somewhere, which hands the focus to nothing in particular. From that state
 * every shortcut was dead: the reader pressed `J` and the panel said nothing,
 * which is a flow that answers 「nothing is selected」 exactly when the reader
 * has just been reading. A document listener hears the key either way; the guard
 * is what keeps it honest — the flow answers only when the key is aimed at this
 * panel (the target lives inside this surface) or aimed at nothing at all (the
 * target fell back to the body, the state after a blank click). A keydown whose
 * target lives anywhere else — the shell's own chrome, another surface — is not
 * ours, and stands down.
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
 * The flow answers a keydown when it is aimed at this panel's subtree, or when
 * it is aimed at nothing (the focus fell back to the body — the state a blank
 * click leaves). Everything else is someone else's key.
 *
 * @param options - the flow's state, its handlers, and the panel's root.
 * @returns nothing; the effect owns the listener and returns the disposer.
 */
export function useItemKeys(options: UseItemKeysOptions): void {
  const { state, actions, surfaceRef } = options
  useEffect(() => {
    const root = surfaceRef.current?.closest<HTMLElement>(SURFACE) ?? null
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!claimsKey(event)) return
      const aimed = root !== null && event.target instanceof Element && root.contains(event.target)
      const nowhere = event.target === document.body || event.target === document.documentElement
      if (!aimed && !nowhere) return
      // Swallow FIRST and unconditionally, then decide. A key we claim that turns
      // out to be inert must still not reach the browser: `Esc` in an empty panel
      // scrolling the page is the exact symptom of deciding in the other order.
      event.preventDefault()
      dispatchKey(event, state, actions)
    }
    if (root === null) return
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [state, actions, surfaceRef])
}
