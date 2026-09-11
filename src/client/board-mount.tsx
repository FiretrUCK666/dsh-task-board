/**
 * Board view mounting.
 *
 * The `conversation` slot is single-occupant (ui-conversation) and external
 * plugins cannot declare slots, so the board takes over the center column at
 * the DOM level: a container is appended inside the `[data-pane="conversation"]`
 * grid item (an extra trailing child React never manages), and a stylesheet
 * rule hides the conversation content while the board is active. Toggling is
 * a data attribute on <html> — no React involvement, so the conversation
 * subtree underneath stays mounted and stateful.
 */
import { createRoot, type Root } from 'react-dom/client'
import type { BoardController } from '../core/controller.ts'
import type { BundleFreshnessState } from './bundle-freshness.ts'
import { TaskBoard } from './board/TaskBoard.tsx'
import { watchKeyboardInset } from './board/keyboard-inset.ts'

/** The center column: the official `data-pane="conversation"` marker first,
 * then the css-module class (legacy shells without the marker). The plugin
 * never depends on an external compatibility shim.
 */
const CONVERSATION_COLUMN_SELECTOR = '[data-pane="conversation"], [class*="centerCol"]'
const ACTIVE_ATTR = 'data-dsh-taskboard-active'

/** Find the center column, or undefined while the frame is not mounted. */
function conversationColumn(): HTMLElement | undefined {
  return document.querySelector<HTMLElement>(CONVERSATION_COLUMN_SELECTOR) ?? undefined
}

/**
 * Mount the board React tree into the center column and bind its visibility
 * to the controller's boardOpen state.
 * @param controller - the board controller driving the view.
 * @param freshness - the stale-bundle verdict to render (see bundle-freshness).
 * @returns disposer unmounting the tree and restoring the column.
 */
export function mountBoard(controller: BoardController, freshness?: BundleFreshnessState): () => void {
  let root: Root | undefined
  let container: HTMLDivElement | undefined
  let detachKeyboardInset: (() => void) | undefined

  const ensure = (): void => {
    if (container !== undefined) return
    const column = conversationColumn()
    if (column === undefined) return
    container = document.createElement('div')
    container.dataset.dshTaskboardView = ''
    column.appendChild(container)
    // One inset variable for every floating panel: the soft keyboard shrinks
    // the dialog stage instead of burying its header (see keyboard-inset.ts).
    // Written at the ROOT — a panel portal lands in the board box (or, before
    // the column arrives, on body), so the variable must ride an ancestor of
    // EVERY possible portal target, not just the board container.
    detachKeyboardInset = watchKeyboardInset(document.documentElement)
    root = createRoot(container)
    root.render(<TaskBoard controller={controller} freshness={freshness} />)
  }

  // The frame mounts after boot settlement; watch for the column's arrival.
  const waitObserver = new MutationObserver(() => { ensure() })
  waitObserver.observe(document.body, { childList: true, subtree: true })

  const applyActive = (): void => {
    if (controller.getSnapshot().boardOpen) {
      document.documentElement.setAttribute(ACTIVE_ATTR, '')
    } else {
      document.documentElement.removeAttribute(ACTIVE_ATTR)
    }
  }
  const unsubscribe = controller.subscribe(applyActive)
  applyActive()
  ensure()

  return () => {
    waitObserver.disconnect()
    unsubscribe()
    detachKeyboardInset?.()
    detachKeyboardInset = undefined
    document.documentElement.removeAttribute(ACTIVE_ATTR)
    root?.unmount()
    root = undefined
    container?.remove()
    container = undefined
  }
}
