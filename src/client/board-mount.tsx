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

/**
 * The native session rows a user can pick in the sidebar — the ONE user-intent
 * probe of this plugin (see {@link installSessionPickProbe}).
 *
 * Why a DOM signal at all: the official `ctx.sessions` face exposes the list
 * store (rows + `current`) plus `open`/`clear`/`refresh` — there is no
 * selection-INTENT event anywhere. Clicking the row that is already `current`
 * (or a row the user just came back to) moves nothing observable, and a store
 * notification is not evidence either: the same store also notifies for
 * running flips, activity stamps and catalog refreshes. "The user picked this
 * row" is therefore only expressible at the DOM, where the click happens.
 *
 * Why this anchor survives a shell rebuild: the workspace browser renders its
 * session rows with the ARIA selection contract (`role="treeitem"` +
 * `aria-selected`) and its workspace GROUP rows with `role="treeitem"` +
 * `aria-expanded` instead, and the rows carry no id attribute at all. Roles
 * and ARIA states are the sidebar's semantic API (screen readers depend on
 * them); a class name there is a hashed css-module token that changes with
 * every build, so the semantic pair is the stable one to read.
 */
const SESSION_ROW_SELECTOR = '[role="treeitem"][aria-selected]'

/** The plugin's OWN board subtree (stamped below): a click inside the board is
 *  never a sidebar pick, whatever roles its widgets carry. */
const BOARD_VIEW_SELECTOR = '[data-dsh-taskboard-view]'

/** Find the center column, or undefined while the frame is not mounted. */
function conversationColumn(): HTMLElement | undefined {
  return document.querySelector<HTMLElement>(CONVERSATION_COLUMN_SELECTOR) ?? undefined
}

/**
 * The user-selection probe: the ONE place the plugin reads "the user picked a
 * session in the native sidebar", reported to the controller, which owns the
 * close decision (see {@link BoardController.userSelectedNativeSession}).
 *
 * The click is read in the CAPTURE phase so the board's state is settled
 * before the sidebar's own React handler runs; the sidebar's selection then
 * simply shows the conversation the board just uncovered.
 *
 * `click`, never `pointerdown`: a drag from the sidebar onto the board fires
 * pointerdown but never a click (a completed drag suppresses it), so dragging
 * a session or a workspace folder onto the board cannot close it.
 *
 * The three guards are the whole probe — its scope, its anchor and the
 * plugin's own subtree — with no scattered selectors and no class names:
 * closed board = nothing to do; a click inside the board = not a sidebar pick;
 * a click outside any selectable session row (a group chevron, a menu, the
 * composer, another plugin's surface) = not a session pick.
 *
 * Desktop and narrow share this: the sidebar renders the same rows in both
 * (a drawer on a phone is still the same tree), so there is no breakpoint
 * branch to keep in step.
 */
function installSessionPickProbe(controller: BoardController): () => void {
  const onDocumentClick = (event: MouseEvent): void => {
    if (!controller.getSnapshot().boardOpen) return
    const target = event.target
    if (!(target instanceof Element)) return
    if (target.closest(BOARD_VIEW_SELECTOR) !== null) return
    if (target.closest(SESSION_ROW_SELECTOR) === null) return
    controller.userSelectedNativeSession()
  }
  document.addEventListener('click', onDocumentClick, true)
  return () => { document.removeEventListener('click', onDocumentClick, true) }
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
  // The one user-selection probe (see installSessionPickProbe): installed for
  // the mount's whole lifetime — a click on a sidebar row must close an open
  // board even when it moves the selection not at all.
  const detachSessionPick = installSessionPickProbe(controller)

  return () => {
    waitObserver.disconnect()
    detachSessionPick()
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
