/**
 * Dialog focus loop (THE one implementation — Dialog, TaskDetail and
 * SessionFrame all read this; no overlay manages focus on its own):
 * opening moves focus to the first control (or the panel itself when there
 * is none), Tab cycles inside the panel (never leaks to the board behind),
 * and closing returns focus to whatever held it. Escape stays out of here —
 * the shared Escape stack (escape-stack.ts) owns keys, this owns focus.
 */
import { useEffect, type KeyboardEvent, type RefObject } from 'react'

/** Tabbable controls inside a root (keyboard order = DOM order). */
export function focusablesOf(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  )].filter(element => !element.hasAttribute('disabled'))
}

/** Own the focus loop for one panel: mount-focus + unmount-return + Tab trap.
 *  The caller spreads the returned `onKeyDown` onto the panel element. */
export function useDialogFocus(
  ref: RefObject<HTMLElement | null>,
): { onKeyDown: (event: KeyboardEvent<HTMLElement>) => void } {
  useEffect(() => {
    const panel = ref.current
    const previous = document.activeElement
    const controls = panel === null ? [] : focusablesOf(panel)
    if (controls.length > 0) controls[0].focus()
    else panel?.focus()
    return () => {
      if (previous instanceof HTMLElement && document.contains(previous)) {
        previous.focus({ preventScroll: true })
      }
    }
    // The panel IS the mount: no dependency can meaningfully change it.
  }, [])
  return {
    onKeyDown: (event: KeyboardEvent<HTMLElement>): void => {
      if (event.key !== 'Tab') return
      const panel = event.currentTarget
      const items = focusablesOf(panel)
      if (items.length === 0) {
        event.preventDefault()
        panel.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    },
  }
}
