/**
 * Dialog focus loop (THE one implementation — Dialog, TaskDetail and
 * SessionFrame all read this; no overlay manages focus on its own):
 * opening moves focus to the first control (or the panel itself when there
 * is none), Tab cycles inside the panel (never leaks to the board behind),
 * and closing returns focus to whatever held it. Escape stays out of here —
 * the shared Escape stack (escape-stack.ts) owns keys, this owns focus.
 */
import { useEffect, type KeyboardEvent, type RefObject } from 'react'

/** Tabbable AND visible controls inside a root (keyboard order = DOM order).
 *  Hidden inputs (`type=hidden`), aria-hidden subtrees and display:none
 *  members never join the loop — focusing an invisible step reads as a
 *  lost focus. One predicate, three surfaces (never per-surface filters). */
export function focusablesOf(root: Element): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
  )].filter(element => {
    if (element.hasAttribute('disabled')) return false
    if (element instanceof HTMLInputElement && element.type === 'hidden') return false
    if (element.closest('[aria-hidden="true"]') !== null) return false
    const style = element instanceof HTMLElement ? getComputedStyle(element) : undefined
    return style === undefined || (style.display !== 'none' && style.visibility !== 'hidden')
  })
}

/** Move focus to the declared/first control of a panel (or the panel itself
 *  when control-less). Shared by the mount effect and the refocus effect. */
function focusFirst(panel: HTMLElement | null): void {
  if (panel === null) return
  const declared = panel.querySelector<HTMLElement>('[data-autofocus]')
  const controls = focusablesOf(panel)
  const target = declared ?? controls[0] ?? panel
  target.focus()
}

/** Own the focus loop for one panel: mount-focus + unmount-return + Tab trap.
 *  The caller spreads the returned `onKeyDown` onto the panel element. The
 *  mount target is the first `[data-autofocus]` descendant when one exists
 *  (the caller's declared intent — e.g. a filter box over a master switch),
 *  else the first tabbable control, else the panel itself. Native `autoFocus`
 *  is banned inside Dialog subtrees (it races this effect); declare intent
 *  with `data-autofocus` instead.
 *
 *  `focusKey` re-aims focus WITHOUT touching the return chain: pass a value
 *  that flips when the panel's first control changes identity (e.g. the
 *  detail's edit mode swapping the Edit button for a form). The return chain
 *  stays mount-scoped — only the mount effect captures `previous`.
 *
 *  Return falls back down a chain: the opener when alive, else the first
 *  tabbable control of the board box (a deleted trigger must not strand
 *  keyboard users on body). */
export function useDialogFocus(
  ref: RefObject<HTMLElement | null>,
  focusKey?: unknown,
): { onKeyDown: (event: KeyboardEvent<HTMLElement>) => void } {
  useEffect(() => {
    const previous = document.activeElement
    focusFirst(ref.current)
    return () => {
      if (previous instanceof HTMLElement && document.contains(previous)) {
        previous.focus({ preventScroll: true })
        return
      }
      const box = document.querySelector('[data-dsh-taskboard-view]')
      if (box !== null) {
        const fallback = focusablesOf(box)[0]
        fallback?.focus({ preventScroll: true })
      }
    }
    // The panel IS the mount: no dependency can meaningfully change it.
  }, [])
  useEffect(() => {
    focusFirst(ref.current)
    // Re-aim only (see focusKey): the return chain above never re-captures.
  }, [focusKey])
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
