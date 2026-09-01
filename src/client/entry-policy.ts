/**
 * Sidebar-entry display policy (pure, DOM-free decisions for the mount
 * state machine in sidebar-entry.ts).
 *
 * The single entry rule: the board is reachable through EXACTLY ONE affordance
 * at any moment — the injected sidebar row while it is actually visible, the
 * floating corner button otherwise. "Placed in the DOM" is not the same as
 * "visible": a mobile shell renders its sidebar off-canvas (or is late /
 * re-rendered away), so a row that exists inside a hidden or detached tree
 * would silently leave the board unreachable. Every decision here is a
 * direct function of visibility, never of what happened earlier.
 *
 * @module dsh-task-board/client/entry-policy
 */

/**
 * Whether a mounted entry is actually visible to the user. Requires the
 * element to be connected to the document AND to have laid-out boxes
 * (0 rects = hidden by CSS, off-viewport, or rendered inside a detached
 * tree — a row in any of those states is not an entry).
 */
export function entryVisible(element: HTMLElement | undefined): boolean {
  if (element === undefined) return false
  return element.isConnected && element.getClientRects().length > 0
}

/**
 * Whether the floating corner fallback is currently needed. The row wins
 * while visible; every other state — never placed, placed in a hidden or
 * detached shell subtree, or just not connected — wants the fallback.
 */
export function fallbackWanted(entry: HTMLElement | undefined): boolean {
  return !entryVisible(entry)
}
